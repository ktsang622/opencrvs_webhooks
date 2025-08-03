// File: buildSQLPayloads.js
import crypto from 'crypto';
import getLocalUUIDbyCRVS from './getLocalUUIDbyCRVS.js';

const buildCRVSIdentifier = (id, eventType) => ({ type: 'crvs', value: id, event: eventType });

export default {
  buildSQLPayloads: async (regData) => {
    const now = new Date().toISOString();

    const reg = regData?.registration;
    const child = regData?.child;
    const mother = regData?.mother;
    const father = regData?.father;

    if (!child || !reg || !mother) {
      console.error('❌ Missing child, registration, or mother data');
      return null;
    }

    const childName = child.name[0] || {};
    const givenName = childName.firstNames || '';
    const familyName = childName.familyName || '';
    const registrationNumber = reg.registrationNumber || 'UNKNOWN';
    const birthDate = child.birthDate || null;
    const crvsEventId = regData?.id;
    const localEventId = crypto.randomUUID();

    const eventLocation = regData?.eventLocation;
    let placeOfBirth = 'Unknown';
    let eventLocationStr = 'Unknown';

    if (eventLocation?.type === 'HEALTH_FACILITY') {
      placeOfBirth = `Health Institution, ${eventLocation.name}`;
      eventLocationStr = placeOfBirth;
    } else if (eventLocation?.type === 'PRIVATE_HOME') {
      const city = eventLocation?.address?.city || 'Town';
      const country = eventLocation?.address?.country || 'Unknown';
      placeOfBirth = `${city}, ${country}`;
      eventLocationStr = placeOfBirth;
    }

    const filteredIdentifiers = (child.identifier || [])
      .filter(i => i.id?.trim())
      .map(i => ({ type: i.type, value: i.id }));

    const identifiers = JSON.stringify([
      { type: 'NATIONAL_ID', value: registrationNumber },
      buildCRVSIdentifier(child.id, 'birth'),
      ...filteredIdentifiers
    ]);

    const localChildId = crypto.randomUUID();

    const motherMatch = await getLocalUUIDbyCRVS(mother.id);
    const localMotherId = motherMatch || crypto.randomUUID();
    const shouldInsertMother = !motherMatch;

    const motherPerson = shouldInsertMother ? {
      id: localMotherId,
      given_name: mother.name[0]?.firstNames || '',
      family_name: mother.name[0]?.familyName || '',
      gender: mother.gender || 'female',
      dob: mother.birthDate || null,
      place_of_birth: 'Unknown',
      identifiers: JSON.stringify([
        buildCRVSIdentifier(mother.id, 'birth'),
        ...(mother.identifier || []).map(i => ({ type: i.type, value: i.id }))
      ]),
      status: 'review',
      created_at: now,
      updated_at: now
    } : null;

    const motherBirthEventId = crypto.randomUUID();
    const motherBirthEvent = shouldInsertMother ? {
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
    } : null;

    const motherParticipant = shouldInsertMother ? {
      id: crypto.randomUUID(),
      person_id: localMotherId,
      event_id: motherBirthEventId,
      role: 'subject',
      relationship_details: JSON.stringify({ import: 'crvs' }),
      crvs_person_id: mother.id,
      status: 'active',
      created_at: now
    } : null;

    let localFatherId = null;
    let fatherPerson = null;
    let fatherBirthEvent = null;
    let fatherParticipant = null;

    if (father?.detailsExist && father?.id) {
      const fatherMatch = await getLocalUUIDbyCRVS(father.id);
      localFatherId = fatherMatch || crypto.randomUUID();
      const shouldInsertFather = !fatherMatch;

      fatherPerson = shouldInsertFather ? {
        id: localFatherId,
        given_name: father.name[0]?.firstNames || '',
        family_name: father.name[0]?.familyName || '',
        gender: father.gender || 'male',
        dob: father.birthDate || null,
        place_of_birth: 'Unknown',
        identifiers: JSON.stringify([
          buildCRVSIdentifier(father.id, 'birth'),
          ...(father.identifier || []).map(i => ({ type: i.type, value: i.id }))
        ]),
        status: 'review',
        created_at: now,
        updated_at: now
      } : null;

      const fatherBirthEventId = crypto.randomUUID();
      fatherBirthEvent = shouldInsertFather ? {
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
      } : null;

      fatherParticipant = shouldInsertFather ? {
        id: crypto.randomUUID(),
        person_id: localFatherId,
        event_id: fatherBirthEventId,
        role: 'subject',
        relationship_details: JSON.stringify({ import: 'crvs' }),
        crvs_person_id: father.id,
        status: 'active',
        created_at: now
      } : null;
    }

    const duplicates = reg?.duplicates || [];
    const duplicatesId = [];
    for (const dup of duplicates) {
      const match = await getLocalUUIDbyCRVS(dup.compositionId, 'event');
      if (match) duplicatesId.push(match);
    }

    const latestStatus = (reg?.status || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

    const eventRecord = {
      id: localEventId,
      event_type: 'birth',
      event_date: birthDate,
      location: eventLocationStr,
      source: 'OpenCRVS',
      metadata: JSON.stringify({ trackingId: reg?.trackingId }),
      crvs_event_uuid: crvsEventId,
      duplicates: duplicatesId,
      status: latestStatus?.type || null,
      last_update_at: latestStatus?.timestamp || null,
      created_at: now
    };

    const eventParticipants = [
      {
        id: crypto.randomUUID(),
        person_id: localChildId,
        event_id: localEventId,
        role: 'subject',
        relationship_details: JSON.stringify({ type: 'child', import: 'crvs' }),
        crvs_person_id: child.id,
        created_at: now
      },
      {
        id: crypto.randomUUID(),
        person_id: localMotherId,
        event_id: localEventId,
        role: 'mother',
        relationship_details: JSON.stringify({
          type: 'mother', relationship: 'MOTHER', informantType: reg?.informantType || 'MOTHER', import: 'crvs'
        }),
        crvs_person_id: mother.id,
        created_at: now
      }
    ];

    if (father?.detailsExist && localFatherId) {
      eventParticipants.push({
        id: crypto.randomUUID(),
        person_id: localFatherId,
        event_id: localEventId,
        role: 'father',
        relationship_details: JSON.stringify({
          type: 'father', relationship: 'FATHER', informantType: reg?.informantType || 'FATHER', import: 'crvs'
        }),
        crvs_person_id: father.id,
        created_at: now
      });
    }

    return {
      personPayload: {
        id: localChildId,
        given_name: givenName,
        family_name: familyName,
        gender: child.gender || '',
        dob: birthDate,
        place_of_birth: placeOfBirth,
        identifiers,
        status: 'active',
        created_at: now,
        updated_at: now
      },
      eventPayload: eventRecord,
      participantPayloads: eventParticipants,
      newPersons: [motherPerson, fatherPerson].filter(Boolean),
      newEvents: [motherBirthEvent, fatherBirthEvent].filter(Boolean),
      newParticipants: [motherParticipant, fatherParticipant].filter(Boolean)
    };
  }
};
