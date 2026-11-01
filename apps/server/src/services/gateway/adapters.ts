import { fetch, ProxyAgent, FormData, Agent } from 'undici';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Binding, Channel, Generation, ResultAsset } from '@studio/shared';
import type { Storage } from '../storage.js';
import { assert, decrypt, HttpError } from '../security.js';
import type { Config } from '../../config.js';

export interface AdapterContext {
  channel: Channel;
  binding: Binding;
  generation: Generation;
  storage: Storage;
  config: Config;
  signal: AbortSignal;
  onProgress: (progress: number) => void;
  onText?: (delta: string) => void;
}
export interface AdapterResult {
  assets: ResultAsset[];
  usage?: { input: number; output: number };
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
export function extract(input: unknown, path: string): unknown[] {
  const tokens = path
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+|\*)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let values = [input];
  for (const token of tokens) {
    values = values
      .flatMap((value) =>
        token === '*'
          ? Array.isArray(value)
            ? value
            : Object.values(obj(value))
          : [Array.isArray(value) ? value[Number(token)] : obj(value)[token]],
      )
      .filter((v) => v !== undefined);
  }
  return values;
}
export function template(value: unknown, vars: Obj): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{([\w.]+)\}\}$/);
    if (exact) return vars[exact[1]] ?? '';
    return value.replace(/\{\{([\w.]+)\}\}/g, (_, key) => String(vars[key] ?? ''));
  }
  if (Array.isArray(value)) return value.map((v) => template(v, vars));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, template(v, vars)]));
  return value;
}
async function upstream(ctx: AdapterContext, path: string, body?: unknown, method = 'POST') {
  const url = new URL(ctx.channel.base_url.replace(/\/$/, '') + '/' + path.replace(/^\//, ''));
  assert(
    ['http:', 'https:'].includes(url.protocol),
    400,
    'INVALID_URL',
    '渠道地址必须为 HTTP 或 HTTPS',
  );
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...ctx.channel.headers,
  };
  const key = decrypt(ctx.channel.api_key, ctx.config.secret);
  if (ctx.channel.provider_type === 'gemini') headers['x-goog-api-key'] = key;
  else if (key) headers.authorization = `Bearer ${key}`;
  const proxy = ctx.channel.proxy ? new ProxyAgent(ctx.channel.proxy) : undefined;
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctx.signal,
      dispatcher: proxy,
      redirect: 'error',
    });
    const text = await readLimited(res, 55 * 1024 * 1024);
    let json: unknown;
    try {
      json = JSON.parse(text.toString());
    } catch {
      throw new HttpError(502, 'UPSTREAM_INVALID', '上游没有返回有效 JSON');
    }
    if (!res.ok) throw new HttpError(502, 'UPSTREAM_ERROR', `上游请求失败（HTTP ${res.status}）`);
    return obj(json);
  } finally {
    await proxy?.close();
  }
}
async function readLimited(response: Awaited<ReturnType<typeof fetch>>, limit: number) {
  const chunks: Uint8Array[] = [];
  let length = 0;
  assert(
    Number(response.headers.get('content-length') || 0) <= limit,
    502,
    'UPSTREAM_TOO_LARGE',
    '上游结果过大',
  );
  assert(response.body, 502, 'EMPTY_RESULT', '上游返回空内容');
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) {
      await response.body.cancel().catch(() => {});
      throw new HttpError(502, 'UPSTREAM_TOO_LARGE', '上游结果过大');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function safeDownload(url: string, ctx: AdapterContext) {
  const parsed = new URL(url);
  assert(['http:', 'https:'].includes(parsed.protocol), 502, 'INVALID_ASSET_URL', '无效结果地址');
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true });
  const privateIp = (ip: string) => {
    if (isIP(ip) === 6) return !/^[23][0-9a-f]{3}:/i.test(ip);
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  };
  assert(
    ctx.config.testing || addresses.every((a) => !privateIp(a.address)),
    502,
    'INVALID_ASSET_URL',
    '上游结果地址不可指向内网',
  );
  const agent = new Agent({
    connect: {
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    },
  });
  try {
    const res = await fetch(parsed, {
      signal: ctx.signal,
      redirect: 'error',
      dispatcher: agent,
    });
    assert(res.ok, 502, 'DOWNLOAD_FAILED', '上游结果下载失败');
    return await readLimited(res, 50 * 1024 * 1024);
  } finally {
    await agent.close();
  }
}
async function saveValues(values: unknown[], ctx: AdapterContext): Promise<ResultAsset[]> {
  assert(values.length && values.length <= 10, 502, 'EMPTY_RESULT', '上游未返回生成结果');
  const assets: ResultAsset[] = [];
  for (const v of values) {
    if (ctx.generation.type === 'text') {
      const text = typeof v === 'string' ? v : String(obj(v).text || '');
      assert(text, 502, 'EMPTY_RESULT', '上游未返回文本');
      assets.push({ text });
      continue;
    }
    const value =
      typeof v === 'string' ? v : String(obj(v).url || obj(v).b64_json || obj(v).data || '');
    assert(value, 502, 'EMPTY_RESULT', '上游结果为空');
    const buffer = /^https?:\/\//.test(value)
      ? await safeDownload(value, ctx)
      : Buffer.from(value.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const asset = await ctx.storage.save(
      buffer,
      ctx.generation.user_id,
      ctx.generation.type === 'video' ? 'video' : 'image',
    );
    assets.push({
      url: asset.url,
      thumb_url: asset.thumb_url,
      mime: asset.mime,
    });
  }
  return assets;
}
export async function invoke(ctx: AdapterContext): Promise<AdapterResult> {
  const { generation: g, channel, binding } = ctx;
  const p = g.params;
  const dims: Record<string, string> = {
    '1:1': '1024x1024',
    '16:9': '1536x1024',
    '9:16': '1024x1536',
    '3:2': '1536x1024',
    '3:4': '1024x1536',
    '21:9': '1792x768',
  };
  const baseSize = dims[p.ratio || '1:1'] || '1024x1024';
  const scale = p.resolution === '4K' ? 4 : p.resolution === '2K' ? 2 : 1;
  const size = baseSize
    .split('x')
    .map((v) => Number(v) * scale)
    .join('x');
  const mappedParams = obj(
    template(binding.param_mapping, {
      prompt: g.prompt,
      model: binding.upstream_model,
      size,
      ratio: p.ratio || '1:1',
      resolution: p.resolution || '1K',
      quality: p.quality || 'standard',
      duration: p.duration || 5,
    }),
  );
  const images = await Promise.all(
    g.reference_assets.map(async (id) => {
      const { buffer, asset } = await ctx.storage.read(id);
      return { mime: asset.mime, base64: buffer.toString('base64') };
    }),
  );
  if (channel.provider_type === 'openai') {
    if (g.type === 'text') {
      if (p.stream) return streamText(ctx);
      const result = await upstream(ctx, 'chat/completions', {
        ...binding.param_mapping,
        model: binding.upstream_model,
        messages: p.messages || [{ role: 'user', content: g.prompt }],
        max_tokens: p.max_tokens || 2048,
        stream: false,
      });
      const content = extract(result, 'choices[0].message.content');
      const usage = obj(result.usage);
      return {
        assets: await saveValues(content, ctx),
        usage: result.usage
          ? {
              input: Number(usage.prompt_tokens || 0),
              output: Number(usage.completion_tokens || 0),
            }
          : undefined,
      };
    }
    assert(g.type === 'image', 400, 'UNSUPPORTED_PROTOCOL', '视频模型请使用自定义 HTTP 渠道');
    let result: Obj;
    if (images.length) {
      const form = new FormData();
      form.set('model', binding.upstream_model);
      form.set('prompt', g.prompt);
      form.set('size', size);
      for (const [i, img] of images.entries())
        form.append(
          images.length === 1 ? 'image' : 'image[]',
          new Blob([new Uint8Array(Buffer.from(img.base64, 'base64'))], {
            type: img.mime,
          }),
          `reference-${i}.png`,
        );
      for (const [key, value] of Object.entries(mappedParams)) form.set(key, String(value));
      const response = await fetch(channel.base_url.replace(/\/$/, '') + '/images/edits', {
        method: 'POST',
        headers: {
          ...channel.headers,
          authorization: `Bearer ${decrypt(channel.api_key, ctx.config.secret)}`,
        },
        body: form,
        signal: ctx.signal,
        redirect: 'error',
      });
      assert(response.ok, 502, 'UPSTREAM_ERROR', `上游编辑请求失败（HTTP ${response.status}）`);
      result = JSON.parse((await readLimited(response, 55 * 1024 * 1024)).toString());
    } else
      result = await upstream(ctx, 'images/generations', {
        ...binding.param_mapping,
        model: binding.upstream_model,
        prompt: g.prompt,
        n: 1,
        size,
        ...(p.quality ? { quality: p.quality } : {}),
        ...mappedParams,
      });
    return {
      assets: await saveValues(Array.isArray(result.data) ? result.data : [], ctx),
    };
  }
  if (channel.provider_type === 'gemini') {
    const parts: unknown[] = [
      { text: g.prompt },
      ...images.map((image) => ({
        inline_data: { mime_type: image.mime, data: image.base64 },
      })),
    ];
    const result = await upstream(
      ctx,
      `models/${encodeURIComponent(binding.upstream_model)}:generateContent`,
      {
        ...binding.param_mapping,
        contents: [{ role: 'user', parts }],
        generationConfig:
          g.type === 'text'
            ? { maxOutputTokens: p.max_tokens || 2048 }
            : {
                responseModalities: ['TEXT', 'IMAGE'],
                imageConfig: {
                  aspectRatio: p.ratio || '1:1',
                  imageSize: p.resolution || '1K',
                },
              },
      },
    );
    const partsOut = extract(result, 'candidates[0].content.parts[*]');
    const values =
      g.type === 'text'
        ? partsOut.map((v) => obj(v).text).filter(Boolean)
        : partsOut.map((v) => obj(obj(v).inlineData || obj(v).inline_data).data).filter(Boolean);
    return { assets: await saveValues(values, ctx) };
  }
  const cfg = channel.config;
  const vars = {
    prompt: g.prompt,
    model: binding.upstream_model,
    size,
    ratio: p.ratio || '1:1',
    resolution: p.resolution || '1K',
    duration: p.duration || 5,
    images: images.map((i) => `data:${i.mime};base64,${i.base64}`),
    ...p,
  };
  assert(
    typeof cfg.path === 'string' && typeof cfg.response_path === 'string',
    400,
    'CUSTOM_CONFIG_MISSING',
    '自定义渠道需要 path、body 和 response_path',
  );
  let result = await upstream(
    ctx,
    String(template(cfg.path, vars)),
    template(cfg.body || { prompt: '{{prompt}}', model: '{{model}}' }, vars),
    String(cfg.method || 'POST'),
  );
  if (cfg.task_id_path && cfg.poll_path) {
    const taskId = extract(result, String(cfg.task_id_path))[0];
    assert(taskId, 502, 'TASK_ID_MISSING', '上游未返回任务 ID');
    for (let attempt = 0; attempt < 180; attempt++) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(ctx.signal.reason);
        };
        const timer = setTimeout(() => {
          ctx.signal.removeEventListener('abort', abort);
          resolve();
        }, 1000);
        if (ctx.signal.aborted) abort();
        else ctx.signal.addEventListener('abort', abort, { once: true });
      });
      result = await upstream(
        ctx,
        String(template(cfg.poll_path, { ...vars, task_id: taskId })),
        undefined,
        'GET',
      );
      const status = extract(result, String(cfg.status_path || 'status'))[0];
      if (status === (cfg.success_value || 'succeeded')) break;
      assert(status !== (cfg.error_value || 'failed'), 502, 'UPSTREAM_TASK_FAILED', '上游任务失败');
      ctx.onProgress(Math.min(90, 10 + attempt));
      assert(attempt < 179, 504, 'UPSTREAM_TIMEOUT', '等待上游任务超时');
    }
  }
  return {
    assets: await saveValues(extract(result, String(cfg.response_path)), ctx),
  };
}
export async function testChannel(channel: Channel, secret: string) {
  const key = decrypt(channel.api_key, secret);
  const url = channel.base_url.replace(/\/$/, '') + '/models';
  const headers = {
    ...channel.headers,
    ...(channel.provider_type === 'gemini'
      ? { 'x-goog-api-key': key }
      : { authorization: `Bearer ${key}` }),
  };
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(Math.min(channel.timeout_ms || 10000, 20000)),
    redirect: 'error',
  });
  await res.body?.cancel();
  return { ok: res.ok, status: res.status };
}

