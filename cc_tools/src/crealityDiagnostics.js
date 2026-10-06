import path from 'path';
import fs from 'fs/promises';
import { screenshotsDir } from './storage.js';

const SECURITY_TEXT_RE = /checking your browser|verify you are human|just a moment|performing security verification|enable javascript and cookies to continue|unusual traffic|access denied|captcha|device check|security check|comprueba que eres humano|verificaci[oó]n de seguridad/i;
const SECURITY_URL_RE = /captcha-delivery\.com|datadome|challenge-platform|\/captcha(?:\/|\?|$)/i;
const ACTIVE_SECURITY_FRAME_RE = /captcha-delivery\.com|datadome|\/captcha(?:\/|\?|$)/i;
const SECURITY_SELECTORS = [
  '#challenge-form',
  '#cf-challenge-running',
  '.cf-challenge',
  'iframe[src*="captcha-delivery.com"]',
  'iframe[src*="datadome"]',
  'iframe[src*="/captcha"]',
  '[class*="captcha"]'
];

export function observeCrealityPage(page, taskId) {
  const pending = [];
  const responses = [];
  const failedRequests = [];
  const requestMeta = new WeakMap();
  let sequence = 0;

  const requestListener = (request) => {
    requestMeta.set(request, {
      sequence: ++sequence,
      startedAt: new Date().toISOString(),
      startedMs: Date.now()
    });
  };
  const responseListener = (response) => {
    const request = response.request();
    const meta = requestMeta.get(request) || {
      sequence: ++sequence,
      startedAt: new Date().toISOString(),
      startedMs: Date.now()
    };
    const job = captureResponse(response, meta).then((entry) => {
      if (entry) responses.push(entry);
    }).catch(() => {});
    pending.push(job);
  };
  const failedListener = (request) => {
    const meta = requestMeta.get(request) || {
      sequence: ++sequence,
      startedAt: new Date().toISOString(),
      startedMs: Date.now()
    };
    failedRequests.push(captureRequestFailure(request, meta));
  };
  page.on('request', requestListener);
  page.on('response', responseListener);
  page.on('requestfailed', failedListener);

  return {
    taskId,
    responses,
    failedRequests,
    mark() {
      return { sequence };
    },
    async captureSince(mark = { sequence: 0 }) {
      await Promise.allSettled(pending);
      return {
        responses: responses.filter((entry) => entry.sequence > mark.sequence),
        failedRequests: failedRequests.filter((entry) => entry.sequence > mark.sequence)
      };
    },
    async snapshot() {
      await Promise.allSettled(pending);
      return responses.slice(-20);
    },
    stop() {
      page.off('request', requestListener);
      page.off('response', responseListener);
      page.off('requestfailed', failedListener);
    }
  };
}

export async function inspectCrealityPage(page, observer, options = {}) {
  const responses = await observer?.snapshot?.() || [];
  const url = page?.url?.() || '';
  const title = await page?.title?.().catch(() => '') || '';
  const bodyText = normalize(await page?.locator?.('body')?.innerText({ timeout: 2500 }).catch(() => '') || '');
  const frameUrls = page?.frames?.().map((frame) => frame.url()).filter(Boolean).slice(-10) || [];
  const visibleSecurityChallenge = await hasVisibleSecurityChallenge(page);
  const securityLocation = SECURITY_URL_RE.test(url)
    || frameUrls.some((frameUrl) => ACTIVE_SECURITY_FRAME_RE.test(frameUrl));
  const rateLimit = responses.find((entry) => entry.status === 429);
  const challengeResponse = responses.find((entry) => entry.challenge);
  const modelReviewFailure = responses.find(isModelReviewFailureResponse);

  if (rateLimit) {
    return diagnostic('RATE_LIMITED', 'rate_limit', true,
      'Creality Cloud ha limitado temporalmente las solicitudes.', {
        url, title, responses, frameUrls,
        retryAfter: rateLimit.headers?.['retry-after'] || ''
      });
  }

  if (challengeResponse || securityLocation || visibleSecurityChallenge || hasStandaloneSecurityText(title, bodyText)) {
    return diagnostic('SECURITY_CHALLENGE', 'security', true,
      'Creality Cloud ha mostrado una verificación de seguridad.', { url, title, responses, frameUrls });
  }

  if (await loginRequired(page)) {
    return diagnostic('LOGIN_REQUIRED', 'session', true,
      'La sesión de Creality Cloud ha caducado o no está iniciada.', { url, title, responses, frameUrls });
  }

  if (modelReviewFailure) {
    return diagnostic('MODEL_REVIEW_FAILED', 'model', false,
      'El modelo no está disponible porque no superó la revisión de Creality Cloud.', {
        url, title, responses, frameUrls
      });
  }

  const documentError = responses.find((entry) => entry.resourceType === 'document' && entry.status >= 400);
  if (documentError) {
    if (documentError.status === 404 && /\/model-detail\//i.test(documentError.url || url)) {
      return diagnostic('MODEL_NOT_FOUND', 'model', false,
        'El modelo ya no está disponible en Creality Cloud.', { url, title, responses, frameUrls });
    }
    return diagnostic('CREALITY_HTTP_ERROR', 'network', true,
      `Creality Cloud respondió con el estado HTTP ${documentError.status}.`, {
        url,
        title,
        responses,
        frameUrls,
        httpStatus: documentError.status,
        transient: [502, 503, 504].includes(documentError.status)
      });
  }

  if (options.requireBody && bodyText.length < 40) {
    return diagnostic('PAGE_INCOMPLETE', 'page', true,
      'La página de Creality Cloud no terminó de cargar correctamente.', { url, title, responses, frameUrls });
  }

  return null;
}

