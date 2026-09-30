import { appendDesign, readDesigns, updateDesignAction, updateDesignOwnership } from './storage.js';
import { withAutomationBrowser } from './browserManager.js';
import {
  captureDiagnosticImage,
  captureDiagnosticScreenshot,
  diagnoseTaskError,
  failureFromDiagnostic,
  inspectCrealityPage,
  observeCrealityPage,
  saveDiagnosticImage
} from './crealityDiagnostics.js';
import {
  analyzeActionTrace,
  compareIncentiveProgress,
  readIncentiveProgress,
  waitForIncentiveProgress
} from './incentiveTasks.js';
import { isOwnModel, readModelOwnership } from './modelOwnership.js';
import { collectCatalogCandidates } from './modelDownloadTask.js';
import { selectFavoriteCandidates } from './favoriteModelIndex.js';

const ACTIONS = {
  like_model: {
    taskId: 'modelLikes',
    label: 'Dar me gusta',
    completedField: 'likeCompleted',
    actionStateField: 'likeActionState',
    incentiveTitle: 'Like 3D Model',
    telegramSuccess: '♥️ CC Tools: Me gusta completado',
    telegramError: '❌ CC Tools: Me gusta fallido',
    progress: 'Pulsando el botón de me gusta...'
  }
};

export async function runModelAction(actionKey, taskConfig = {}, options = {}) {
  const action = ACTIONS[actionKey];
  if (!action) throw new Error(`Acción desconocida: ${actionKey}`);

  const designs = await readDesigns();
  const candidates = chooseCandidates(
    designs,
    action.completedField,
    action.actionStateField,
    options.ownUserId,
    taskConfig.prioritizeFavorites !== false,
    Math.random
  );

  const failures = [];
  const acted = [];
  const alreadyApplied = [];
  const screenshots = [];

  return withAutomationBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    const observer = observeCrealityPage(page, action.taskId);
    let candidate = candidates[0] || null;
    try {
      const incentiveBefore = await readIncentiveProgress(page, observer, action.incentiveTitle, {
        timezone: taskConfig.timezone,
        requireTaskList: true
      });
      if (!incentiveBefore.found) {
        throw taskError(
          'INCENTIVE_TASK_NOT_FOUND',
          'reward',
          incentiveTaskNotFoundMessage(action.incentiveTitle, incentiveBefore.availableTasks)
        );
      }
      if (incentiveBefore.completed) {
        return {
          success: true,
          skipped: true,
          message: 'La recompensa diaria ya estaba completada.',
          details: {
            acted: [],
            failures: [],
            skipped: true,
            reason: `La tarea ${action.incentiveTitle} ya estaba en ${incentiveBefore.done}/${incentiveBefore.valid}.`,
            rewardVerification: { status: 'already_completed', before: incentiveBefore, after: incentiveBefore }
          },
          screenshots
        };
      }

      let actionableCandidateFound = false;
      let ownModelsSkipped = 0;
      let candidateIndex = 0;
      let catalogLoaded = false;
      while (!actionableCandidateFound) {
        while (candidateIndex < candidates.length) {
          const pending = candidates[candidateIndex];
          candidateIndex += 1;
          candidate = pending;
          await prepareActionPage(page, pending, observer);
          const ownership = await readModelOwnership(page);
          const updatedOwnership = await updateDesignOwnership(pending.id, ownership, options.ownUserId);
          candidate = updatedOwnership || pending;
          if (isOwnModel(ownership, options.ownUserId)) {
            ownModelsSkipped += 1;
            continue;
          }

          const control = page.locator('.liked.flex-all-center, .liked').first();
          const state = await inspectControlState(control);
          const active = isLikeControlActive(state);
          if (!active) {
            actionableCandidateFound = true;
            break;
          }

          const verification = {
            status: 'already_applied',
            checkedAt: new Date().toISOString(),
            actionEvidence: { before: state, after: state, confirmation: null }
          };
          const updated = await updateDesignAction(candidate.id, actionKey, 'already_applied', verification);
          alreadyApplied.push({ ...(updated || candidate), rewardVerification: verification });
          continue;
        }

        if (actionableCandidateFound || catalogLoaded) break;
        catalogLoaded = true;
        const knownIds = new Set(candidates.map((entry) => entry.id));
        const catalogCandidates = await collectCatalogCandidates(page, designs, 20, observer);
        for (const catalogCandidate of catalogCandidates) {
          const stored = await appendDesign({
            ...catalogCandidate,
            source: 'catalog',
            indexedOnly: true,
            downloadedAt: ''
          });
          if (stored.record
            && !knownIds.has(stored.record.id)
            && !isOwnModel(stored.record, options.ownUserId)) {
            knownIds.add(stored.record.id);
            candidates.push(stored.record);
          }
        }
      }

      if (!actionableCandidateFound) {
        return {
          success: true,
          skipped: true,
          message: `Sin diseños pendientes para ${action.label.toLowerCase()}.`,
          details: {
            acted: [],
            failures: [],
            skipped: true,
            alreadyApplied,
            ownModelsSkipped,
            reason: ownModelsSkipped
              ? 'Los diseños pendientes pertenecen al usuario conectado y se han omitido.'
              : alreadyApplied.length
                ? `${alreadyApplied.length} diseño(s) ya tenían la acción aplicada fuera de CC Tools.`
                : `No hay diseños pendientes para ${action.label.toLowerCase()}.`
          },
          screenshots
        };
      }

      await observer.snapshot();
      const actionEvidence = await performAction(page, observer, action.taskId);
      const network = analyzeActionTrace(actionEvidence.trace, actionKey, actionEvidence.pageDiagnostic);
      const incentiveAfter = network.systemic
        ? { found: false, title: action.incentiveTitle, checkedAt: new Date().toISOString() }
        : await waitForIncentiveProgress(
          page,
          observer,
          action.incentiveTitle,
          incentiveBefore,
          undefined,
          { timezone: taskConfig.timezone }
        );
      const rewardVerification = compareIncentiveProgress(incentiveBefore, incentiveAfter);
      rewardVerification.responses = actionEvidence.trace.responses;
      rewardVerification.failedRequests = actionEvidence.trace.failedRequests;
      rewardVerification.network = network;
      rewardVerification.actionEvidence = {
        before: actionEvidence.before,
        after: actionEvidence.after,
        confirmation: actionEvidence.confirmation
      };
      if (['not_credited', 'unverified'].includes(rewardVerification.status)) {
        screenshots.push(...await saveActionImages(actionEvidence.diagnosticImages, action.taskId));
        const screenshot = await captureDiagnosticScreenshot(
          page,
          `${action.taskId}-reward`,
          rewardVerification.status
        );
        if (screenshot) screenshots.push(screenshot);
      }

      if (rewardVerification.status !== 'credited') {
        const outcome = rewardVerification.status === 'not_credited' ? 'applied_uncredited' : 'ambiguous';
        const updated = await updateDesignAction(candidate.id, actionKey, outcome, rewardVerification);
        const actionAttempt = { ...(updated || candidate), rewardVerification };
        const diagnostic = rewardDiagnostic(rewardVerification, candidate);
        failures.push(failureFromDiagnostic(diagnostic, {
          title: candidate.title || 'Diseño desconocido',
          url: candidate.url
        }));
        return {
          success: false,
          message: `${action.label}: punto no acreditado. ${rewardMessage(rewardVerification)}`,
          details: {
            acted: [],
            alreadyApplied,
            actionAttempt,
            failures,
            diagnostics: [diagnostic],
            rewardVerification,
            incident: diagnostic.systemic ? diagnostic : null,
            retryableToday: !diagnostic.systemic
          },
          screenshots
        };
      }

      const updated = await updateDesignAction(candidate.id, actionKey, 'credited', rewardVerification);
      acted.push({ ...(updated || candidate), rewardVerification });

      return {
        success: true,
        message: `${action.label}: 1/1. ${rewardMessage(rewardVerification)}`,
        details: {
          acted,
          alreadyApplied,
          failures: [],
          diagnostics: [],
          rewardVerification
        },
        screenshots
      };
    } catch (error) {
      if (error.silentRetry) throw error;
      let diagnostic = await diagnoseTaskError(error, page, observer, {
        code: error.code || 'MODEL_ACTION_FAILED',
        category: error.category || 'action',
        systemic: Boolean(error.systemic),
        message: error.userMessage || error.message,
        url: candidate?.url
      });
      if (error.actionTrace) {
        const network = analyzeActionTrace(error.actionTrace, actionKey, error.actionPageDiagnostic || null);
        if (network.systemic || ['ACTION_REJECTED_HTTP', 'NETWORK_FAILURE'].includes(network.code)) {
          diagnostic = {
            ...diagnostic,
            code: network.code,
            message: network.message,
            systemic: network.systemic
          };
        }
        diagnostic.responses = error.actionTrace.responses || [];
        diagnostic.failedRequests = error.actionTrace.failedRequests || [];
        diagnostic.network = network;
        diagnostic.retryAfter = network.retryAfter || '';
        diagnostic.actionEvidence = error.actionEvidence || null;
      }
      failures.push(failureFromDiagnostic(diagnostic, {
          title: candidate?.title || 'Diseño desconocido',
          url: candidate?.url
      }));
      screenshots.push(...await saveActionImages(error.actionImages, action.taskId));
      const screenshot = await captureDiagnosticScreenshot(page, action.taskId, diagnostic.code);
      if (screenshot) screenshots.push(screenshot);
      return {
        success: false,
        message: `${action.label}: 0/1. Fallos: 1.`,
        details: {
          acted,
          alreadyApplied,
          failures,
          diagnostics: [diagnostic],
          incident: diagnostic.systemic ? diagnostic : null
        },
        screenshots
      };
    } finally {
      observer.stop();
    }
  });
}