async function streamText(ctx: AdapterContext): Promise<AdapterResult> {
  const { generation: g, channel, binding } = ctx;
  const proxy = channel.proxy ? new ProxyAgent(channel.proxy) : undefined;
  try {
    const response = await fetch(channel.base_url.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        ...channel.headers,
        'content-type': 'application/json',
        authorization: `Bearer ${decrypt(channel.api_key, ctx.config.secret)}`,
      },
      body: JSON.stringify({
        ...binding.param_mapping,
        model: binding.upstream_model,
        messages: g.params.messages || [{ role: 'user', content: g.prompt }],
        max_tokens: g.params.max_tokens || 2048,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: ctx.signal,
      redirect: 'error',
      dispatcher: proxy,
    });
    assert(
      response.ok && response.body,
      502,
      'UPSTREAM_ERROR',
      `上游流式请求失败（HTTP ${response.status}）`,
    );
    const decoder = new TextDecoder();
    let pending = '',
      text = '',
      complete = false;
    let usage: AdapterResult['usage'];
    const parse = (line: string) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        complete = true;
        return;
      }
      if (!payload) return;
      const chunk = JSON.parse(payload) as Obj;
      assert(!chunk.error, 502, 'UPSTREAM_ERROR', '上游流式任务失败');
      const delta = extract(chunk, 'choices[0].delta.content')[0];
      if (typeof delta === 'string') {
        text += delta;
        assert(text.length <= 2_000_000, 502, 'RESULT_TOO_LARGE', '上游文本过长');
        ctx.onText?.(delta);
      }
      if (chunk.usage) {
        const u = obj(chunk.usage);
        usage = { input: Number(u.prompt_tokens || 0), output: Number(u.completion_tokens || 0) };
      }
    };
    for await (const bytes of response.body) {
      pending += decoder.decode(bytes, { stream: true });
      assert(pending.length <= 2_000_000, 502, 'RESULT_TOO_LARGE', '上游流式内容过长');
      let index: number;
      while ((index = pending.indexOf('\n')) >= 0) {
        parse(pending.slice(0, index).replace(/\r$/, ''));
        pending = pending.slice(index + 1);
      }
    }
    pending += decoder.decode();
    if (pending.trim()) parse(pending.trim());
    assert(complete && text, 502, 'INCOMPLETE_STREAM', '上游文本流中断，积分已退回');
    return { assets: [{ text }], usage };
  } finally {
    await proxy?.close();
  }
}