function hasStandaloneSecurityText(title, bodyText) {
  if (SECURITY_TEXT_RE.test(String(title || ''))) return true;
  const text = String(bodyText || '');
  return text.length <= 1200 && SECURITY_TEXT_RE.test(text);
}

export async function diagnoseTaskError(error, page, observer, fallback = {}) {
  if (error?.diagnostic) return error.diagnostic;
  const text = error?.technical || error?.message || String(error);
  if (error?.code === 'DISPLAY_UNAVAILABLE' || /without having an? XServer|Missing X server|Missing X server or \$DISPLAY/i.test(text)) {
    return diagnostic('DISPLAY_UNAVAILABLE', 'browser', false,
      'La pantalla virtual del navegador no estaba disponible.', { technical: text });
  }
  if (error?.code === 'BROWSER_PROFILE_LOCKED' || /already running|profile(?: directory)? (?:is |appears to be )?(?:in use|locked)|ProcessSingleton|SingletonLock|user data directory is already in use/i.test(text)) {
    return diagnostic('BROWSER_PROFILE_LOCKED', 'browser', true,
      'Chromium no pudo iniciar porque el perfil de sesión estaba bloqueado.', {
        technical: text,
        recovery: error?.recovery || null
      });
  }
  if (error?.code === 'REMOTE_BROWSER_OPEN' || error?.code === 'BROWSER_BUSY') {
    return diagnostic(error.code, 'browser', false, error.message, { technical: text });
  }
  if (/Target page, context or browser has been closed|browser.*closed/i.test(text)) {
    return diagnostic('BROWSER_CLOSED', 'browser', true,
      'Chromium se cerró de forma inesperada durante la ejecución.', { technical: text });
  }
  const pageDiagnostic = page ? await inspectCrealityPage(page, observer, { requireBody: true }) : null;
  if (pageDiagnostic) return pageDiagnostic;
  if (/Timeout .*waiting for event "download"|waitForEvent.*download/i.test(text)) {
    return diagnostic('DOWNLOAD_TIMEOUT', 'download', false,
      'Creality Cloud no inició la descarga dentro del tiempo esperado.', {
        url: page?.url?.() || fallback.url || '',
        technical: compactTechnical(text)
      });
  }

  return diagnostic(
    fallback.code || error?.code || 'UNEXPECTED_ERROR',
    fallback.category || 'technical',
    Boolean(error?.systemic || fallback.systemic),
    fallback.message || error?.message || 'Se produjo un error técnico inesperado.', {
      url: page?.url?.() || fallback.url || '',
      technical: compactTechnical(text)
    }
  );
}

export async function captureDiagnosticScreenshot(page, taskId, code) {
  const image = await captureDiagnosticImage(page);
  return saveDiagnosticImage(image, taskId, code);
}

export async function captureDiagnosticImage(page) {
  if (!page || page.isClosed()) return null;
  return page.screenshot({ fullPage: true }).catch(() => null);
}

