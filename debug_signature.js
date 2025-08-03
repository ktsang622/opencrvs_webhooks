const express = require('express');
const crypto = require('crypto');
const app = express();

const SECRET = 'df72e58b-1fc8-4241-8789-2a92ef6f9b37';

// Test different body parsing methods
app.use('/webhooks', (req, res, next) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    req.rawBodyString = body;
    req.rawBodyBuffer = Buffer.from(body, 'utf8');
    next();
  });
});

app.post('/webhooks', (req, res) => {
  const receivedSig = req.headers['x-hub-signature'];
  console.log('Received signature:', receivedSig);
  
  // Test different body formats
  const tests = [
    { name: 'String as UTF8', body: Buffer.from(req.rawBodyString, 'utf8') },
    { name: 'Raw buffer', body: req.rawBodyBuffer },
    { name: 'String direct', body: req.rawBodyString },
    { name: 'Normalized JSON', body: JSON.stringify(JSON.parse(req.rawBodyString)) }
  ];
  
  for (const test of tests) {
    const testSig = 'sha256=' + crypto
      .createHmac('sha256', SECRET)
      .update(test.body)
      .digest('hex');
    
    console.log(`${test.name}: ${testSig}`);
    
    if (testSig === receivedSig) {
      console.log('✅ MATCH FOUND with:', test.name);
      res.status(200).send('OK');
      return;
    }
  }
  
  console.log('❌ No match found');
  res.status(200).send('OK');
});

app.listen(9999, () => console.log('🔍 Debug server running on port 9999'));