const TRACKED_TASKS = new Set([
  'creality',
  'finishPrint',
  'modelDownloads',
  'comments',
  'modelBoosts',
  'modelLikes'
]);

export function buildHealthMetrics(config, runs = [], now = new Date()) {
  const cutoff = new Date(now).getTime() - 24 * 60 * 60 * 1000;
  const relevant = runs.filter((run) => {
    const timestamp = Date.parse(run.finishedAt || run.createdAt || '');
    return TRACKED_TASKS.has(run.taskId)
      && Number.isFinite(timestamp)
      && timestamp >= cutoff
      && run.status !== 'skipped';
  });
  const successes = relevant.filter(isSuccessfulRun).length;
  const failures = relevant.length - successes;
  const successRate = relevant.length ? Math.round((successes / relevant.length) * 100) : 100;
  const codes = relevant.flatMap(diagnosticCodes);
  const health = config.automationHealth || {};

  return {
    windowHours: 24,
    attempts: relevant.length,
    successes,
    failures,
    successRate,
    rewardNotCredited: codes.filter((code) => ['REWARD_COOLDOWN_SUSPECTED', 'ACTION_CONFIRMED_REWARD_NOT_CREDITED'].includes(code)).length,
    rateLimited: codes.filter((code) => ['RATE_LIMITED', 'RATE_LIMIT_CONFIRMED'].includes(code)).length,
    securityChallenges: codes.filter((code) => [
      'SECURITY_CHALLENGE',
      'SECURITY_CHALLENGE_DATADOME',
      'SECURITY_CHALLENGE_CLOUDFLARE',
      'CAPTCHA_REQUIRED'
    ].includes(code)).length,
    state: health.state === 'paused'
      ? 'paused'
      : relevant.length >= 3 && successRate < 80 ? 'degraded' : 'active',
    reasonCode: health.reasonCode || '',
    reason: health.reason || '',
    pausedUntil: health.pausedUntil || '',
    pauseSource: health.pauseSource || ''
  };
}

function isSuccessfulRun(run) {
  if (run.status !== 'success') return false;
  if (run.taskId !== 'modelDownloads') return true;
  return (Array.isArray(run.details?.downloaded) ? run.details.downloaded : [])
    .some((design) => design.rewardStatus === 'credited');
}

function diagnosticCodes(run) {
  const values = [
    ...(Array.isArray(run.details?.diagnostics) ? run.details.diagnostics : []),
    ...(run.details?.incident ? [run.details.incident] : []),
    ...(Array.isArray(run.details?.failures)
      ? run.details.failures.map((failure) => failure.diagnostic || failure)
      : [])
  ];
  return [...new Set(values.map((value) => value?.code).filter(Boolean))];
}
