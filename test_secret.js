const crypto = require('crypto');
const fs = require('fs');

// Save the last received body for testing
let lastBody = null;

const express = require('express');
const bodyParser = require('body-parser');
const app = express();

app.use('/webhooks', bodyParser.raw({
  type: 'application/json',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.post('/webhooks', (req, res) => {
  const receivedSig = req.headers['x-hub-signature'];
  const rawBody = req.rawBody;
  
  console.log('Received signature:', receivedSig);
  
  // Test common secrets
  const testSecrets = [
    'df72e58b-1fc8-4241-8789-2a92ef6f9b37', // SHA secret
    '5608db69-9289-4cd5-82b2-4465982c78c2', // Client secret
    '6c95aa24-0845-4178-912d-3d5a3522f9d0', // Client ID
    'CRVSWebhook', // Service name
    '', // Empty string
    'webhook', // Common default
    'secret' // Common default
  ];
  
  for (const secret of testSecrets) {
    const testSig = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    
    if (testSig === receivedSig) {
      console.log('✅ FOUND MATCHING SECRET:', secret);
      res.status(200).send('OK');
      return;
    }
  }
  
  console.log('❌ No matching secret found');
  res.status(200).send('OK');
});

app.listen(9999, () => {
  console.log('🔍 Secret testing server running on port 9999');
});