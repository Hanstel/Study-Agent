import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = resolve(__dirname, 'public');
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

function getContentType(filePath) {
  return mimeTypes[extname(filePath)] || 'application/octet-stream';
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function buildCozePayload(message, sessionId, projectId) {
  return {
    content: {
      query: {
        prompt: [{ type: 'text', content: { text: message } }]
      }
    },
    type: 'query',
    session_id: sessionId,
    project_id: projectId
  };
}

async function handleCozeStream(req, res, body) {
  const message = body?.message || '请给我一个 25 分钟的沉浸式学习计划。';
  const sessionId = body?.session_id || process.env.COZE_SESSION_ID || '0krHqkB4ygbq2bbZ1z6Oa';
  const projectId = body?.project_id || process.env.COZE_PROJECT_ID || '7665321232279011382';
  const token = process.env.COZE_BEARER_TOKEN;
  const useMock = body?.use_mock || process.env.COZE_USE_MOCK === 'true';

  if (!token && !useMock) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const fallback = [
      `data: ${JSON.stringify({ text: '当前未配置 Coze Token，已切换本地模拟模式。' })}\n\n`,
      `data: ${JSON.stringify({ text: '我们先演示一下专注模式与任务渲染能力。' })}\n\n`
    ];
    for (const frame of fallback) {
      res.write(frame);
    }
    res.end();
    return;
  }

  if (useMock || !token) {
    const mockFrames = [
      `data: ${JSON.stringify({ text: '我已经为你准备好了一个可运行的沉浸学习场景。' })}\n\n`,
      `data: ${JSON.stringify({ text: '你可以在右侧看到倒计时、任务清单与成就弹窗。' })}\n\n`,
      `data: ${JSON.stringify({ text: '```json\n{"action":"START_TIMER","payload":{"minutes":25,"task_name":"阅读论文"}}\n```' })}\n\n`,
      `data: ${JSON.stringify({ text: '```json\n{"action":"ENTER_FOCUS_MODE","payload":{"enable_fullscreen":true,"audio_bgm":"rain"}}\n```' })}\n\n`,
      `data: ${JSON.stringify({ text: '```json\n{"action":"RENDER_TODOS","payload":{"todos":[{"title":"阅读摘要","done":false},{"title":"整理笔记","done":false}]}}\n```' })}\n\n`,
      `data: ${JSON.stringify({ text: '```json\n{"action":"TRIGGER_AWARD","payload":{"badge_title":"专注先锋","message":"你已经完成了第一个沉浸学习回合。"}}\n```' })}\n\n`,
      `data: ${JSON.stringify({ text: '这段内容是为了演示协议解析器如何自动触发页面动作。' })}\n\n`
    ];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    for (const frame of mockFrames) {
      res.write(frame);
    }
    res.end();
    return;
  }

  const url = process.env.COZE_STREAM_URL || 'https://4tnhc4zq9g.coze.site/stream_run';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify(buildCozePayload(message, sessionId, projectId))
  });

  if (!response.ok) {
    const errorText = await response.text();
    res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Coze request failed', detail: errorText }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const reader = response.body?.getReader();
  if (!reader) {
    res.end();
    return;
  }

  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    res.write(decoder.decode(value, { stream: true }));
  }
  res.end();
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'GET' && requestUrl.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', service: 'coze-study-agent' }));
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/coze/stream') {
    const body = await readRequestBody(req);
    await handleCozeStream(req, res, body);
    return;
  }

  const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const filePath = join(publicDir, pathname);

  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': getContentType(filePath),
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache'
    });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
