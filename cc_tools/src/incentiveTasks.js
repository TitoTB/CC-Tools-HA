import { inspectCrealityPage } from './crealityDiagnostics.js';
import { isNavigationTimeout, navigateToCrealityPage } from './crealityNavigation.js';
import { parsePointsTotal, readPointsSummary } from './pointsCounter.js';

export const INCENTIVE_POINTS_URL = 'https://www.crealitycloud.com/es/incentive-points?thirdType=earn-points';
const TASK_RESPONSE_URL = 'https://www.crealitycloud.com/api/cxy/v2/task/taskResponse';

export async function readIncentiveProgress(page, observer, title, options = {}) {
  const taskContext = captureTaskContext(page);
  let navigationError = null;
  try {
    await navigateToCrealityPage(page, INCENTIVE_POINTS_URL);
    await page.waitForTimeout(3000);
  } catch (error) {
    if (isNavigationTimeout(error) || error?.code === 'NAVIGATION_TARGET_MISMATCH') {
      navigationError = incentivePageNotReadyError(error?.message || String(error));
    } else {
      throw error;
    }
  } finally {
    await taskContext.stop();
  }

  const diagnostic = await inspectCrealityPage(page, observer, { requireBody: true });
  if (diagnostic) throw diagnosticError(diagnostic);

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const fallbackTotal = parsePointsTotal(bodyText);

  const resolvedTask = await resolveIncentiveTask(page, title, taskContext);
  const apiProgress = progressFromIncentiveTaskRecord(resolvedTask.record, title, resolvedTask);
  if (apiProgress) {
    apiProgress.availableTasks = [];
    return attachPointsSummary(page, apiProgress, options, fallbackTotal);
  }

  if (navigationError) throw navigationError;

  await page.locator('.task-item-title').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
  const lookup = await findTaskItemWithRetry(page, title);
  if (!lookup.item) {
    if (!lookup.availableTasks.length && options.retryMissing !== false) {
      await page.waitForTimeout(2500);
      return readIncentiveProgress(page, observer, title, {
        ...options,
        retryMissing: false
      });
    }
    if (!lookup.availableTasks.length && options.requireTaskList) {
      throw incentivePageNotReadyError();
    }
    const progress = {
      found: false,
      title,
      availableTasks: lookup.availableTasks,
      checkedAt: new Date().toISOString()
    };
    return attachPointsSummary(page, progress, options, fallbackTotal);
  }

  const done = toCount(await lookup.item.locator('.done-times').textContent().catch(() => ''));
  const valid = toCount(await lookup.item.locator('.vaild-times').textContent().catch(() => ''));
  const progress = {
    found: Number.isFinite(done) && Number.isFinite(valid),
    title: lookup.title,
    taskId: resolvedTask.taskId,
    taskResolution: resolvedTask.source,
    done,
    valid,
    completed: Number.isFinite(done) && Number.isFinite(valid) && valid > 0 && done >= valid,
    availableTasks: lookup.availableTasks,
    checkedAt: new Date().toISOString()
  };
  return attachPointsSummary(page, progress, options, fallbackTotal);
}

export function incentivePageNotReadyError(technical = '') {
  const error = new Error('La página de tareas recompensadas no terminó de cargar.');
  error.code = 'INCENTIVE_PAGE_NOT_READY';
  error.category = 'page';
  error.systemic = false;
  error.silentRetry = true;
  error.technical = technical;
  return error;
}

export async function waitForIncentiveProgress(page, observer, title, before, delays = [0, 10000, 15000, 20000], options = {}) {
  let latest = null;
  let verificationError = null;
  for (const delayMs of delays) {
    if (delayMs) await page.waitForTimeout(delayMs);
    try {
      latest = await readIncentiveProgress(page, observer, title, { ...options, includePoints: false });
      verificationError = null;
    } catch (error) {
      if (error?.code !== 'INCENTIVE_PAGE_NOT_READY') throw error;
      verificationError = error;
      continue;
    }
    if (incentiveAdvanced(before, latest)) break;
  }
  if (!latest && verificationError) {
    return {
      found: false,
      title,
      checkedAt: new Date().toISOString(),
      verificationError: {
        code: verificationError.code,
        message: verificationError.message,
        technical: verificationError.technical || ''
      },
      pointsSummary: before?.pointsSummary
    };
  }
  if (latest) {
    latest.pointsSummary = await readPointsSummary(page, {
      timezone: options.timezone,
      fallbackTotal: latest.pointsSummary?.total ?? before?.pointsSummary?.total
    });
  }
  return latest;
}

