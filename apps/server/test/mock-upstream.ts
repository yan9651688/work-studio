import { createServer, type IncomingMessage } from 'node:http';
import sharp from 'sharp';
export async function mockUpstream() {
  const png = (
    await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#237a50' },
    })
      .png()
      .toBuffer()
  ).toString('base64');
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const server = createServer(async (req, res) => {
    const body = await read(req);
    const path = req.url || '';
    calls.push({ path, body });
    res.setHeader('content-type', 'application/json');
    if (path.includes('/fail/')) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: { message: 'Simulated provider failure' } }));
      return;
    }
    if (path.endsWith('/models')) {
      res.end(JSON.stringify({ data: [{ id: 'test-image' }] }));
      return;
    }
    if (path.endsWith('/chat/completions')) {
      if (body.stream) {
        res.setHeader('content-type', 'text/event-stream');
        for (const content of ['这是一次', '已验证的', '模拟生成。']) {
          res.write(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
          );
          await new Promise((r) => setTimeout(r, 60));
        }
        res.write(
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 8 } })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
        return;
      }
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '这是一次已验证的模拟生成。',
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 8 },
        }),
      );
      return;
    }
    if (path.includes(':generateContent')) {
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: png } }],
              },
            },
          ],
        }),
      );
      return;
    }
    if (path === '/custom') {
      res.end(JSON.stringify({ output: { images: [{ base64: png }] } }));
      return;
    }
    if (path === '/jobs') {
      res.end(JSON.stringify({ task: 'job-1' }));
      return;
    }
    if (path === '/jobs/job-1') {
      res.end(JSON.stringify({ status: 'succeeded', result: [png] }));
      return;
    }
    res.end(JSON.stringify({ data: [{ b64_json: png }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
async function read(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}
