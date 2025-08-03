// server.js
const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = 3001;
const SECRET = 'ccfbb0be-6344-4cb4-82ef-8829936fbf78'; // SHA secret from OpenCRVS

app.use(express.json({ verify: rawBodySaver }));
function rawBodySaver(req, res, buf) {
  req.rawBody = buf;
}

// Signature verification
function verifySignature(req) {
  const signature = req.headers['x-hub-signature'];
  if (!signature) return false;

  const hmac = crypto.createHmac('sha1', SECRET);
  const digest = 'sha1=' + hmac.update(req.rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

app.post('/webhooks/birth', (req, res) => {
  if (!verifySignature(req)) {
    console.warn('❌ Invalid signature.');
    return res.status(401).send('Invalid signature');
  }

  console.log('✅ Webhook received:');
  console.dir(req.body, { depth: null });
  res.send('OK');
});

app.listen(PORT, () => {
  console.log(`🚀 Webhook server listening on http://localhost:${PORT}`);
});
