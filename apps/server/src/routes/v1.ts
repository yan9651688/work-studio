import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Model, Generation } from '@studio/shared';
import type { Context } from '../context.js';
import { assert } from '../services/security.js';
import { freshGeneration } from './user.js';
const bodySchema = z.object({
  model: z.string(),
  prompt: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
      }),
    )
    .optional(),
  size: z.string().optional(),
  resolution: z.string().optional(),
  quality: z.string().optional(),
  duration: z.number().optional(),
  stream: z.boolean().default(false),
  max_tokens: z.number().optional(),
  n: z.coerce.number().int().min(1).max(1).default(1),
  response_format: z.enum(['url', 'b64_json']).default('url'),
});
export function v1Routes(app: FastifyInstance, ctx: Context) {
  const auth = (req: FastifyRequest) => {
    const user = ctx.user(req);
    assert(req.apiKeyId, 401, 'API_KEY_REQUIRED', '请使用 Bearer API Key');
    return user;
  };
  app.get('/v1/models', async (req) => {
    auth(req);
    return {
      object: 'list',
      data: ctx.db
        .list<Model>('models')
        .filter((m) => m.enabled)
        .map((m) => ({
          id: m.id,
          object: 'model',
          created: Math.floor(Date.parse(m.created_at) / 1000),
          owned_by: m.provider_group || 'studio',
        })),
    };
  });
  const wait = async (id: string, req: FastifyRequest) => {
    for (let i = 0; i < 1200; i++) {
      const g = ctx.db.get<Generation>('generations', id)!;
      if (['succeeded', 'failed', 'refunded'].includes(g.status)) return freshGeneration(ctx, g);
      assert(!req.raw.socket?.destroyed, 499, 'CLIENT_CLOSED', '客户端已断开');
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('等待生成超时');
  };
  for (const route of [
    'images/generations',
    'images/edits',
    'videos/generations',
    'chat/completions',
  ])
    app.post(`/v1/${route}`, async (req, reply) => {
      const user = auth(req);
      let input = req.body;
      const reference_assets: string[] = [];
      if (route === 'images/edits' && req.isMultipart()) {
        const fields: Record<string, unknown> = {};
        for await (const part of req.parts()) {
          if (part.type === 'file') {
            assert(reference_assets.length < 10, 400, 'TOO_MANY_REFERENCES', '参考图过多');
            const buffer = await part.toBuffer();
            assert(!part.file.truncated, 413, 'FILE_TOO_LARGE', '参考图过大');
            const asset = await ctx.gateway.storage.save(buffer, user.id);
            reference_assets.push(asset.id);
          } else fields[part.fieldname] = part.value;
        }
        input = fields;
      }
      const body = bodySchema.parse(input);
      const model = ctx.db
        .list<Model>('models')
        .find((m) => m.id === body.model || m.compat_alias === body.model);
      assert(model, 400, 'MODEL_NOT_FOUND', '模型不存在');
      const type = route.startsWith('images')
        ? 'image'
        : route.startsWith('videos')
          ? 'video'
          : 'text';
      assert(model.type === type, 400, 'MODEL_TYPE_MISMATCH', '接口与模型类型不匹配');
      assert(
        route !== 'images/edits' || reference_assets.length,
        400,
        'IMAGE_REQUIRED',
        '图片编辑接口需上传 image 文件',
      );
      const ratios: Record<string, string> = {
        '1024x1024': '1:1',
        '1536x1024': '16:9',
        '1024x1536': '9:16',
      };
      assert(
        !body.size || ratios[body.size],
        400,
        'INVALID_SIZE',
        '当前支持 1024x1024、1536x1024、1024x1536',
      );
      const params = {
        stream: body.stream,
        ...(body.size ? { ratio: ratios[body.size] } : {}),
        ...(body.resolution ? { resolution: body.resolution } : {}),
        ...(body.quality ? { quality: body.quality } : {}),
        ...(body.duration ? { duration: body.duration } : {}),
        ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}),
        ...(body.messages ? { messages: body.messages } : {}),
      };
      const prompt = body.prompt || body.messages?.map((m) => m.content).join('\n') || '';
      const g = ctx.gateway.create(
        user,
        { model_id: model.id, prompt, params, reference_assets },
        req.apiKeyId,
        'api',
      );
      if (type === 'video')
        return {
          id: g.id,
          object: 'video',
          status: 'queued',
          created: Math.floor(Date.now() / 1000),
        };
      if (body.stream && type === 'text') {
        reply.hijack();
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        const heartbeat = setInterval(() => reply.raw.write(': waiting\n\n'), 10000);
        try {
          let sent = 0;
          const sendText = (text: string) => {
            if (text.length > sent) {
              reply.raw.write(
                `data: ${JSON.stringify({ id: g.id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, delta: { content: text.slice(sent) }, finish_reason: null }] })}\n\n`,
              );
              sent = text.length;
            }
          };
          while (!reply.raw.destroyed) {
            const result = ctx.db.get<Generation>('generations', g.id)!;
            if (result.status === 'succeeded') {
              sendText(result.result_assets.map((a) => a.text || '').join('\n'));
              reply.raw.write(
                `data: ${JSON.stringify({ id: g.id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
              );
              break;
            }
            if (['refunded', 'failed'].includes(result.status)) {
              reply.raw.write(
                `data: ${JSON.stringify({ error: { message: result.error, code: 'GENERATION_FAILED' } })}\n\n`,
              );
              break;
            }
            sendText(ctx.gateway.liveText.get(g.id) || '');
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          if (!reply.raw.destroyed) reply.raw.write('data: [DONE]\n\n');
        } finally {
          clearInterval(heartbeat);
          reply.raw.end();
        }
        return;
      }
      const result = await wait(g.id, req);
      assert(
        result.status === 'succeeded',
        502,
        'GENERATION_FAILED',
        result.error || '生成失败，已退款',
      );
      if (type === 'text')
        return {
          id: g.id,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: result.result_assets.map((a) => a.text || '').join('\n'),
              },
              finish_reason: 'stop',
            },
          ],
        };
      const data = await Promise.all(
        result.result_assets.map(async (asset) => {
          if (body.response_format === 'url') return { url: asset.url };
          const id = asset.url?.match(/\/uploads\/([^/?]+)/)?.[1];
          assert(id, 500, 'ASSET_MISSING', '结果文件不可用');
          return {
            b64_json: (await ctx.gateway.storage.read(id)).buffer.toString('base64'),
          };
        }),
      );
      return { created: Math.floor(Date.now() / 1000), data };
    });
  app.get<{ Params: { id: string } }>('/v1/videos/:id', async (req) => {
    const user = auth(req);
    const g = ctx.db.get<Generation>('generations', req.params.id);
    assert(g && g.user_id === user.id && g.type === 'video', 404, 'NOT_FOUND', '视频任务不存在');
    const data = freshGeneration(ctx, g);
    return {
      id: g.id,
      object: 'video',
      status: g.status === 'refunded' ? 'failed' : g.status,
      progress: g.progress,
      data: data.result_assets,
      error: g.error,
    };
  });
}