async function attachPointsSummary(page, progress, options, fallbackTotal) {
  if (options.includePoints === false) return progress;
  progress.pointsSummary = await readPointsSummary(page, {
    timezone: options.timezone,
    fallbackTotal
  });
  return progress;
}

export function compareIncentiveProgress(before, after) {
  if (!before?.found || !after?.found) {
    return { status: 'unverified', before, after };
  }
  if (before.completed) {
    return { status: 'already_completed', before, after };
  }
  if (incentiveAdvanced(before, after)) {
    return { status: 'credited', before, after };
  }
  return { status: 'not_credited', before, after };
}

export function analyzeActionTrace(trace = {}, actionKey = '', pageDiagnostic = null) {
  const responses = Array.isArray(trace) ? trace : trace.responses || [];
  const failedRequests = Array.isArray(trace?.failedRequests) ? trace.failedRequests : [];
  const mutations = responses.filter((entry) => entry.method && entry.method !== 'GET');
  const actionRequests = actionKey === 'download_model' ? responses : mutations;
  const relevant = actionRequests.filter((entry) => isRelevantActionResponse(entry, actionKey));
  const relevantFailures = failedRequests
    .filter((entry) => isRelevantActionResponse(entry, actionKey))
    .filter((entry) => !isExpectedDownloadNavigationAbort(entry, actionKey));
  const rejected = relevant.filter((entry) => entry.status >= 400 || entry.challenge || indicatesBusinessFailure(entry.body));
  const rateLimited = relevant.find((entry) => entry.status === 429
    || entry.headers?.['retry-after']
    || /rate.?limit|too many requests|retry.?after|cooldown/i.test(entry.body || ''));
  const challenge = relevant.find((entry) => entry.challenge) || securityResponseFromDiagnostic(pageDiagnostic);
  const classification = classifyTrace({ relevant, relevantFailures, rejected, rateLimited, challenge, pageDiagnostic });
  const retryAfter = rateLimited?.headers?.['retry-after'] || pageDiagnostic?.retryAfter || '';
  return {
    observed: relevant.length > 0,
    accepted: relevant.some((entry) => entry.status >= 200 && entry.status < 400 && !indicatesBusinessFailure(entry.body)),
    rejected: rejected.length > 0,
    code: classification.code,
    message: classification.message,
    systemic: classification.systemic,
    cooldownConfirmed: classification.code === 'RATE_LIMIT_CONFIRMED',
    retryAfter,
    responses: relevant.slice(0, 20),
    allMutationResponses: mutations.slice(0, 40),
    rejectedResponses: rejected.slice(0, 10),
    failedRequests: relevantFailures.slice(0, 20),
    allFailedRequests: failedRequests.slice(0, 40)
  };
}

export function analyzeActionResponses(responses = [], actionKey = '') {
  return analyzeActionTrace({ responses, failedRequests: [] }, actionKey);
}

async function findTaskItem(page, expectedTitle) {
  const items = page.locator('.task-item');
  const count = await items.count().catch(() => 0);
  const availableTasks = [];
  let match = null;
  let matchedTitle = '';

  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const title = await taskTitle(item);
    if (title) availableTasks.push(title);
    if (!match && sameTitle(title, expectedTitle)) {
      match = item;
      matchedTitle = title;
    }
  }

  return { item: match, title: matchedTitle, availableTasks: [...new Set(availableTasks)] };
}

async function findTaskItemWithRetry(page, expectedTitle) {
  let lookup = await findTaskItem(page, expectedTitle);
  for (let attempt = 0; attempt < 3 && !lookup.item; attempt += 1) {
    await page.waitForTimeout(750);
    lookup = await findTaskItem(page, expectedTitle);
  }
  return lookup;
}

async function taskTitle(item) {
  const directHeading = normalize(await item.locator('h5.task-item-title').first().textContent().catch(() => ''));
  if (directHeading) return cleanTaskTitle(directHeading);

  const nestedHeading = normalize(await item.locator('.task-item-title h5').first().textContent().catch(() => ''));
  if (nestedHeading) return cleanTaskTitle(nestedHeading);

  const heading = normalize(await item.locator('.task-item-title').first().textContent().catch(() => ''));
  if (heading) return cleanTaskTitle(heading);

  const imageAlt = normalize(await item.locator('.task-item-icon img[alt]').first().getAttribute('alt').catch(() => ''));
  if (imageAlt) return cleanTaskTitle(imageAlt);

  return '';
}

function cleanTaskTitle(value) {
  return normalize(value).replace(/\s*\d+\s*\/\s*\d+\s*$/, '').trim();
}

