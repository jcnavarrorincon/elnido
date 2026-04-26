#!/usr/bin/env node
/**
 * El Nido - Calendar Daily Digest
 * Envía resumen de citas del día a las 6:00
 * Uso: node calendar-daily.js
 */

const https = require('https');
const http = require('http');

const ELNIDO_URL = process.env.ELNIDO_URL || 'http://localhost:3344';
const DIGEST_EMAIL = process.env.DIGEST_EMAIL || 'jcnavarrorincon@gmail.com';

// Simple HTTP GET request
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function main() {
  console.log('Sending daily calendar digest...');
  console.log(`To: ${DIGEST_EMAIL}`);

  try {
    const url = `${ELNIDO_URL}/api/calendar/digest?mode=daily&email=${encodeURIComponent(DIGEST_EMAIL)}`;
    const response = await httpGet(url);
    
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${response.body}`);
    }

    const result = JSON.parse(response.body);
    console.log(`Digest sent: ${result.eventCount} events`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
