const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');

const app = express();
const PORT = 3344;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Load provider config from OpenClaw ──
function loadProviders() {
  try {
    const cfg = JSON.parse(fs.readFileSync('/home/openclaw/.openclaw/openclaw.json', 'utf-8'));
    const raw = cfg.models?.providers || {};
    const modelAliases = cfg.agents?.defaults?.models || {};
    const providers = [];

    for (const [id, p] of Object.entries(raw)) {
      // Collect models for this provider from aliases
      const models = [];
      for (const [modelId, alias] of Object.entries(modelAliases)) {
        if (modelId.startsWith(id + '/')) {
          models.push({ id: modelId.replace(id + '/', ''), name: alias.alias || modelId });
        }
      }
      if (models.length > 0 || p.baseUrl) {
        providers.push({
          id,
          type: p.provider || id,
          baseUrl: p.baseUrl || '',
          apiKey: p.apiKey || '',
          headerKey: p.headerKey || p.header || 'Authorization',
          models
        });
      }
    }
    return providers;
  } catch (e) {
    console.error('Error loading providers:', e.message);
    return [];
  }
}

// ── Config endpoint (provides providers with keys to frontend) ──
app.get('/api/config', (req, res) => {
  res.json({ providers: loadProviders() });
});

// ── Test a single model ──
app.post('/api/test', async (req, res) => {
  const { provider, baseUrl, apiKey, model, headerKey, mode } = req.body;
  const start = Date.now();

  try {
    const isFull = mode === 'full';
    const messages = isFull
      ? [
          { role: 'system', content: 'Eres un asistente útil. Responde en español.' },
          { role: 'user', content: 'Explica en 2 frases qué es la fotosíntesis.' }
        ]
      : [{ role: 'user', content: 'Responde solo "OK"' }];

    const maxTokens = isFull ? 200 : 10;
    const payload = buildPayload(provider, model, messages, maxTokens);
    const result = await makeRequest(baseUrl, apiKey, headerKey, provider, payload, model);
    const elapsed = Date.now() - start;
    const bodyObj = safeParse(result.body);
    const tokens = extractTokens(bodyObj, provider);
    const content = extractContent(bodyObj, provider);
    const tps = isFull && tokens?.output_tokens && elapsed > 0
      ? (tokens.output_tokens / (elapsed / 1000)).toFixed(1)
      : null;

    res.json({
      ok: true,
      model,
      provider,
      status: result.status,
      elapsed,
      response: content,
      tokens,
      tps,
      mode: isFull ? 'full' : 'quick',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    res.json({
      ok: false,
      model,
      provider,
      elapsed,
      error: err.message,
      mode: req.body.mode || 'quick',
      timestamp: new Date().toISOString()
    });
  }
});

// ── Build request payload per provider ──
function buildPayload(provider, model, messages, maxTokens) {
  switch (provider) {
    case 'anthropic':
      return { model, max_tokens: maxTokens, messages };
    case 'google':
      return { model, max_tokens: maxTokens, messages };
    default:
      return { model, messages, max_tokens: maxTokens, stream: false };
  }
}

// ── Make HTTP request ──
function makeRequest(baseUrl, apiKey, headerKey, provider, payload, model) {
  return new Promise((resolve, reject) => {
    const timeout = 60000;
    let url, options, body;

    switch (provider) {
      case 'anthropic': {
        url = new URL('/v1/messages', baseUrl);
        body = JSON.stringify(payload);
        options = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          }
        };
        break;
      }
      case 'google': {
        url = new URL(`/v1beta/models/${model}:generateContent?key=${apiKey}`, baseUrl);
        const gPayload = {
          contents: payload.messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          generationConfig: { maxOutputTokens: payload.max_tokens }
        };
        body = JSON.stringify(gPayload);
        options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
        break;
      }
      default: {
        url = new URL('/api/chat', baseUrl);
        body = JSON.stringify(payload);
        const headers = { 'Content-Type': 'application/json' };
        if (headerKey && apiKey) headers[headerKey] = `Bearer ${apiKey}`;
        else if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        options = { method: 'POST', headers };
        break;
      }
    }

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout (60s)')); });
    req.write(body);
    req.end();
  });
}

function safeParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function extractTokens(body, provider) {
  if (!body) return null;
  if (provider === 'anthropic') return body.usage || null;
  if (provider === 'google') {
    const m = body.usageMetadata;
    return m ? { input_tokens: m.promptTokenCount, output_tokens: m.candidatesTokenCount } : null;
  }
  return body.usage || null;
}

function extractContent(body, provider) {
  if (!body) return '';
  try {
    if (provider === 'anthropic') return body.content?.[0]?.text || '';
    if (provider === 'google') return body.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return body.message?.content || body.choices?.[0]?.message?.content || '';
  } catch { return ''; }
}

// ── File explorer ──
const ALLOWED_DIRS = ['/'];  // Full server access
const MAX_FILE_SIZE = 512 * 1024;

app.get('/api/files', (req, res) => {
  const dir = req.query.dir || '/home';
  const isAllowed = ALLOWED_DIRS.some(d => dir.startsWith(d));
  if (!isAllowed) return res.status(403).json({ error: 'Access denied' });
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true })
      .map(d => ({ name: d.name, type: d.isDirectory() ? 'dir' : 'file', path: path.join(dir, d.name) }))
      .sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
    res.json({ dir, parent: path.dirname(dir), items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'No path' });
  const isAllowed = ALLOWED_DIRS.some(d => filePath.startsWith(d));
  if (!isAllowed) return res.status(403).json({ error: 'Access denied' });
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return res.status(400).json({ error: 'Is a directory' });
    if (stat.size > MAX_FILE_SIZE) return res.status(413).json({ error: 'File too large' });
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ path: filePath, size: stat.size, content });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── System info ──
app.get('/api/disk', (req, res) => {
  try {
    const { execSync } = require('child_process');
    const dfOutput = execSync("df -h / | tail -1").toString().trim().split(/\s+/);
    const disk = { used: dfOutput[2], total: dfOutput[1], avail: dfOutput[3], percent: dfOutput[4] };
    const totalMem = os.totalmem(), freeMem = os.freemem(), usedMem = totalMem - freeMem;
    const ram = {
      total: (totalMem / 1073741824).toFixed(1) + ' GB',
      used: (usedMem / 1073741824).toFixed(1) + ' GB',
      free: (freeMem / 1073741824).toFixed(1) + ' GB',
      percent: Math.round(usedMem / totalMem * 100) + '%'
    };
    const uptimeSec = os.uptime();
    const uptime = `${Math.floor(uptimeSec / 86400)}d ${Math.floor((uptimeSec % 86400) / 3600)}h`;
    res.json({ disk, ram, uptime });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`El Nido corriendo en http://localhost:${PORT}`);
});