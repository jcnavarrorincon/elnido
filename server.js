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

// ── Test a single model ──
app.post('/api/test', async (req, res) => {
  const { provider, baseUrl, apiKey, model, messages, headerKey } = req.body;
  const start = Date.now();

  try {
    const payload = buildPayload(provider, model, messages || [{ role: 'user', content: 'Responde solo "OK"' }]);

    const result = await makeRequest(baseUrl, apiKey, headerKey, provider, payload, model);
    const elapsed = Date.now() - start;

    res.json({
      ok: true,
      model,
      provider,
      status: result.status,
      elapsed,
      response: result.body,
      tokens: extractTokens(result.body, provider),
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
      timestamp: new Date().toISOString()
    });
  }
});

// ── Test all configured models ──
app.post('/api/test-all', async (req, res) => {
  const { providers } = req.body;
  const results = [];

  for (const p of providers) {
    for (const m of p.models) {
      const start = Date.now();
      try {
        const payload = buildPayload(p.providerType || p.id, m.id, [{ role: 'user', content: 'Responde solo "OK"' }]);
        const result = await makeRequest(p.baseUrl, p.apiKey, p.headerKey, p.providerType || p.id, payload, m.id);
        const elapsed = Date.now() - start;
        results.push({
          ok: true,
          model: m.id,
          name: m.name || m.id,
          provider: p.id,
          status: result.status,
          elapsed,
          tokens: extractTokens(result.body, p.providerType || p.id),
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        results.push({
          ok: false,
          model: m.id,
          name: m.name || m.id,
          provider: p.id,
          elapsed: Date.now() - start,
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  // Sort by speed
  results.sort((a, b) => a.elapsed - b.elapsed);
  res.json(results);
});

// ── History (in memory) ──
const history = [];
app.get('/api/history', (req, res) => res.json(history));
app.post('/api/history', (req, res) => { history.push(...req.body); res.json({ ok: true }); });

// ── Build request payload per provider ──
function buildPayload(provider, model, messages) {
  switch (provider) {
    case 'anthropic':
      return { model, max_tokens: 10, messages };
    case 'google':
      return { model, max_tokens: 10, messages };
    case 'ollama':
    case 'opencode-josecarlos':
    case 'opencode-argentia':
    case 'opencode-go':
      return { model, messages, max_tokens: 10, stream: false };
    default:
      return { model, messages, max_tokens: 10, stream: false };
  }
}

// ── Make HTTP request ──
function makeRequest(baseUrl, apiKey, headerKey, provider, payload, model) {
  return new Promise((resolve, reject) => {
    const timeout = 30000;
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
          contents: payload.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
        };
        body = JSON.stringify(gPayload);
        options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
        break;
      }
      default: {
        // ollama / opencode-go style
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
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout (30s)')); });
    req.write(body);
    req.end();
  });
}

function extractTokens(body, provider) {
  try {
    const j = JSON.parse(body);
    if (provider === 'anthropic') return j.usage;
    if (provider === 'google') return j.usageMetadata;
    return j.usage || null;
  } catch { return null; }
}

// ── File explorer ──
const ALLOWED_DIRS = ['/home', '/etc', '/var/log', '/tmp', '/opt'];
const MAX_FILE_SIZE = 512 * 1024; // 512KB max for file viewer

app.get('/api/files', (req, res) => {
  const dir = req.query.dir || '/home';
  // Security: only allow certain base dirs
  const isAllowed = ALLOWED_DIRS.some(d => dir.startsWith(d));
  if (!isAllowed) return res.status(403).json({ error: 'Access denied' });

  try {
    const items = fs.readdirSync(dir, { withFileTypes: true })
      .map(d => ({
        name: d.name,
        type: d.isDirectory() ? 'dir' : 'file',
        path: path.join(dir, d.name)
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ dir, parent: path.dirname(dir), items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── System info ──
app.get('/api/disk', (req, res) => {
  try {
    const { execSync } = require('child_process');
    const dfOutput = execSync("df -h / | tail -1").toString().trim().split(/\s+/);
    const disk = { used: dfOutput[2], total: dfOutput[1], avail: dfOutput[3], percent: dfOutput[4] };

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ram = {
      total: (totalMem / 1073741824).toFixed(1) + ' GB',
      used: (usedMem / 1073741824).toFixed(1) + ' GB',
      free: (freeMem / 1073741824).toFixed(1) + ' GB',
      percent: Math.round(usedMem / totalMem * 100) + '%'
    };

    const uptimeSec = os.uptime();
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const uptime = `${days}d ${hours}h`;

    res.json({ disk, ram, uptime });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Model Health dashboard on http://localhost:${PORT}`);
});