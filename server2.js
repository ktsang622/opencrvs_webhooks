const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const { processWebhookToBirthRegistration } = require('./webhookProcessor.js');
const { insertIntoDatabase } = require('./database.js');
const app = express();

const PORT = process.env.PORT || 9999;
const SHARED_SECRET = process.env.WEBHOOK_SECRET || 'df72e58b-1fc8-4241-8789-2a92ef6f9b37';

// Capture raw body for HMAC verification
app.use('/webhooks', (req, res, next) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    req.rawBodyString = body;
    next();
  });
});

app.post('/webhooks', async (req, res) => {
  const signatureHeader =
    req.headers['x-hub-signature-256'] ||
    req.headers['x-hub-signature'] ||
    req.headers['x-signature'] ||
    req.headers['signature'];

  if (!signatureHeader) {
    console.log('❌ Missing signature header');
    return res.status(400).send('Missing signature');
  }

  // The webhook service signs the URL-encoded body with 'sha256:' prefix
  const dataToSign = 'sha256:' + encodeURIComponent(req.rawBodyString);
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', SHARED_SECRET)
    .update(dataToSign)
    .digest('hex');
  
  console.log('Data to sign:', dataToSign.substring(0, 100) + '...');
  console.log('Expected sig:', expectedSignature);

  if (signatureHeader === expectedSignature) {
    console.log('✅ Valid signature');
  } else {
    console.log('❌ Signature mismatch');
    console.log('Expected:', expectedSignature);
    console.log('Received:', signatureHeader);
    return res.status(401).send('Invalid signature');
  }

  // Parse and process webhook data
  try {
    const parsedBody = JSON.parse(decodeURIComponent(req.rawBodyString));
    const eventType = parsedBody.event?.hub?.topic || 'Unknown';
    const eventId = parsedBody.id;
    const timestamp = parsedBody.timestamp;
    
    console.log('✅ Webhook Event Received:');
    console.log('  Type:', eventType);
    console.log('  ID:', eventId);
    console.log('  Time:', timestamp);
    
    console.log('\n📋 FULL WEBHOOK PAYLOAD:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(parsedBody, null, 2));
    console.log('='.repeat(80));
    
    // Process the webhook data
    if (eventType === 'BIRTH_REGISTERED') {
      console.log('\n🔄 Processing birth registration...');
      
      try {
        const sqlPayloads = await processWebhookToBirthRegistration(parsedBody);
        
        console.log('\n💾 DATABASE INSERT SUMMARY:');
        console.log('============================');
        console.log('- Child person: 1 INSERT');
        console.log('- Birth event: 1 INSERT');
        console.log('- Participants:', sqlPayloads.participantPayloads.length, 'INSERTs');
        console.log('- New persons:', sqlPayloads.newPersons.length, 'INSERTs');
        console.log('- New events:', sqlPayloads.newEvents.length, 'INSERTs');
        console.log('- New participants:', sqlPayloads.newParticipants.length, 'INSERTs');
        console.log('- Total INSERTs:', (1 + 1 + sqlPayloads.participantPayloads.length + sqlPayloads.newPersons.length + sqlPayloads.newEvents.length + sqlPayloads.newParticipants.length));
        
        console.log('\n📋 RECORD DETAILS:');
        console.log('- Child:', sqlPayloads.personPayload.given_name, sqlPayloads.personPayload.family_name);
        console.log('- Registration ID:', sqlPayloads.eventPayload.metadata ? JSON.parse(sqlPayloads.eventPayload.metadata).registrationNumber : 'N/A');
        console.log('- Event UUID:', sqlPayloads.eventPayload.crvs_event_uuid);
        
        // Sequential database insertion
        console.log('\n🔄 Starting sequential database insertion...');
        
        // 1. Insert new persons first
        if (sqlPayloads.newPersons.length > 0) {
          console.log('📝 Inserting', sqlPayloads.newPersons.length, 'new persons...');
          for (const personPayload of sqlPayloads.newPersons) {
            await insertIntoDatabase({ personPayload, eventPayload: null, participantPayloads: [], newPersons: [], newEvents: [] });
          }
        }
        
        // 2. Insert new events for new persons
        if (sqlPayloads.newEvents.length > 0) {
          console.log('📝 Inserting', sqlPayloads.newEvents.length, 'new events...');
          for (const eventPayload of sqlPayloads.newEvents) {
            await insertIntoDatabase({ personPayload: null, eventPayload, participantPayloads: [], newPersons: [], newEvents: [] });
          }
        }
        
        // 3. Insert new participants for new persons
        if (sqlPayloads.newParticipants.length > 0) {
          console.log('📝 Inserting', sqlPayloads.newParticipants.length, 'new participants...');
          for (const participantPayload of sqlPayloads.newParticipants) {
            await insertIntoDatabase({ personPayload: null, eventPayload: null, participantPayloads: [participantPayload], newPersons: [], newEvents: [] });
          }
        }
        
        // 4. Insert main child person
        console.log('📝 Inserting main child person...');
        await insertIntoDatabase({ personPayload: sqlPayloads.personPayload, eventPayload: null, participantPayloads: [], newPersons: [], newEvents: [] });
        
        // 5. Insert birth event
        console.log('📝 Inserting birth event...');
        await insertIntoDatabase({ personPayload: null, eventPayload: sqlPayloads.eventPayload, participantPayloads: [], newPersons: [], newEvents: [] });
        
        // 6. Insert all participants
        if (sqlPayloads.participantPayloads.length > 0) {
          console.log('📝 Inserting', sqlPayloads.participantPayloads.length, 'participants...');
          for (const participantPayload of sqlPayloads.participantPayloads) {
            await insertIntoDatabase({ personPayload: null, eventPayload: null, participantPayloads: [participantPayload], newPersons: [], newEvents: [] });
          }
        }
        
        console.log('\n✅ Database insertion completed successfully');
        
        // Update OpenSearch index (full reindex for now)
        try {
          console.log('\n🔍 Updating OpenSearch index...');
          
          const indexResponse = await fetch('http://localhost:3888/api/opensearch/index-person-db', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            }
          });
          
          if (indexResponse.ok) {
            console.log('✅ OpenSearch index updated successfully');
          } else {
            console.log('⚠️ OpenSearch index update failed:', indexResponse.status);
          }
        } catch (indexError) {
          console.log('⚠️ OpenSearch index update error:', indexError.message);
        }
      } catch (error) {
        console.log('❌ Failed to process webhook:', error.message);
      }
    }
  } catch (err) {
    console.log('⚠️ Failed to process webhook:', err.message);
  }

  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`✅ Webhook listener running on http://localhost:${PORT}/webhooks`);
});
