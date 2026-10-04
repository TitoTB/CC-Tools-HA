export const POINTS_HISTORY_URL = 'https://www.crealitycloud.com/es/incentive-points?thirdType=transaction-details';
const FULL_HISTORY_MAX_READS = 300;
const FULL_HISTORY_STABLE_SCROLLS = 8;

export function parsePointsSummary(text, { timezone = 'Europe/Madrid', now = new Date() } = {}) {
  const source = String(text || '');
  const normalized = source.replace(/\s+/g, ' ').trim();
  const total = parsePointsTotal(normalized);
  const date = localDateKey(now, timezone);
  let earnedToday = 0;
  let transactionCount = 0;
  const transactions = [];
  // Cloud may render the transaction cells on separate lines and uses either
  // ISO dates or the localized DD/MM/YY format depending on the page locale.
  const transactionPattern = /(.+?)\s+((?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}\/\d{1,2}\/\d{2,4})),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([+\u2212-])\s*(\d+(?:[.,]\d+)?)/g;

  for (const match of normalized.matchAll(transactionPattern)) {
    const amount = Number.parseFloat(match[5].replace(',', '.')) || 0;
    const transactionDate = normalizeTransactionDate(match[2]);
    const sourceType = pointTransactionSourceLabel(match[1]);
    const transaction = {
      date: transactionDate,
      time: match[3].length === 5 ? `${match[3]}:00` : match[3],
      amount: match[4] === '+' ? amount : -amount,
      type: classifyPointTask(sourceType),
      sourceType
    };
    transactions.push(transaction);
    if (transaction.date !== date || transaction.amount <= 0) continue;
    earnedToday += transaction.amount;
    transactionCount += 1;
  }

  return {
    status: Number.isFinite(total) ? 'current' : 'unavailable',
    total: Number.isFinite(total) ? total : null,
    earnedToday,
    transactionCount,
    transactions,
    date,
    updatedAt: now.toISOString()
  };
}

export function parsePointsTotal(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const patterns = [
    /Puntos totales(?:\s+Ver reglas)?[^\d]{0,30}([\d.,]+)/i,
    /Total Points(?:\s+View Rules)?[^\d]{0,30}([\d.,]+)/i,
    /Puntos est(?:a|á)ndar[^\d]{0,30}([\d.,]+)/i,
    /Standard Points[^\d]{0,30}([\d.,]+)/i
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const value = Number.parseInt(match[1].replace(/\D/g, ''), 10);
    if (Number.isFinite(value)) return value;
  }
  return Number.NaN;
}

export async function readPointsSummary(page, {
  timezone = 'Europe/Madrid',
  fallbackTotal = null,
  fullHistory = false
} = {}) {
  const checkedAt = new Date();
  try {
    await page.goto(POINTS_HISTORY_URL, { waitUntil: 'domcontentloaded' });
    let previous = '';
    let stableReads = 0;
    let latest = null;
    const collectedTransactions = [];
    let previousScroll = '';
    let stableScrolls = 0;
    let completedHistory = false;
    const maxReads = fullHistory ? FULL_HISTORY_MAX_READS : 10;

    for (let attempt = 0; attempt < maxReads; attempt += 1) {
      await page.waitForTimeout(attempt === 0 ? 2500 : 1000);
      const bodyText = await page.locator('body').innerText().catch(() => '');
      latest = parsePointsSummary(bodyText, { timezone, now: checkedAt });
      collectedTransactions.push(...latest.transactions);
      if (!Number.isFinite(latest.total) && Number.isFinite(fallbackTotal)) {
        latest.total = fallbackTotal;
        latest.status = 'current';
      }
      const signature = `${latest.total}|${latest.earnedToday}|${latest.transactionCount}`;
      stableReads = signature === previous ? stableReads + 1 : 0;
      previous = signature;
      if (!fullHistory && latest.status === 'current' && stableReads >= 1) break;
      if (!fullHistory) continue;

      const scroll = await scrollPointsPage(page);
      const scrollSignature = `${scroll.height}|${scroll.top}|${scroll.containers}|${latest.transactions.length}`;
      stableScrolls = scroll.atBottom && scrollSignature === previousScroll ? stableScrolls + 1 : 0;
      previousScroll = scrollSignature;
      if (stableScrolls >= FULL_HISTORY_STABLE_SCROLLS) {
        completedHistory = true;
        break;
      }
    }
    if (!latest) return unavailableSummary(timezone, checkedAt, 'No se pudo leer el saldo de puntos.');
    const transactions = mergePointTransactions([], collectedTransactions);
    const todayTransactions = transactions.filter((transaction) => transaction.date === latest.date && transaction.amount > 0);
    return {
      ...latest,
      earnedToday: todayTransactions.reduce((total, transaction) => total + transaction.amount, 0),
      transactionCount: todayTransactions.length,
      transactions,
      historyComplete: fullHistory ? completedHistory : latest.historyComplete === true
    };
  } catch (error) {
    return unavailableSummary(timezone, checkedAt, error.message || String(error));
  }
}

