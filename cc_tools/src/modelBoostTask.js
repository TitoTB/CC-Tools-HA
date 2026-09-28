import { withAutomationBrowser } from './browserManager.js';
import { executeRaffle } from './crealityTask.js';
import {
  captureDiagnosticScreenshot,
  diagnoseTaskError,
  failureFromDiagnostic,
  inspectCrealityPage,
  observeCrealityPage
} from './crealityDiagnostics.js';
import { forwardAuthenticationHeaders } from './finishPrintDiscovery.js';
import { readPointsSummary } from './pointsCounter.js';
import { markDesignBoosted, readDesigns, readRuns, updateDesignOwnership } from './storage.js';
import { isOwnModel, readModelOwnership } from './modelOwnership.js';

const BOOST_PAGE_URL = 'https://www.crealitycloud.com/es/user/boost';
const BOOST_COUNT_URL = 'https://www.crealitycloud.com/api/cxy/v2/boost/count';
const BOOST_LIST_URL = 'https://www.crealitycloud.com/api/cxy/v2/boost/list';
const BOOST_PERMISSION_PATH = '/api/cxy/v2/boost/checkPermission';
const BOOST_URL = 'https://www.crealitycloud.com/api/cxy/v2/boost/boost';
const GREEN_CONTENT_URL = 'https://www.crealitycloud.com/api/cxy/v2/green/content';
const COMMENT_URL = 'https://www.crealitycloud.com/api/cxy/comment/postComment';

