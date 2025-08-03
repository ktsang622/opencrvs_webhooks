const crypto = require('crypto');



const buildCRVSIdentifier = (id, eventType) => ({ type: 'crvs', value: id, event: eventType });

function extractPersonData(entries, resourceType, condition) {
  const resource = entries.find(e => 
    e.resource?.resourceType === resourceType && condition(e.resource)
  )?.resource;
  
  if (!resource) return null;
  
  return {
    id: resource.id,
    name: resource.name || [],
    gender: resource.gender,
    birthDate: resource.birthDate,
    identifier: resource.identifier || []
  };
}

async function processWebhookToBirthRegistration(webhookBody) {
  const entries = webhookBody?.event?.context?.[0]?.entry || [];
  const now = new Date().toISOString();
  
  // Extract resources
  const task = entries.find(e => e.resource?.resourceType === 'Task')?.resource;
  const composition = entries.find(e => e.resource?.resourceType === 'Composition')?.resource;
  
  // If composition not in entries, extract ID from task focus reference
  const compositionId = composition?.id || task?.focus?.reference?.split('/')?.[1];
  const child = entries.find(e => 
    e.resource?.resourceType === 'Patient' && 
    e.resource?.identifier?.some(id => id.type?.coding?.some(c => c.code === 'BIRTH_REGISTRATION_NUMBER'))
  )?.resource;
  
  const motherRelation = entries.find(e => 
    e.resource?.resourceType === 'RelatedPerson' && 
    e.resource.relationship?.coding?.some(c => c.code === 'MOTHER')
  )?.resource;
  
  const mother = motherRelation ? entries.find(e => 
    e.resource?.resourceType === 'Patient' && 
    e.resource?.id === motherRelation.patient?.reference?.split('/')?.[1]
  )?.resource : null;
  
  const fatherRelation = entries.find(e => 
    e.resource?.resourceType === 'RelatedPerson' && 
    e.resource.relationship?.coding?.some(c => c.code === 'FATHER')
  )?.resource;
  
  const father = fatherRelation ? entries.find(e => 
    e.resource?.resourceType === 'Patient' && 
    e.resource?.id === fatherRelation.patient?.reference?.split('/')?.[1]
  )?.resource : null;

  if (!child || !task || !mother || !compositionId) {
    throw new Error('Missing required data: child, task, mother, or composition ID');
  }

  // Extract registration details
  const registrationNumber = task.identifier?.find(id => 
    id.system === 'http://opencrvs.org/specs/id/birth-registration-number'
  )?.value || 'UNKNOWN';
  
  const trackingId = task.identifier?.find(id => 
    id.system === 'http://opencrvs.org/specs/id/birth-tracking-id'
  )?.value;

  // Build SQL payloads
  const localChildId = crypto.randomUUID();
  const localEventId = crypto.randomUUID();
  
  // Extract local UUIDs from webhook or generate new ones
  const localMotherId = mother.localId || crypto.randomUUID();
  const shouldInsertMother = !mother.localId; // New record if no localId in webhook
  
  let localFatherId = null;
  let shouldInsertFather = false;
  if (father) {
    localFatherId = father.localId || crypto.randomUUID();
    shouldInsertFather = !father.localId; // New record if no localId in webhook
  }

  // Child identifiers
  const childIdentifiers = [
    { type: 'NATIONAL_ID', value: registrationNumber },
    buildCRVSIdentifier(child.id, 'birth'),
    ...child.identifier.filter(i => i.value?.trim()).map(i => ({
      type: i.type?.coding?.[0]?.code || 'UNKNOWN',
      value: i.value
    }))
  ];

  // Main child person record
  const personPayload = {
    id: localChildId,
    given_name: child.name[0]?.given?.filter(n => n).join(' ') || '',
    family_name: child.name[0]?.family || '',
    gender: child.gender || '',
    dob: child.birthDate || null,
    place_of_birth: 'Unknown',
    identifiers: JSON.stringify(childIdentifiers),
    status: 'active',
    created_at: now,
    updated_at: now
  };

  // Birth registration event record
  const eventPayload = {
    id: localEventId,
    event_type: 'birth',
    event_date: task.lastModified || webhookBody.timestamp || now, // Registration date
    location: 'Unknown',
    source: 'OpenCRVS',
    metadata: JSON.stringify({ 
      trackingId,
      registrationNumber,
      crvsTaskId: task.id,
      childBirthDate: child.birthDate // Store actual birth date in metadata
    }),
    crvs_event_uuid: compositionId,
    duplicates: null,
    status: task.businessStatus?.coding?.[0]?.code || null,
    last_update_at: task.lastModified || null,
    created_at: now
  };

  // Extract informant
  const informantRelation = entries.find(e => 
    e.resource?.resourceType === 'RelatedPerson' && 
    e.resource.relationship?.coding?.some(c => c.code === 'INFORMANT')
  )?.resource;
  
  const informantPatientId = informantRelation?.patient?.reference?.split('/')?.[1];
  const isMotherInformant = informantPatientId === mother.id;
  const isFatherInformant = father && informantPatientId === father.id;
  const isOtherInformant = informantPatientId && !isMotherInformant && !isFatherInformant;
  
  // Get informant patient if it's someone else
  const informantPatient = isOtherInformant ? entries.find(e => 
    e.resource?.resourceType === 'Patient' && 
    e.resource?.id === informantPatientId
  )?.resource : null;

  // Event participants
  const participantPayloads = [
    {
      id: crypto.randomUUID(),
      person_id: localChildId,
      event_id: localEventId,
      role: 'subject',
      relationship_details: JSON.stringify({ type: 'child' }),
      crvs_person_id: child.id,
      status: 'active',
      created_at: now
    },
    {
      id: crypto.randomUUID(),
      person_id: localMotherId,
      event_id: localEventId,
      role: 'mother',
      relationship_details: JSON.stringify({ 
        type: 'mother', 
        relationship: 'MOTHER',
        ...(isMotherInformant && { informantType: 'MOTHER' })
      }),
      crvs_person_id: mother.id,
      status: 'active',
      remarks: shouldInsertMother ? 'New person created from CRVS webhook' : null,
      created_at: now
    }
  ];

  if (father && localFatherId) {
    participantPayloads.push({
      id: crypto.randomUUID(),
      person_id: localFatherId,
      event_id: localEventId,
      role: 'father',
      relationship_details: JSON.stringify({ 
        type: 'father', 
        relationship: 'FATHER',
        ...(isFatherInformant && { informantType: 'FATHER' })
      }),
      crvs_person_id: father.id,
      status: 'active',
      remarks: shouldInsertFather ? 'New person created from CRVS webhook' : null,
      created_at: now
    });
  }

  // Add other informant if exists
  if (isOtherInformant && informantPatient) {
    const informantLocalId = informantPatient.localId || crypto.randomUUID();
    const shouldInsertInformant = !informantPatient.localId; // New record if no localId in webhook
    const informantRelationshipType = informantRelation.relationship?.coding?.find(c => c.code !== 'INFORMANT')?.code || 'OTHER';
    
    participantPayloads.push({
      id: crypto.randomUUID(),
      person_id: informantLocalId,
      event_id: localEventId,
      role: 'informant',
      relationship_details: JSON.stringify({ 
        type: 'informant', 
        relationship: informantRelationshipType,
        informantType: informantRelationshipType
      }),
      crvs_person_id: informantPatient.id,
      status: 'active',
      remarks: shouldInsertInformant ? 'New person created from CRVS webhook' : null,
      created_at: now
    });
    
    // Add informant to newPersons if they don't exist
    if (shouldInsertInformant) {
      newPersons.push({
        id: informantLocalId,
        given_name: informantPatient.name?.[0]?.given?.filter(n => n).join(' ') || '',
        family_name: informantPatient.name?.[0]?.family || '',
        gender: informantPatient.gender || '',
        dob: informantPatient.birthDate || null,
        place_of_birth: 'Unknown',
        identifiers: JSON.stringify([
          buildCRVSIdentifier(informantPatient.id, 'birth'),
          ...(informantPatient.identifier || []).filter(i => i.value?.trim()).map(i => ({
            type: i.type?.coding?.[0]?.code || 'UNKNOWN',
            value: i.value
          }))
        ]),
        status: 'review',
        created_at: now,
        updated_at: now
      });
    }
  }

  // New persons to create
  const newPersons = [];
  const newEvents = [];
  const newParticipants = [];

  if (shouldInsertMother) {
    const motherBirthEventId = crypto.randomUUID();
    
    newPersons.push({
      id: localMotherId,
      given_name: mother.name[0]?.given?.filter(n => n).join(' ') || '',
      family_name: mother.name[0]?.family || '',
      gender: mother.gender || 'female',
      dob: mother.birthDate || null,
      place_of_birth: 'Unknown',
      identifiers: JSON.stringify([
        buildCRVSIdentifier(mother.id, 'birth'),
        ...(mother.identifier || []).filter(i => i.value?.trim()).map(i => ({
          type: i.type?.coding?.[0]?.code || 'UNKNOWN',
          value: i.value
        }))
      ]),
      status: 'review',
      created_at: now,
      updated_at: now
    });

    newEvents.push({
      id: motherBirthEventId,
      event_type: 'birth',
      event_date: mother.birthDate || null,
      location: 'Unknown',
      source: 'seed',
      metadata: JSON.stringify({ note: 'generated birth by crvs' }),
      crvs_event_uuid: crypto.randomUUID(),
      duplicates: null,
      status: null,
      last_update_at: null,
      remarks: 'invalid crvs_event_uuid',
      created_at: now
    });

    newParticipants.push({
      id: crypto.randomUUID(),
      person_id: localMotherId,
      event_id: motherBirthEventId,
      role: 'subject',
      relationship_details: JSON.stringify({ import: 'crvs' }),
      crvs_person_id: mother.id,
      status: 'active',
      created_at: now
    });
  }

  if (father && shouldInsertFather) {
    const fatherBirthEventId = crypto.randomUUID();
    
    newPersons.push({
      id: localFatherId,
      given_name: father.name[0]?.given?.filter(n => n).join(' ') || '',
      family_name: father.name[0]?.family || '',
      gender: father.gender || 'male',
      dob: father.birthDate || null,
      place_of_birth: 'Unknown',
      identifiers: JSON.stringify([
        buildCRVSIdentifier(father.id, 'birth'),
        ...(father.identifier || []).filter(i => i.value?.trim()).map(i => ({
          type: i.type?.coding?.[0]?.code || 'UNKNOWN',
          value: i.value
        }))
      ]),
      status: 'review',
      created_at: now,
      updated_at: now
    });

    newEvents.push({
      id: fatherBirthEventId,
      event_type: 'birth',
      event_date: father.birthDate || null,
      location: 'Unknown',
      source: 'seed',
      metadata: JSON.stringify({ note: 'generated birth by crvs' }),
      crvs_event_uuid: crypto.randomUUID(),
      duplicates: null,
      status: null,
      last_update_at: null,
      remarks: 'invalid crvs_event_uuid',
      created_at: now
    });

    newParticipants.push({
      id: crypto.randomUUID(),
      person_id: localFatherId,
      event_id: fatherBirthEventId,
      role: 'subject',
      relationship_details: JSON.stringify({ import: 'crvs' }),
      crvs_person_id: father.id,
      status: 'active',
      created_at: now
    });
  }

  return {
    personPayload,
    eventPayload,
    participantPayloads,
    newPersons,
    newEvents,
    newParticipants
  };
}

module.exports = { processWebhookToBirthRegistration };