async function scrollPointsPage(page) {
  return page.evaluate(() => {
    const containers = [document.scrollingElement, ...document.querySelectorAll('*')]
      .filter((element) => element && element.scrollHeight > element.clientHeight + 20)
      .filter((element, index, items) => items.indexOf(element) === index)
      .sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight))
      .slice(0, 40);
    window.scrollTo(0, document.documentElement.scrollHeight);
    for (const container of containers) {
      container.scrollTo?.(0, container.scrollHeight);
      container.scrollTop = container.scrollHeight;
    }
    const states = containers.map((container) => ({
      height: container.scrollHeight,
      clientHeight: container.clientHeight,
      top: container.scrollTop
    }));
    return {
      height: document.documentElement.scrollHeight,
      top: window.scrollY,
      containers: states.map((state) => `${state.height}:${state.clientHeight}:${state.top}`).join('|'),
      atBottom: states.every((state) => state.top + state.clientHeight >= state.height - 2)
    };
  }).catch(() => ({ height: 0, top: 0, containers: '', atBottom: false }));
}

export function mergePointsState(current = {}, snapshot = {}, { replaceTransactions = false } = {}) {
  if (snapshot.status !== 'current' || !Number.isFinite(snapshot.total)) {
    if (!Number.isFinite(current.total)) return { ...current };
    return {
      ...current,
      status: 'stale',
      checkedAt: snapshot.updatedAt || new Date().toISOString(),
      error: snapshot.error || current.error || ''
    };
  }

  const sameDate = current.date && current.date === snapshot.date;
  const snapshotEarned = Math.max(0, Number(snapshot.earnedToday) || 0);
  let previousDayTotal = resolvePreviousDayTotal(current, snapshot, sameDate, snapshotEarned);
  let balanceIncrease = Number.isFinite(previousDayTotal)
    ? Math.max(0, snapshot.total - previousDayTotal)
    : 0;

  // A previous version could persist the current balance as the daily baseline.
  // When the page also exposes today's movements, repair that baseline instead
  // of keeping the header badge stuck at zero forever.
  if (sameDate && snapshotEarned > 0 && balanceIncrease === 0) {
    previousDayTotal = Math.max(0, snapshot.total - snapshotEarned);
    balanceIncrease = snapshotEarned;
  }

  return {
    total: snapshot.total,
    previousDayTotal,
    earnedToday: Number.isFinite(previousDayTotal) ? balanceIncrease : snapshotEarned,
    transactionCount: Number(snapshot.transactionCount) || 0,
    transactions: mergePointTransactions(replaceTransactions ? [] : current.transactions, snapshot.transactions),
    date: snapshot.date,
    updatedAt: snapshot.updatedAt,
    checkedAt: snapshot.updatedAt,
    status: 'current',
    historyComplete: snapshot.historyComplete === true || current.historyComplete === true,
    error: ''
  };
}