export async function saveDiagnosticImage(image, taskId, code) {
  if (!image) return '';
  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${safePart(taskId)}-${safePart(code)}.png`;
  const fullPath = path.join(screenshotsDir(), filename);
  try {
    await fs.writeFile(fullPath, image);
    return `/screenshots/${filename}`;
  } catch {
    return '';
  }
}

export function failureFromDiagnostic(diagnosticValue, extra = {}) {
  return {
    ...extra,
    code: diagnosticValue.code,
    category: diagnosticValue.category,
    systemic: diagnosticValue.systemic,
    error: diagnosticValue.message,
    diagnostic: diagnosticValue
  };
}

export function generalizedIncident(failures = []) {
  const explicit = failures.find((failure) => failure.systemic);
  if (explicit) return explicit.diagnostic || failureDiagnostic(explicit);

  const recent = failures.slice(-3);
  const codes = recent.map((failure) => failure.code);
  if (recent.length >= 2 && codes.every((code) => code === 'DOWNLOAD_TIMEOUT')) {
    return diagnostic('REPEATED_DOWNLOAD_TIMEOUT', 'download', true,
      'Varias descargas consecutivas no llegaron a iniciarse.', { attempts: recent.length });
  }
  if (recent.length >= 3 && codes.every((code) => code === 'MODEL_CONTROLS_NOT_FOUND')) {
    return diagnostic('MODEL_INTERFACE_UNAVAILABLE', 'page', true,
      'La interfaz de descarga no apareció en varios diseños consecutivos.', { attempts: recent.length });
  }
  return null;
}

function failureDiagnostic(failure) {
  return diagnostic(failure.code || 'UNEXPECTED_ERROR', failure.category || 'technical',
    Boolean(failure.systemic), failure.error || 'Error técnico', {});
}

async function captureResponse(response, meta) {
  const status = response.status();
  const url = response.url();
  const request = response.request();
  const resourceType = request.resourceType();
  const method = request.method();
  const actionRequest = method !== 'GET' && ['fetch', 'xhr'].includes(resourceType);
  const traceableRequest = actionRequest || ['fetch', 'xhr', 'document'].includes(resourceType);
  if (status < 400 && !SECURITY_URL_RE.test(url) && !traceableRequest) return null;

  const allHeaders = await response.allHeaders().catch(() => ({}));
  const headers = {};
  for (const name of [
    'retry-after',
    'x-dd-b',
    'x-datadome',
    'x-datadomeresponse',
    'x-datadome-traffic-rule-response',
    'x-datadome-isbot',
    'x-datadome-devicecheckpassed',
    'x-datadome-captchapassed',
    'content-type',
    'content-length',
    'content-disposition'
  ]) {
    if (allHeaders[name]) headers[name] = String(allHeaders[name]).slice(0, 200);
  }
  const entry = {
    sequence: meta.sequence,
    startedAt: meta.startedAt,
    durationMs: Math.max(0, Date.now() - meta.startedMs),
    status,
    url: safeUrl(url),
    method,
    resourceType,
    headers,
    challenge: isSecurityChallengeResponse({ status, url, resourceType, headers })
  };
  if (method !== 'GET') {
    entry.requestBody = redactPayload(request.postData() || '');
  }
  const contentType = String(headers['content-type'] || '').toLowerCase();
  if (['fetch', 'xhr'].includes(resourceType) && /json|text|javascript/.test(contentType)) {
    const body = await response.text().catch(() => '');
    entry.body = redactPayload(body);
  }
  if (status < 400 && !entry.challenge && !traceableRequest) return null;
  return entry;
}

function captureRequestFailure(request, meta) {
  return {
    sequence: meta.sequence,
    startedAt: meta.startedAt,
    durationMs: Math.max(0, Date.now() - meta.startedMs),
    method: request.method(),
    resourceType: request.resourceType(),
    url: safeUrl(request.url()),
    requestBody: redactPayload(request.postData() || ''),
    error: String(request.failure()?.errorText || 'Error de red desconocido').slice(0, 500)
  };
}

function redactPayload(value) {
  return String(value || '')
    .replace(/("[^"]*(?:token|password|authorization|secret|session|signature|cookie)[^"]*"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2')
    .replace(/(bearer\s+)[a-z0-9._~+\/-]+/gi, '$1[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

export function isSecurityChallengeResponse({ status, url, resourceType, headers = {} }) {
  if (headers['x-dd-b']) return true;
  if (headers['x-datadomeresponse'] && String(headers['x-datadomeresponse']) !== '200') return true;
  const trafficRule = String(headers['x-datadome-traffic-rule-response'] || '').toLowerCase();
  if (['block', 'hard_block', 'interstitial'].includes(trafficRule)) return true;
  if (resourceType === 'document' && SECURITY_URL_RE.test(url)) return true;
  return status === 403 && ACTIVE_SECURITY_FRAME_RE.test(url);
}

export function isModelReviewFailureResponse(response = {}) {
  if (!/\/api\/cxy\/v3\/model\/modelGroupDetail(?:\?|$)/i.test(String(response.url || ''))) return false;
  const body = String(response.body || '');
  if (/"code"\s*:\s*1000069(?:\D|$)/i.test(body)) return true;
  return /model review failed/i.test(body);
}

async function hasVisibleSecurityChallenge(page) {
  if (!page?.locator) return false;
  for (const selector of SECURITY_SELECTORS) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
  }
  return false;
}

async function loginRequired(page) {
  const selectors = [
    'span:has-text("Log In")',
    'button:has-text("Log In")',
    'a:has-text("Log In")',
    'span:has-text("Iniciar sesión")',
    'button:has-text("Iniciar sesión")',
    'a:has-text("Iniciar sesión")'
  ];
  for (const selector of selectors) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
  }
  return /\/login(?:\/|\?|$)/i.test(page.url());
}

function diagnostic(code, category, systemic, message, details = {}) {
  return {
    code,
    category,
    systemic,
    message,
    detectedAt: new Date().toISOString(),
    ...details
  };
}

function compactTechnical(value) {
  return String(value || '').replace(/\s*=+\s*logs\s*=+[\s\S]*/i, '').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function safePart(value) {
  return String(value || 'diagnostic').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 60);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    for (const name of [...url.searchParams.keys()]) {
      if (/token|auth|key|secret|session|signature|password/i.test(name)) {
        url.searchParams.set(name, '[redacted]');
      }
    }
    return url.toString().slice(0, 500);
  } catch {
    return String(value || '').slice(0, 500);
  }
}
