const express = require('express');
const path = require('path');
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Model Health dashboard on http://localhost:${PORT}`);
});