export function actionInfo(actionKey) {
  return ACTIONS[actionKey] || null;
}

export function chooseCandidates(
  designs,
  completedField,
  actionStateField,
  ownUserId = '',
  prioritizeFavorites = true,
  random = Math.random
) {
  const blockedStates = new Set(['applied_uncredited', 'credited', 'already_applied']);
  blockedStates.add('ambiguous');
  const eligible = designs
    .filter((design) => design.url
      && !design[completedField]
      && !isOwnModel(design, ownUserId)
      && !(design.indexedOnly === true && design.source === 'favorite' && design.favoriteActive !== true)
      && !blockedStates.has(design[actionStateField]))
  const eligibleIds = new Set(eligible.map((design) => design.id));
  const favorites = selectFavoriteCandidates(designs, completedField, ownUserId)
    .filter((design) => eligibleIds.has(design.id));
  const favoriteIds = new Set(favorites.map((design) => design.id));
  const catalog = shuffle(eligible.filter((design) => !favoriteIds.has(design.id)
    && (prioritizeFavorites || design.indexedOnly !== true)), random);
  if (!prioritizeFavorites) return catalog;
  return [...favorites, ...catalog];
}

function shuffle(values = [], random = Math.random) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

async function prepareActionPage(page, design, observer) {
  await page.goto(design.url, { waitUntil: 'domcontentloaded' });
  await page.locator('.liked.flex-all-center, .liked').first()
    .waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);

  const diagnostic = await inspectCrealityPage(page, observer, { requireBody: true });
  if (diagnostic) throw diagnosticError(diagnostic);
}

