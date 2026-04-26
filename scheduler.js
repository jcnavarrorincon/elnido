#!/usr/bin/env node
/**
 * El Nido - Alert Scheduler (usando gog)
 * Revisa alertas pendientes y envía emails de notificación
 * Uso: node scheduler.js
 */

const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

const ELNIDO_URL = process.env.ELNIDO_URL || 'http://localhost:3344';
const FROM_EMAIL = process.env.FROM_EMAIL || 'kaelnoxbot@gmail.com';

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

// Simple HTTP POST request
function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const postData = JSON.stringify(data);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = client.request(url, options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: responseData }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

// Send email using gog CLI
function sendEmailWithGog(to, subject, body) {
  return new Promise((resolve, reject) => {
    const gog = spawn('gog', [
      'gmail', 'send',
      '--to', to,
      '--subject', subject,
      '--body', body
    ], {
      env: { ...process.env, HOME: '/home/openclaw' }
    });

    let stdout = '';
    let stderr = '';

    gog.stdout.on('data', (data) => { stdout += data; });
    gog.stderr.on('data', (data) => { stderr += data; });

    gog.on('close', (code) => {
      if (code === 0) {
        console.log(`Email sent via gog: ${subject}`);
        resolve({ success: true, output: stdout });
      } else {
        reject(new Error(`gog exited with code ${code}: ${stderr}`));
      }
    });

    gog.on('error', (err) => {
      reject(new Error(`Failed to spawn gog: ${err.message}`));
    });
  });
}

// Main function
async function main() {
  console.log('Checking for pending alerts...');
  console.log(`Using El Nido at: ${ELNIDO_URL}`);

  try {
    const response = await httpGet(`${ELNIDO_URL}/api/alerts/pending`);
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${response.body}`);
    }

    const alerts = JSON.parse(response.body);
    console.log(`Found ${alerts.length} pending alerts`);

    for (const alert of alerts) {
      try {
        const dateStr = alert.alert_date;
        const timeStr = alert.alert_time || '00:00';
        const subject = `🔔 ${alert.title}`;
        const body = `${alert.description || 'Sin descripción'}

Fecha: ${dateStr}
Hora: ${timeStr}

---
Alerta generada por El Nido`;

        await sendEmailWithGog(alert.email, subject, body);
        
        // Mark as notified
        await httpPost(`${ELNIDO_URL}/api/alerts/${alert.id}/mark-notified`, {});
        console.log(`Alert ${alert.id} marked as notified`);
      } catch (err) {
        console.error(`Failed to process alert ${alert.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
