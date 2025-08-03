// parseWebhookToRegData.js
function parseWebhookToRegData(webhookBody) {
  const entries = webhookBody?.event?.context?.[0]?.entry || [];
  const getResource = (resourceType, conditionFn = () => true) =>
    entries.find(e => e.resource?.resourceType === resourceType && conditionFn(e.resource))?.resource;

  const regData = {
    id: webhookBody?.id,
    timestamp: webhookBody?.timestamp,
    registration: getResource('Task'),
    child: getResource('Patient', r => r.identifier?.some(id => id.type?.coding?.some(c => c.code === 'BIRTH_REGISTRATION_NUMBER'))),
    mother: getResource('RelatedPerson', r => r.relationship?.coding?.some(c => c.code === 'MOTHER'))?.patient ? getResource('Patient', r => r.id === getResource('RelatedPerson', r => r.relationship?.coding?.some(c => c.code === 'MOTHER'))?.patient?.reference?.split('/')?.[1]) : null
  };

  const fatherRelated = getResource('RelatedPerson', r => r.relationship?.coding?.some(c => c.code === 'FATHER'));
  if (fatherRelated) {
    const fatherPatientId = fatherRelated.patient?.reference?.split('/')?.[1];
    const fatherPatient = getResource('Patient', r => r.id === fatherPatientId);
    if (fatherPatient) {
      regData.father = {
        ...fatherPatient,
        detailsExist: true
      };
    }
  }

  const eventLocation = webhookBody?.event?.hub?.eventLocation || null;
  if (eventLocation) {
    regData.eventLocation = eventLocation;
  }

  return regData;
}

export default parseWebhookToRegData;