async function performAction(page, observer, taskId) {
  const control = page.locator('.liked.flex-all-center, .liked').first();
  const before = await inspectControlState(control);
  const beforeImage = await captureDiagnosticImage(page);
  const actionMark = observer.mark();
  try {
    await clickControl(page, control);
    await waitForActionSettlement(page);
  } catch (error) {
    await attachFailedAction(error, page, observer, actionMark, control, before, null, taskId, beforeImage);
    throw error;
  }
  const trace = await observer.captureSince(actionMark);
  const after = await inspectControlState(control);
  const afterImage = await captureDiagnosticImage(page);
  const pageDiagnostic = await inspectCrealityPage(page, observer, { requireBody: true });
  return {
    before,
    after,
    confirmation: null,
    trace,
    pageDiagnostic,
    diagnosticImages: [{ image: beforeImage, code: 'before-action' }, { image: afterImage, code: 'after-action' }]
  };
}

export function isLikeControlActive(state = {}) {
  if (String(state.ariaPressed).toLowerCase() === 'true') return true;
  if (String(state.ariaChecked).toLowerCase() === 'true') return true;

  const classes = String(state.className || '').split(/\s+/);
  if (classes.includes('active') || classes.includes('is-active') || classes.includes('selected')) return true;

  return /icon-(?:dianzan|zan|like)[^\s"']*(?:mianxing|fill|filled)/i.test(String(state.html || ''));
}

async function attachFailedAction(error, page, observer, mark, control, before, confirmation, taskId, beforeImage) {
  const trace = await observer.captureSince(mark);
  const after = await inspectControlState(control);
  const image = await captureDiagnosticImage(page);
  error.actionTrace = trace;
  error.actionEvidence = { before, after, confirmation };
  error.actionPageDiagnostic = await inspectCrealityPage(page, observer, { requireBody: true });
  error.actionImages = [
    { image: beforeImage, code: 'before-action' },
    { image, code: 'action-error' }
  ];
}

async function saveActionImages(values = [], taskId) {
  const paths = [];
  for (const value of values) {
    const saved = await saveDiagnosticImage(value?.image, taskId, value?.code || 'action');
    if (saved) paths.push(saved);
  }
  return paths;
}

async function clickControl(page, control) {
  if (!(await control.isVisible().catch(() => false))) {
    throw taskError('ACTION_CONTROL_NOT_FOUND', 'page', 'No se encontró el botón de la acción.');
  }
  await control.scrollIntoViewIfNeeded().catch(() => {});
  await control.click({ timeout: 8000 });
  await page.waitForTimeout(1200);
}

async function inspectControlState(control) {
  return {
    visible: await control.isVisible().catch(() => false),
    text: normalize(await control.textContent().catch(() => '')),
    className: normalize(await control.getAttribute('class').catch(() => '')),
    ariaPressed: await control.getAttribute('aria-pressed').catch(() => null),
    ariaChecked: await control.getAttribute('aria-checked').catch(() => null),
    title: normalize(await control.getAttribute('title').catch(() => '')),
    html: sanitizeHtml(await control.evaluate((node) => node.outerHTML).catch(() => ''))
  };
}

function sanitizeHtml(value) {
  return String(value || '')
    .replace(/\sdata-v-[a-z0-9-]+(?:="")?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1600);
}

async function waitForActionSettlement(page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(5000);
}

export { compareIncentiveProgress } from './incentiveTasks.js';

function rewardMessage(verification) {
  const message = ({
    credited: 'Punto acreditado.',
    not_credited: 'Acción completada, pero Creality Cloud no acreditó el punto.',
    already_completed: 'La recompensa diaria ya estaba completada.',
    unverified: 'No se pudo verificar la recompensa diaria.'
  })[verification?.status] || 'No se pudo verificar la recompensa diaria.';
  const progress = rewardProgress(verification);
  return progress ? `${message} (${progress})` : message;
}

function rewardProgress(verification = {}) {
  const before = verification.before;
  const after = verification.after;
  if (!before?.found || !after?.found) return '';
  return `${before.done}/${before.valid} → ${after.done}/${after.valid}`;
}

function rewardDiagnostic(verification, design) {
  const notCredited = verification.status === 'not_credited';
  const network = verification.network || {};
  const taskCompletion = verification.taskCompletion;
  const taskCompletionFailed = taskCompletion && !taskCompletion.accepted;
  const networkSpecific = !['ACTION_ENDPOINT_ACCEPTED', 'ACTION_ENDPOINT_NOT_OBSERVED'].includes(network.code);
  const code = taskCompletionFailed
    ? taskCompletion.code
    : networkSpecific
    ? network.code
    : network.code === 'ACTION_ENDPOINT_NOT_OBSERVED'
      ? 'ACTION_ENDPOINT_NOT_OBSERVED'
      : notCredited ? 'ACTION_CONFIRMED_REWARD_NOT_CREDITED' : 'REWARD_VERIFICATION_FAILED';
  return {
    code,
    category: 'reward',
    systemic: Boolean(network.systemic),
    message: taskCompletionFailed
      ? taskCompletion.message
      : networkSpecific
      ? network.message
      : network.code === 'ACTION_ENDPOINT_NOT_OBSERVED'
        ? `${network.message} La recompensa diaria no aumentó.`
        : notCredited
          ? 'El endpoint aceptó la acción, pero Creality Cloud no acreditó la recompensa diaria.'
          : 'No se pudo verificar la recompensa diaria después de aplicar la acción.',
    detectedAt: new Date().toISOString(),
    url: design.url,
    before: verification.before,
    after: verification.after,
    responses: verification.responses || [],
    network,
    retryAfter: network.retryAfter || '',
    actionEvidence: verification.actionEvidence || null,
    taskCompletion: taskCompletion || null,
    failedRequests: verification.failedRequests || []
  };
}

function incentiveTaskNotFoundMessage(title, availableTasks = []) {
  const suffix = availableTasks.length ? ` Tareas detectadas: ${availableTasks.join(', ')}.` : '';
  return `No se encontró la tarea diaria "${title}".${suffix}`;
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function taskError(code, category, message, systemic = false) {
  const error = new Error(message);
  error.code = code;
  error.category = category;
  error.systemic = systemic;
  error.userMessage = message;
  return error;
}

function diagnosticError(value) {
  const error = taskError(value.code, value.category, value.message, value.systemic);
  error.diagnostic = value;
  return error;
}
