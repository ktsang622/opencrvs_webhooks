const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  user: process.env.DB_USER || 'registry_user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'person_registry',
  password: process.env.DB_PASSWORD || 'registry_pass',
  port: process.env.DB_PORT || 5432,
});

async function insertIntoDatabase(sqlPayloads) {
  const client = await pool.connect();
  
  try {
    // Insert person if provided
    if (sqlPayloads.personPayload) {
      await client.query(`
        INSERT INTO person (id, given_name, family_name, gender, dob, place_of_birth, place_of_birth_uuid, identifiers, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO NOTHING
      `, [
        sqlPayloads.personPayload.id, sqlPayloads.personPayload.given_name, sqlPayloads.personPayload.family_name,
        sqlPayloads.personPayload.gender, sqlPayloads.personPayload.dob, sqlPayloads.personPayload.place_of_birth,
        sqlPayloads.personPayload.place_of_birth_uuid, sqlPayloads.personPayload.identifiers, sqlPayloads.personPayload.status,
        sqlPayloads.personPayload.created_at, sqlPayloads.personPayload.updated_at
      ]);
    }
    
    // Insert event if provided
    if (sqlPayloads.eventPayload) {
      await client.query(`
        INSERT INTO event (id, event_type, event_date, location, source, metadata, crvs_event_uuid, duplicates, status, last_update_at, remarks, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO NOTHING
      `, [
        sqlPayloads.eventPayload.id, sqlPayloads.eventPayload.event_type, sqlPayloads.eventPayload.event_date,
        sqlPayloads.eventPayload.location, sqlPayloads.eventPayload.source, sqlPayloads.eventPayload.metadata,
        sqlPayloads.eventPayload.crvs_event_uuid, sqlPayloads.eventPayload.duplicates, sqlPayloads.eventPayload.status,
        sqlPayloads.eventPayload.last_update_at, sqlPayloads.eventPayload.remarks, sqlPayloads.eventPayload.created_at
      ]);
    }
    
    // Insert participants if provided
    if (sqlPayloads.participantPayloads && sqlPayloads.participantPayloads.length > 0) {
      for (const participant of sqlPayloads.participantPayloads) {
        await client.query(`
          INSERT INTO event_participant (id, person_id, event_id, role, relationship_details, crvs_person_id, status, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO NOTHING
        `, [
          participant.id, participant.person_id, participant.event_id, participant.role,
          participant.relationship_details, participant.crvs_person_id, participant.status, participant.created_at
        ]);
      }
    }
    
  } catch (error) {
    console.error('❌ Database insertion failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { insertIntoDatabase };