export function pauseForExpiredSession(config, taskId = '', diagnostic = {}, now = new Date()) {
  const health = config.automationHealth || {};
  const alreadyPaused = health.state === 'paused' && health.reasonCode === 'LOGIN_REQUIRED';
  const message = diagnostic.message || 'La sesión de Creality Cloud ha caducado o no está iniciada.';
  config.crealitySession = {
    authenticated: false,
    checkedAt: now.toISOString(),
    reason: message
  };
  config.automationHealth = {
    ...health,
    state: 'paused',
    reasonCode: 'LOGIN_REQUIRED',
    reason: message,
    pausedAt: alreadyPaused ? health.pausedAt || now.toISOString() : now.toISOString(),
    pausedUntil: '',
    lastIncidentAt: now.toISOString(),
    pauseSource: 'session',
    pauseTaskId: taskId
  };
  return { notificationRequired: !alreadyPaused, message };
}

export function resumeAfterAuthenticatedLogin(config, profile = null, now = new Date()) {
  if (profile) config.crealityProfile = profile;
  config.crealitySession = {
    authenticated: true,
    checkedAt: now.toISOString(),
    reason: ''
  };
  const health = config.automationHealth || {};
  if (health.state !== 'paused' || health.reasonCode !== 'LOGIN_REQUIRED') return false;

  config.automationHealth = {
    ...health,
    state: 'active',
    reasonCode: '',
    reason: '',
    pausedAt: '',
    pausedUntil: '',
    lastRecoveredAt: now.toISOString(),
    pauseSource: '',
    pauseTaskId: '',
    serviceFailureCount: 0,
    serviceFailureAt: '',
    serviceUnavailableNotified: false
  };
  return true;
}

export function crealitySessionState(config = {}) {
  const explicit = config.crealitySession?.authenticated;
  const closedByHealth = config.automationHealth?.reasonCode === 'LOGIN_REQUIRED';
  const authenticated = typeof explicit === 'boolean'
    ? explicit && !closedByHealth
    : Boolean(config.crealityProfile?.userId) && !closedByHealth;
  return {
    authenticated,
    state: authenticated ? 'open' : 'closed',
    checkedAt: String(config.crealitySession?.checkedAt || config.automationHealth?.lastIncidentAt || ''),
    reason: authenticated ? '' : String(
      config.crealitySession?.reason
      || (closedByHealth ? config.automationHealth?.reason : '')
      || ''
    )
  };
}