function classifyPointTask(label) {
  const normalized = normalizePointTaskLabel(label).toLowerCase();
  if (/^(?:convert|convertir|conversi[oó]n)$/.test(normalized)) return 'Conversión';
  if (normalized === 'add a device') return 'Añadir dispositivo';
  if (normalized === 'edit profile') return 'Completar perfil';
  if (normalized === 'upload models') return 'Subida de diseños';
  if (/lucky draw|lottery|loter[ií]a|raffle/.test(normalized)) return 'Lotería';
  if (/model has received the support of|ha recibido el apoyo de|support of/.test(normalized) || /^(?:impulsos|impulsos recibidos)$/.test(normalized)) return 'Impulsos recibidos';
  if (/model has reached \d+ usage|ha alcanzado \d+ usos|reached \d+ usage/.test(normalized) || /^descargas(?: de tus diseños| recibidas)?$/.test(normalized)) return 'Descargas recibidas';
  if (/download|descarga/.test(normalized)) return 'Descargas realizadas';
  if (/like|me gusta|favorite|favorito/.test(normalized)) return 'Dar me gusta';
  if (/comment|comentario/.test(normalized)) return 'Comentarios';
  if (/finish|print|impres|imprimir/.test(normalized)) return 'Enviar una impresión';
  if (/boost|impuls/.test(normalized)) return 'Impulsos dados';
  if (/check.?in|checkin|registro diario/.test(normalized)) return 'Check-in diario';
  if (/collection|colecci/.test(normalized)) return 'Añadir a la colección';
  return normalizePointTaskLabel(label) || 'Otros';
}

function normalizePointTaskLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function pointTransactionSourceLabel(value) {
  let label = normalizePointTaskLabel(value);
  // The points page sometimes flattens its whole header and filter toolbar into
  // the first transaction label. Keep the final known action instead of
  // exposing that page chrome as a transaction name.
  const conversion = label.match(/(?:^|\s)(Convert|Convertir|Conversi[oó]n)$/i);
  if (conversion) return conversion[1];
  const balancePrefixes = [
    /^.*Puntos est(?:a|á)ndar\s*[\d.,]+\s*/i,
    /^.*[\d.,]+\s+Puntos est(?:a|á)ndar\s*/i,
    /^.*Standard Points\s*[\d.,]+\s*/i,
    /^.*[\d.,]+\s+Standard Points\s*/i,
    /^.*Puntos totales(?:\s+Ver reglas)?\s*[\d.,]+\s*/i,
    /^.*Total Points(?:\s+View Rules)?\s*[\d.,]+\s*/i
  ];
  for (const pattern of balancePrefixes) {
    label = label.replace(pattern, '');
  }
  return normalizePointTaskLabel(label);
}