function sameTitle(left, right) {
  return normalizeTaskTitle(left) === normalizeTaskTitle(right);
}

export function normalizeTaskTitle(value) {
  return cleanTaskTitle(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en');
}

export function findIncentiveTaskRecord(value, expectedTitle) {
  const expected = normalize(expectedTitle).toLocaleLowerCase('en');
  if (!expected) return null;

  const queue = [value];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    if (!Array.isArray(current)) {
      const candidateTitle = normalize(
        current.taskName || current.title || current.name || current.taskTitle || ''
      ).toLocaleLowerCase('en');
      const taskId = String(current.taskId || current.id || '').trim();
      if (candidateTitle === expected && taskId) return { taskId, record: current };
    }

    for (const child of Array.isArray(current) ? current : Object.values(current)) {
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return null;
}

export function progressFromIncentiveTaskRecord(record, expectedTitle, resolution = {}) {
  if (!record || typeof record !== 'object') return null;
  const done = firstTaskCount(record, ['doneTimes', 'doneTime', 'completedTimes', 'finishTimes', 'currentTimes', 'currentCount']);
  const valid = firstTaskCount(record, ['vaildTimes', 'validTimes', 'targetTimes', 'totalTimes', 'maxTimes', 'limitTimes']);
  if (!Number.isFinite(done) || !Number.isFinite(valid)) return null;
  return {
    found: true,
    title: normalize(record.taskName || record.title || record.name || record.taskTitle || expectedTitle),
    taskId: String(record.taskId || record.id || resolution.taskId || '').trim(),
    taskResolution: resolution.source || 'task-response',
    done,
    valid,
    completed: valid > 0 && done >= valid,
    checkedAt: new Date().toISOString()
  };
}

async function resolveIncentiveTask(page, title, taskContext) {
  for (const payload of taskContext.payloads) {
    const match = findIncentiveTaskRecord(payload, title);
    if (match) return { taskId: match.taskId, record: match.record, source: 'incentive-page' };
  }

  const response = await postFromPage(page, TASK_RESPONSE_URL, {
    page: 1,
    pageSize: 100,
    rewardType: 1
  }, taskContext.headers).catch(() => null);
  const match = findIncentiveTaskRecord(response?.body, title);
  if (match) return { taskId: match.taskId, record: match.record, source: 'task-response' };
  return { taskId: '', record: null, source: response ? 'task-response-no-match' : 'unavailable' };
}

function captureTaskContext(page) {
  const payloads = [];
  const headers = {};
  const pending = [];
  const listener = (response) => {
    const url = response.url();
    if (!/^https:\/\/www\.crealitycloud\.com\/api\//i.test(url)) return;
    const request = response.request();
    const job = Promise.all([
      request.allHeaders().catch(() => ({})),
      /task|exp|incentive/i.test(url) ? response.json().catch(() => null) : Promise.resolve(null)
    ]).then(([requestHeaders, payload]) => {
      Object.assign(headers, replayableHeaders(requestHeaders));
      if (payload) payloads.push(payload);
    }).catch(() => {});
    pending.push(job);
  };
  page.on('response', listener);
  return {
    payloads,
    headers,
    async stop() {
      page.off('response', listener);
      await Promise.allSettled(pending);
    }
  };
}

async function postFromPage(page, url, payload, headers) {
  return page.evaluate(async ({ requestUrl, requestPayload, requestHeaders }) => {
    const response = await fetch(requestUrl, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...requestHeaders,
        'content-type': 'application/json'
      },
      body: JSON.stringify(requestPayload)
    });
    const text = await response.text();
    let body = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Preserve non-JSON responses for diagnostics.
    }
    return { ok: response.ok, status: response.status, body };
  }, { requestUrl: url, requestPayload: payload, requestHeaders: replayableHeaders(headers) });
}

function replayableHeaders(headers = {}) {
  const blocked = /^(?:host|connection|content-length|cookie|origin|referer|user-agent|accept-encoding|content-type|sec-|:)/i;
  return Object.fromEntries(Object.entries(headers)
    .filter(([name]) => !blocked.test(name))
    .map(([name, value]) => [name, String(value)]));
}

function incentiveAdvanced(before, after) {
  return Boolean(
    before?.found
    && after?.found
    && (after.done > before.done || (!before.completed && after.completed))
  );
}

function indicatesBusinessFailure(body) {
  const value = String(body || '');
  return /"success"\s*:\s*false|"(?:code|status)"\s*:\s*(?:-1|4\d\d|5\d\d)|"(?:error|errors)"\s*:\s*(?!null|\[\]|\{\})/i.test(value);
}

