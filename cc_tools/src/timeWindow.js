export function scheduleNextRun(taskConfig, now = new Date(), options = {}) {
  const start = parseClock(taskConfig.windowStart || '08:00');
  const end = parseClock(taskConfig.windowEnd || '12:00');
  const base = new Date(now);

  let startDate = withClock(base, start);
  let endDate = withClock(base, end);
  if (endDate <= startDate) {
    endDate.setDate(endDate.getDate() + 1);
  }

  if (options.forceNextWindow || now >= endDate) {
    startDate.setDate(startDate.getDate() + 1);
    endDate.setDate(endDate.getDate() + 1);
  } else if (now > startDate) {
    startDate = new Date(now.getTime() + 60 * 1000);
  }

  const span = endDate.getTime() - startDate.getTime();
  const offset = Math.floor(Math.random() * Math.max(1, span));
  return new Date(startDate.getTime() + offset).toISOString();
}

export function scheduleNextRunInCurrentWindow(taskConfig, now = new Date(), minDelayMinutes = 1, remainingCount = 1) {
  const { startDate, endDate } = windowBounds(taskConfig, now);
  const delayMs = Math.max(1, Number(minDelayMinutes) || 1) * 60 * 1000;
  let earliest = new Date(Math.max(
    startDate.getTime(),
    now.getTime() + delayMs
  ));

  if (earliest >= endDate) {
    return scheduleNextRun(taskConfig, now, { forceNextWindow: true });
  }

  const slotsAfterThis = Math.max(0, Number(remainingCount) - 1);
  let latest = new Date(endDate.getTime() - slotsAfterThis * delayMs);
  if (latest >= endDate) latest = new Date(endDate.getTime() - 1000);
  if (latest < earliest) latest = earliest;

  const span = latest.getTime() - earliest.getTime();
  const offset = Math.floor(Math.random() * Math.max(1, span));
  return new Date(earliest.getTime() + offset).toISOString();
}

export function generateDownloadPlan(taskConfig, now = new Date(), options = {}) {
  const dailyLimit = Math.max(0, Math.min(30, Number(taskConfig.dailyLimit) || 0));
  const planCount = Math.max(0, Math.min(dailyLimit, Number(options.remainingCount ?? dailyLimit) || 0));
  if (dailyLimit <= 0 || planCount <= 0) return { date: dayKey(taskConfig.timezone, now), plan: [], cursor: 0, nextRunAt: '' };

  const defaultSlotMinutes = Math.max(10, Number(taskConfig.minIntervalMinutes) || 10) + 2;
  const minimumSlotMinutes = Math.max(
    defaultSlotMinutes,
    Number(options.minimumSlotMinutes) || defaultSlotMinutes
  );
  const minimumGapMs = minimumSlotMinutes * 60 * 1000;
  const { startDate, endDate } = currentDayWindowBounds(taskConfig, now);
  if (now >= endDate) {
    return { date: dayKey(taskConfig.timezone, now), plan: [], cursor: 0, nextRunAt: '' };
  }

  const windowDurationMs = Math.max(1, endDate.getTime() - startDate.getTime());
  const availableCount = Math.max(0, Math.floor(windowDurationMs / minimumGapMs));
  const scheduledCount = Math.min(planCount, availableCount);
  if (scheduledCount <= 0) {
    return { date: dayKey(taskConfig.timezone, now), plan: [], cursor: 0, nextRunAt: '' };
  }
  const requiredMs = scheduledCount * minimumGapMs;
  const slackMs = Math.max(0, windowDurationMs - requiredMs);
  const slackParts = splitSlack(slackMs, scheduledCount + 1);

  let cursorTime = startDate.getTime() + slackParts[0];
  const plan = [];
  for (let index = 0; index < scheduledCount; index += 1) {
    plan.push(new Date(cursorTime).toISOString());
    cursorTime += minimumGapMs + slackParts[index + 1];
  }

  return {
    date: dayKey(taskConfig.timezone, startDate),
    plan,
    cursor: 0,
    nextRunAt: plan[0] || ''
  };
}

function currentDayWindowBounds(taskConfig, now = new Date()) {
  const start = parseClock(taskConfig.windowStart || '08:00');
  const end = parseClock(taskConfig.windowEnd || '12:00');
  let startDate = withClock(now, start);
  let endDate = withClock(now, end);
  if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
  if (now > startDate) startDate = new Date(now.getTime() + 60 * 1000);
  return { startDate, endDate };
}

export function isInsideWindow(taskConfig, now = new Date()) {
  const { startDate, endDate } = windowBounds(taskConfig, now);
  return now >= startDate && now <= endDate;
}

export function isDue(iso, now = new Date()) {
  return Boolean(iso) && new Date(iso).getTime() <= now.getTime();
}

function parseClock(value) {
  const match = String(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hours: 8, minutes: 0 };
  return {
    hours: Math.min(23, Math.max(0, Number(match[1]))),
    minutes: Math.min(59, Math.max(0, Number(match[2])))
  };
}

function withClock(date, clock) {
  const output = new Date(date);
  output.setHours(clock.hours, clock.minutes, 0, 0);
  return output;
}

function windowBounds(taskConfig, now = new Date()) {
  const start = parseClock(taskConfig.windowStart || '08:00');
  const end = parseClock(taskConfig.windowEnd || '12:00');

  const startDate = withClock(now, start);
  const endDate = withClock(now, end);
  if (endDate <= startDate) {
    if (now < startDate) {
      startDate.setDate(startDate.getDate() - 1);
    } else {
      endDate.setDate(endDate.getDate() + 1);
    }
  }

  return { startDate, endDate };
}

function nextWindowBounds(taskConfig, now = new Date(), options = {}) {
  const start = parseClock(taskConfig.windowStart || '08:00');
  const end = parseClock(taskConfig.windowEnd || '12:00');

  let startDate = withClock(now, start);
  let endDate = withClock(now, end);
  if (endDate <= startDate) {
    endDate.setDate(endDate.getDate() + 1);
  }

  if (options.forceNextWindow || now >= endDate) {
    startDate.setDate(startDate.getDate() + 1);
    endDate.setDate(endDate.getDate() + 1);
  } else if (now > startDate) {
    startDate = new Date(now.getTime() + 60 * 1000);
  }

  return { startDate, endDate };
}

function splitSlack(totalMs, parts) {
  if (totalMs <= 0 || parts <= 0) return Array.from({ length: Math.max(0, parts) }, () => 0);
  const weights = Array.from({ length: parts }, () => Math.random() + 0.2);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let assigned = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return Math.max(0, totalMs - assigned);
    const value = Math.floor((weight / totalWeight) * totalMs);
    assigned += value;
    return value;
  });
}

function dayKey(timezone, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}