function normalizeTransactionDate(value) {
  const source = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return source;
  const match = source.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return source;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

export function mergePointTransactions(current = [], incoming = []) {
  const merged = new Map();
  const structuredBases = new Set();
  const structuredOccurrences = new Set();
  const legacyKeysByOccurrence = new Map();
  const currentTransactions = repairLegacyDoubleCheckins(Array.isArray(current) ? current : []);
  const incomingTransactions = Array.isArray(incoming) ? incoming : [];
  for (const transaction of [...currentTransactions, ...incomingTransactions]) {
    if (!transaction?.date || !Number.isFinite(Number(transaction.amount))) continue;
    const sourceType = pointTransactionSourceLabel(transaction.sourceType);
    const normalized = {
      date: String(transaction.date),
      time: String(transaction.time || ''),
      amount: Number(transaction.amount),
      type: classifyStoredPointTask(transaction, sourceType),
      ...(sourceType ? { sourceType } : {})
    };
    const baseKey = `${normalized.date}|${normalized.time}|${normalized.amount}|${normalized.type}`;
    const occurrenceKey = `${normalized.date}|${normalized.time}|${normalized.amount}`;
    if (sourceType) {
      structuredBases.add(baseKey);
      structuredOccurrences.add(occurrenceKey);
      for (const key of legacyKeysByOccurrence.get(occurrenceKey) || []) merged.delete(key);
    } else if (structuredBases.has(baseKey) || structuredOccurrences.has(occurrenceKey)) {
      continue;
    }
    const identity = sourceType ? sourceType.toLocaleLowerCase('en') : 'legacy';
    const key = `${baseKey}|${identity}`;
    merged.set(key, normalized);
    if (!sourceType) {
      const keys = legacyKeysByOccurrence.get(occurrenceKey) || new Set();
      keys.add(key);
      legacyKeysByOccurrence.set(occurrenceKey, keys);
    }
  }
  return [...merged.values()]
    .sort((left, right) => `${left.date}|${left.time}|${left.type}`.localeCompare(`${right.date}|${right.time}|${right.type}`));
}

function classifyStoredPointTask(transaction, sourceType) {
  if (sourceType) return classifyPointTask(sourceType);
  const type = classifyPointTask(transaction?.type || 'Otros');
  const amount = Number(transaction?.amount) || 0;
  if (amount > 1 && type === 'Descargas realizadas') return 'Descargas recibidas';
  if (amount > 1 && type === 'Impulsos dados') return 'Impulsos recibidos';
  return type;
}

function repairLegacyDoubleCheckins(transactions) {
  const groups = new Map();
  for (const transaction of transactions) {
    if (transaction?.sourceType || Number(transaction?.amount) <= 1) continue;
    const type = classifyPointTask(transaction?.type || 'Otros');
    if (type !== 'Check-in diario' && type !== 'Descargas realizadas') continue;
    const key = `${transaction.date}|${transaction.time || ''}|${Number(transaction.amount)}`;
    const group = groups.get(key) || new Set();
    group.add(type);
    groups.set(key, group);
  }
  const legacyPairs = new Set([...groups.entries()]
    .filter(([, types]) => types.has('Check-in diario') && types.has('Descargas realizadas'))
    .map(([key]) => key));
  if (!legacyPairs.size) return transactions;

  return transactions.map((transaction) => {
    if (transaction?.sourceType) return transaction;
    const key = `${transaction?.date}|${transaction?.time || ''}|${Number(transaction?.amount)}`;
    if (!legacyPairs.has(key)) return transaction;
    const type = classifyPointTask(transaction?.type || 'Otros');
    if (type === 'Check-in diario') return { ...transaction, sourceType: 'Consecutive Check-in' };
    if (type === 'Descargas realizadas') return { ...transaction, sourceType: 'Member Double Check-in' };
    return transaction;
  });
}

function resolvePreviousDayTotal(current, snapshot, sameDate, snapshotEarned) {
  if (sameDate && Number.isFinite(current.previousDayTotal)) {
    return current.previousDayTotal;
  }

  if (sameDate && Number.isFinite(current.total)) {
    return Math.max(0, current.total - Math.max(0, Number(current.earnedToday) || 0));
  }

  if (!sameDate && current.date && Number.isFinite(current.total)) {
    return current.total;
  }

  return snapshotEarned > 0
    ? Math.max(0, snapshot.total - snapshotEarned)
    : null;
}

export function pointsSummaryFromResult(result = {}) {
  const details = result.details || {};
  const candidates = [
    details.pointsSummary,
    details.rewardVerification?.after?.pointsSummary,
    details.rewardVerification?.before?.pointsSummary,
    details.actionAttempt?.rewardVerification?.after?.pointsSummary,
    details.actionAttempt?.rewardVerification?.before?.pointsSummary
  ];

  for (const key of ['downloaded', 'attemptedDownloads', 'acted']) {
    for (const item of details[key] || []) {
      candidates.push(
        item?.rewardVerification?.after?.pointsSummary,
        item?.rewardVerification?.before?.pointsSummary
      );
    }
  }

  return candidates.find((candidate) => candidate?.status === 'current' && Number.isFinite(candidate.total))
    || candidates.find(Boolean)
    || null;
}

export function localDateKey(date = new Date(), timezone = 'Europe/Madrid') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function unavailableSummary(timezone, now, error) {
  return {
    status: 'unavailable',
    total: null,
    earnedToday: 0,
    transactionCount: 0,
    date: localDateKey(now, timezone),
    updatedAt: now.toISOString(),
    error
  };
}