function classifyTrace({ relevant, relevantFailures, rejected, rateLimited, challenge, pageDiagnostic }) {
  if (rateLimited || pageDiagnostic?.code === 'RATE_LIMITED') {
    return {
      code: 'RATE_LIMIT_CONFIRMED',
      message: 'Creality Cloud confirmó un límite temporal para esta acción.',
      systemic: true
    };
  }
  if (pageDiagnostic?.code === 'SECURITY_CHALLENGE' || challenge) {
    const evidence = `${pageDiagnostic?.url || ''} ${(pageDiagnostic?.frameUrls || []).join(' ')} ${challenge?.url || ''}`;
    if (/datadome|captcha-delivery/i.test(evidence)) {
      return { code: 'SECURITY_CHALLENGE_DATADOME', message: 'DataDome solicitó una verificación de seguridad.', systemic: true };
    }
    if (/cloudflare|challenge-platform|cf-challenge/i.test(evidence)) {
      return { code: 'SECURITY_CHALLENGE_CLOUDFLARE', message: 'Cloudflare solicitó una verificación de seguridad.', systemic: true };
    }
    return { code: 'CAPTCHA_REQUIRED', message: 'Creality Cloud mostró una verificación que requiere intervención.', systemic: true };
  }
  const abortedDownloadConfirmation = relevantFailures.find((entry) => (
    /\/3mfDownloadSuccess(?:\?|$)/i.test(entry.url || '')
    && /NS_BINDING_ABORTED|ABORTED|CANCELLED|CANCELED/i.test(entry.error || '')
  ));
  if (abortedDownloadConfirmation) {
    return {
      code: 'DOWNLOAD_CONFIRMATION_ABORTED',
      message: 'El navegador canceló la confirmación final de la descarga antes de que Creality Cloud respondiera.',
      systemic: false
    };
  }
  if (relevantFailures.length) {
    return { code: 'NETWORK_FAILURE', message: 'La petición de la acción falló antes de recibir respuesta.', systemic: false };
  }
  if (rejected.length) {
    return { code: 'ACTION_REJECTED_HTTP', message: 'El endpoint de Creality Cloud rechazó la acción.', systemic: false };
  }
  if (relevant.some((entry) => entry.status >= 200 && entry.status < 400)) {
    return { code: 'ACTION_ENDPOINT_ACCEPTED', message: 'El endpoint de la acción respondió correctamente.', systemic: false };
  }
  return {
    code: 'ACTION_ENDPOINT_NOT_OBSERVED',
    message: 'No se pudo identificar una petición de red asociada específicamente a la acción.',
    systemic: false
  };
}

function securityResponseFromDiagnostic(diagnostic) {
  if (diagnostic?.code !== 'SECURITY_CHALLENGE') return null;
  return (diagnostic.responses || []).find((entry) => entry.challenge) || { url: diagnostic.url || '' };
}

function isRelevantActionResponse(entry, actionKey) {
  if (actionKey !== 'download_model' && isTelemetryRequest(entry)) return false;

  const patterns = {
    like_model: /like|liked|praise|thumb|zan/i,
    add_to_collection: /collect|collection|favorite|favourite|bookmark|shoucang/i,
    download_model: /download|file|incentive|point|task/i
  };
  const pattern = patterns[actionKey];
  if (!pattern) return true;
  return pattern.test(`${entry.url || ''} ${entry.body || ''} ${entry.headers?.['content-disposition'] || ''}`);
}

function isTelemetryRequest(entry) {
  const url = String(entry?.url || '');
  return /(?:^|\.)analytics\.google\.com\/g\/collect|google-analytics\.com|googletagmanager\.com/i.test(url);
}

function isExpectedDownloadNavigationAbort(entry, actionKey) {
  return actionKey === 'download_model'
    && entry.method === 'GET'
    && entry.resourceType === 'document'
    && /(?:ERR_ABORTED|NS_BINDING_ABORTED)/i.test(entry.error || '');
}

function toCount(value) {
  const parsed = Number.parseInt(String(value ?? '').replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function firstTaskCount(record, names) {
  for (const name of names) {
    if (!(name in record)) continue;
    const count = toCount(record[name]);
    if (Number.isFinite(count)) return count;
  }
  return Number.NaN;
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function diagnosticError(value) {
  const error = new Error(value.message);
  error.code = value.code;
  error.category = value.category;
  error.systemic = value.systemic;
  error.userMessage = value.message;
  error.diagnostic = value;
  return error;
}
