#!/usr/bin/env node
/**
 * El Nido - Alert Scheduler
 * Revisa alertas pendientes y envía emails de notificación
 * Uso: node scheduler.js
 */

const https = require('https');
const http = require('http');

const ELNIDO_URL = process.env.ELNIDO_URL || 'http://localhost:3344';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

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

// Send email using Nodemailer (via child_process to avoid bundling)
async function sendEmail(to, subject, body) {
  const nodemailer = require('nodemailer');
  
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  const info = await transporter.sendMail({
    from: `"El Nido" <${FROM_EMAIL}>`,
    to,
    subject,
    text: body,
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:20px auto;padding:20px;background:#1a1d27;color:#e0e0e0;border-radius:10px;">
      <h2 style="color:#6a9f60;margin-top:0;">🔔 Alerta de El Nido</h2>
      <p>${body.replace(/\n/g, '<br>')}</p>
      <hr style="border-color:#333;margin:20px 0;">
      <p style="color:#888;font-size:0.85rem;">Gestor Personal — El Nido</p>
    </div>`
  });

  console.log(`Email sent: ${info.messageId}`);
  return info;
}

// Main function
async function main() {
  console.log('Checking for pending alerts...');
  
  if (!SMTP_USER || !SMTP_PASS) {
    console.error('Error: SMTP_USER and SMTP_PASS environment variables required');
    console.log('Set them in /home/openclaw/.openclaw/elnido.env or export them');
    process.exit(1);
  }

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
        const body = `${alert.title}

${alert.description || 'Sin descripción'}

Fecha: ${dateStr}
Hora: ${timeStr}

---
Alerta generada por El Nido`;

        await sendEmail(alert.email, `🔔 ${alert.title}`, body);
        
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

// Check if nodemailer is installed
try {
  require('nodemailer');
  main();
} catch (err) {
  console.error('nodemailer not installed. Run: npm install nodemailer');
  console.error('Or add to package.json dependencies');
  process.exit(1);
}
