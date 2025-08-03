const crypto = require('crypto');

// Test data (use the same body from your previous webhook)
const testBody = '{"timestamp":"2025-07-30T15:04:17.044Z","id":"c944d475-6028-4e1f-8f7e-6fee035e237d","event":{"hub":{"id":"test"}}}';
const receivedSignature = 'sha256=e9f6a0ad5fb678796a20911e6cf69bb81ec8633aaf99badcf1536a426e9b9707';

console.log('Testing secrets against received signature:', receivedSignature);

const testSecrets = [
  'df72e58b-1fc8-4241-8789-2a92ef6f9b37', // SHA secret
  '5608db69-9289-4cd5-82b2-4465982c78c2', // Client secret  
  '6c95aa24-0845-4178-912d-3d5a3522f9d0', // Client ID
  'CRVSWebhook',
  'webhook',
  'secret',
  ''
];

for (const secret of testSecrets) {
  const testSig = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(testBody)
    .digest('hex');
  
  console.log(`Secret: "${secret}" -> ${testSig}`);
  
  if (testSig === receivedSignature) {
    console.log('✅ MATCH FOUND! Secret is:', secret);
    break;
  }
}