export async function runModelBoost(taskConfig = {}) {
  const designs = selectBoostCandidates(
    await readDesigns(),
    taskConfig.ownUserId,
    taskConfig.favoriteOnly !== false
  );
  if (!designs.length) return skipped('No hay diseños disponibles para impulsar.');

  const runs = await readRuns();
  const alreadyUsedToday = boostConsumedToday(runs, taskConfig.timezone)
    || designs.some((design) => isToday(design.boostLastAt, taskConfig.timezone));

  return withAutomationBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    const observer = observeCrealityPage(page, 'modelBoosts');
    const screenshots = [];
    let design = designs[0];
    let consumed = false;
    let ticketsAvailable = 0;
    let availabilityKnown = false;
    try {
      let resolved = null;
      let ownModelsSkipped = 0;
      let rejectedModels = 0;
      for (const candidate of designs) {
        design = candidate;
        const target = await resolveBoostTarget(page, candidate, observer, taskConfig.ownUserId);
        if (target?.ownModel) {
          ownModelsSkipped += 1;
          continue;
        }
        if (target && !boostResponseAccepted(target.permission)) {
          rejectedModels += 1;
          continue;
        }
        resolved = target;
        if (resolved) break;
      }
      if (!resolved && rejectedModels) {
        throw taskError('BOOST_NOT_ALLOWED', 'Creality Cloud no permite impulsar ninguno de los diseños disponibles.');
      }
      if (!resolved && ownModelsSkipped) return skipped('Los diseños disponibles pertenecen al usuario conectado y se han omitido.');
      if (!resolved) throw taskError('BOOST_TARGET_NOT_FOUND', 'No se pudo identificar un diseño apto para recibir el boost.');

      const { modelGroupId, authenticationHeaders } = resolved;

      const countResponse = await postJson(page, BOOST_COUNT_URL, { state: 1 }, authenticationHeaders);
      ensureAccepted(countResponse, 'BOOST_COUNT_FAILED', 'No se pudo consultar el número de boletos boost disponibles.');
      ticketsAvailable = Math.max(0, Number(countResponse.body?.result?.count) || 0);

      const listResponse = await postJson(page, BOOST_LIST_URL, { page: 1, pageSize: 100, state: 1 }, authenticationHeaders);
      ensureAccepted(listResponse, 'BOOST_LIST_FAILED', 'No se pudo consultar la lista de boletos boost.');
      ticketsAvailable = Math.max(ticketsAvailable, Number(listResponse.body?.result?.count) || 0);
      availabilityKnown = true;
      if (alreadyUsedToday) {
        return skipped('El boost diario ya se ha utilizado.', {
          alreadyUsedToday: true,
          ticketsAvailable,
          availabilityCheckedAt: new Date().toISOString()
        });
      }
      if (ticketsAvailable <= 0) {
        return skipped('No hay boletos boost disponibles.', {
          ticketsAvailable: 0,
          availabilityCheckedAt: new Date().toISOString()
        });
      }

      const safety = await postJson(page, GREEN_CONTENT_URL, {
        sourceType: 'comment',
        contents: [{ dataId: 'modelCommentDesc', content: '¡Gran diseño!' }]
      }, authenticationHeaders);
      ensureAccepted(safety, 'BOOST_COMMENT_REJECTED', 'Creality Cloud rechazó el comentario asociado al boost.');

      const boost = await postJson(page, BOOST_URL, { modelId: modelGroupId }, authenticationHeaders);
      ensureAccepted(boost, 'BOOST_REJECTED', 'Creality Cloud rechazó el boleto boost.');
      consumed = true;
      const updatedDesign = await markDesignBoosted(design.id);

      const comment = await postJson(page, COMMENT_URL, {
        item: {
          type: 1,
          contentItems: [{ text: '¡Gran diseño!', label: '[!有创意/创新]Creativo', type: 104 }],
          isBoost: true,
          targetId: modelGroupId
        }
      }, authenticationHeaders);
      ensureAccepted(comment, 'BOOST_COMMENT_FAILED', 'El boost se aplicó, pero no se pudo publicar su comentario especial.');

      const pointsBeforeRaffle = await readPointsSummary(page, { timezone: taskConfig.timezone });
      const raffle = await executeRaffle(page, screenshots, { activeChannel: 5 });
      const pointsSummary = await readPointsSummary(page, {
        timezone: taskConfig.timezone,
        fallbackTotal: pointsBeforeRaffle?.total
      });
      const rewardVerification = verifyBoostLottery(raffle);
      const boosted = [{ ...(updatedDesign || design), modelGroupId, rewardVerification }];

      if (rewardVerification.status !== 'lottery_completed') {
        const diagnostic = {
          code: 'BOOST_LOTTERY_NOT_CONFIRMED',
          category: 'reward',
          systemic: false,
          message: 'El boost se aplicó, pero no se pudo confirmar la lotería.',
          url: design.url
        };
        const screenshot = await captureDiagnosticScreenshot(page, 'model-boosts', diagnostic.code);
        if (screenshot) screenshots.push(screenshot);
        return {
          success: false,
          message: 'Boost aplicado, pero no se pudo confirmar la lotería.',
          details: {
            boostConsumed: true,
            boosted,
            acted: boosted,
            ticketsAvailable,
            availabilityCheckedAt: new Date().toISOString(),
            rewardVerification,
            raffle,
            pointsSummary,
            diagnostics: [diagnostic],
            failures: [failureFromDiagnostic(diagnostic, { title: design.title, url: design.url })]
          },
          screenshots
        };
      }

      return {
        success: true,
        message: `Boost aplicado a ${design.title}. Lotería ejecutada.`,
        details: {
          boostConsumed: true,
          boosted,
          acted: boosted,
          ticketsAvailable,
          availabilityCheckedAt: new Date().toISOString(),
          rewardVerification,
          raffle,
          pointsSummary,
          failures: [],
          diagnostics: []
        },
        screenshots
      };
    } catch (error) {
      const diagnostic = await diagnoseTaskError(error, page, observer, {
        code: error.code || 'MODEL_BOOST_FAILED',
        category: error.category || 'action',
        systemic: Boolean(error.systemic),
        message: error.userMessage || error.message,
        url: design?.url || BOOST_PAGE_URL
      });
      const screenshot = await captureDiagnosticScreenshot(page, 'model-boosts', diagnostic.code);
      if (screenshot) screenshots.push(screenshot);
      return {
        success: false,
        message: consumed ? 'El boost se aplicó, pero el proceso posterior falló.' : 'No se pudo aplicar el boost.',
        details: {
          boostConsumed: consumed,
          ...(availabilityKnown ? {
            ticketsAvailable,
            availabilityCheckedAt: new Date().toISOString()
          } : {}),
          boosted: [],
          acted: [],
          retryableToday: !consumed,
          diagnostics: [diagnostic],
          failures: [failureFromDiagnostic(diagnostic, {
            title: design?.title || 'Diseño desconocido',
            url: design?.url || ''
          })]
        },
        screenshots
      };
    } finally {
      observer.stop();
    }
  });
}

export async function checkModelBoostAvailability(taskConfig = {}) {
  const designs = selectBoostCandidates(
    await readDesigns(),
    taskConfig.ownUserId,
    taskConfig.favoriteOnly !== false
  );
  if (!designs.length) {
    return { ticketsAvailable: 0, checkedAt: new Date().toISOString(), reason: 'no_designs' };
  }

  return withAutomationBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    const observer = observeCrealityPage(page, 'modelBoosts');
    try {
      let resolved = null;
      for (const design of designs) {
        const target = await resolveBoostTarget(page, design, observer, taskConfig.ownUserId);
        if (target?.ownModel) continue;
        resolved = target;
        if (resolved) break;
      }
      if (!resolved) {
        return { ticketsAvailable: 0, checkedAt: new Date().toISOString(), reason: 'no_external_designs' };
      }
      const countResponse = await postJson(page, BOOST_COUNT_URL, { state: 1 }, resolved.authenticationHeaders);
      ensureAccepted(countResponse, 'BOOST_COUNT_FAILED', 'No se pudo consultar el número de boletos boost disponibles.');
      const listResponse = await postJson(page, BOOST_LIST_URL, { page: 1, pageSize: 100, state: 1 }, resolved.authenticationHeaders);
      ensureAccepted(listResponse, 'BOOST_LIST_FAILED', 'No se pudo consultar la lista de boletos boost.');
      return {
        ticketsAvailable: Math.max(
          0,
          Number(countResponse.body?.result?.count) || 0,
          Number(listResponse.body?.result?.count) || 0
        ),
        checkedAt: new Date().toISOString()
      };
    } finally {
      observer.stop();
    }
  });
}

export function selectBoostCandidates(designs = [], ownUserId = '', favoriteOnly = true) {
  return designs
    .filter((design) => ((design?.favoriteActive === true
      && design.favoriteAvailability !== 'unavailable')
      || (favoriteOnly === false && design?.indexedOnly !== true))
      && design.url
      && !isOwnModel(design, ownUserId))
    .sort((left, right) => {
      const countDifference = (Number(left.boostCount) || 0) - (Number(right.boostCount) || 0);
      if (countDifference) return countDifference;
      return Date.parse(left.downloadedAt || 0) - Date.parse(right.downloadedAt || 0);
    });
}

export function boostConsumedToday(runs = [], timezone = 'Europe/Madrid', now = new Date()) {
  const today = dayKey(timezone, now);
  return runs.some((run) => run.taskId === 'modelBoosts'
    && run.details?.boostConsumed === true
    && dayKey(timezone, new Date(run.finishedAt || run.createdAt)) === today);
}

async function resolveBoostTarget(page, design, observer, ownUserId = '') {
  await page.goto(design.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const pageDiagnostic = await inspectCrealityPage(page, observer, { requireBody: true });
  if (pageDiagnostic) throw diagnosticError(pageDiagnostic);

  const ownership = await readModelOwnership(page);
  await updateDesignOwnership(design.id, ownership, ownUserId);
  if (isOwnModel(ownership, ownUserId)) return { ownModel: true };

  const permissionRequest = page.waitForRequest((request) =>
    request.method() === 'POST' && request.url().includes(BOOST_PERMISSION_PATH),
  { timeout: 12000 }).catch(() => null);
  const permissionResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes(BOOST_PERMISSION_PATH),
  { timeout: 12000 }).catch(() => null);

  const button = page.getByText(/^(Impulso|Boost)$/i, { exact: true }).last();
  if (!await button.isVisible().catch(() => false)) return null;
  await button.click({ timeout: 6000 });

  const request = await permissionRequest;
  const response = await permissionResponse;
  if (!request || !response) return null;
  const payload = request.postDataJSON?.() || {};
  const modelGroupId = String(payload.modelGroupId || payload.modelId || '').trim();
  if (!modelGroupId) return null;
  return {
    modelGroupId,
    authenticationHeaders: forwardAuthenticationHeaders(await request.allHeaders()),
    permission: {
      ok: response.ok(),
      status: response.status(),
      body: await response.json().catch(() => null)
    }
  };
}

async function postJson(page, url, payload, headers = {}) {
  return page.evaluate(async ({ requestUrl, requestPayload, requestHeaders }) => {
    const response = await fetch(requestUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { ...requestHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(requestPayload)
    });
    const text = await response.text();
    let body = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* Keep raw text. */ }
    return { ok: response.ok, status: response.status, body };
  }, { requestUrl: url, requestPayload: payload, requestHeaders: headers });
}

function ensureAccepted(response, code, message) {
  if (boostResponseAccepted(response)) return;
  const error = taskError(code, message);
  error.technical = JSON.stringify(response || null);
  throw error;
}

export function boostResponseAccepted(response) {
  const bodyCode = Number(response?.body?.code);
  const failType = Number(response?.body?.result?.failType || 0);
  return Boolean(response?.ok && bodyCode === 0 && failType === 0);
}

export function verifyBoostLottery(raffle) {
  if (raffle?.status === 'completed') {
    return {
      status: 'lottery_completed',
      source: 'raffle',
      raffleStatus: raffle.status,
      prizes: Array.isArray(raffle.prizes) ? raffle.prizes : []
    };
  }

  return {
    status: 'lottery_unverified',
    source: 'raffle',
    raffleStatus: raffle?.status || 'unknown',
    prizes: Array.isArray(raffle?.prizes) ? raffle.prizes : []
  };
}

function skipped(message, details = {}) {
  return {
    success: true,
    skipped: true,
    message,
    details: { skipped: true, failures: [], diagnostics: [], ...details },
    screenshots: []
  };
}

function taskError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.userMessage = message;
  error.category = 'action';
  error.systemic = false;
  return error;
}

function diagnosticError(diagnostic) {
  const error = taskError(diagnostic.code, diagnostic.message);
  error.category = diagnostic.category;
  error.systemic = diagnostic.systemic;
  return error;
}

function dayKey(timezone, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function isToday(value, timezone) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) && dayKey(timezone, new Date(timestamp)) === dayKey(timezone);
}
