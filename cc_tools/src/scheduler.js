import { appendRun, cleanupOldScreenshots, readConfig, readRuns, writeConfig } from './storage.js';
import { runCrealityCheckin } from './crealityTask.js';
import { runModelDownloads } from './modelDownloadTask.js';
import { actionInfo, runModelAction } from './modelActionTask.js';
import { sendTelegram } from './telegram.js';
import { generateDownloadPlan, isDue, scheduleNextRun } from './timeWindow.js';
import { diagnoseTaskError } from './crealityDiagnostics.js';
import { mergePointsState, pointsSummaryFromResult } from './pointsCounter.js';
import { applyStartedVirtualPrint, manualVirtualPrintConfig, startVirtualPrint } from './finishPrintTask.js';
import { isFinishPrintStartRun } from './finishPrintSelection.js';
import { finishPrintSlotMinutes } from './finishPrintSchedule.js';
import {
  activateNextFinishPrintProfile,
  normalizeFinishPrintProfiles,
  syncActiveFinishPrintProfile
} from './finishPrintProfiles.js';
import { buildCommentKindPlan, countTodayComments, runModelComment } from './modelCommentTask.js';
import { checkModelBoostAvailability, runModelBoost } from './modelBoostTask.js';
import { redeemShopGoal } from './shopGoal.js';

const TASK_IDS = ['creality', 'finishPrint', 'modelDownloads', 'comments', 'modelBoosts', 'modelLikes'];
const MIN_AUTOMATION_GAP_MINUTES = 10;
const SILENT_RETRY_MINUTES = 10;

let running = false;
let runningTask = '';
let timer = null;

export function startScheduler() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, 60 * 1000);
  tick().catch((error) => console.error('[scheduler]', error));
}

export async function runTaskNow(taskId, source = 'manual', options = {}) {
  if (!TASK_IDS.includes(taskId)) {
    throw new Error(`Tarea desconocida: ${taskId}`);
  }
  const startedAt = new Date().toISOString();
  if (running) {
    const error = new Error(`Ya hay una ejecución en curso${runningTask ? ` (${taskDisplayName(runningTask)})` : ''}. Inténtalo de nuevo cuando termine.`);
    error.code = 'TASK_ALREADY_RUNNING';
    throw error;
  }

  running = true;
  runningTask = taskId;

  try {
    const config = await readConfig();
    const taskConfig = config.tasks[taskId];
    const result = await executeTask(taskId, taskConfig, options, config);
    const status = result.skipped ? 'skipped' : result.success ? 'success' : 'failed';
    const message = formatRunMessage(taskId, status, result);

    if (result.skipped && source === 'schedule') {
      const freshConfig = await readConfig();
      updateModelBoostState(freshConfig, taskId, result);
      updateNextRunAfterExecution(freshConfig.tasks[taskId], taskId, source, result);
      updatePointsCounter(freshConfig, result);
      await writeConfig(freshConfig);
      return { status, message };
    }

    await appendRun({
      taskId,
      source,
      status,
      message,
      startedAt,
      finishedAt: new Date().toISOString(),
      screenshots: result.screenshots || [],
      details: result.details || {}
    });

    const freshConfig = await readConfig();
    if (taskId === 'finishPrint' && status === 'success') {
      applyStartedVirtualPrint(freshConfig.tasks.finishPrint, result, source, new Date());
    }
    if (taskId === 'comments' && result.details?.commentUsage?.id) {
      const comment = freshConfig.tasks.comments.comments.find((entry) => entry.id === result.details.commentUsage.id);
      if (comment) comment.usageCount = Math.max(0, Number(comment.usageCount) || 0) + 1;
    }
    updateModelBoostState(freshConfig, taskId, result);
    freshConfig.tasks[taskId].lastRunAt = new Date().toISOString();
    freshConfig.tasks[taskId].lastStatus = status;
    freshConfig.tasks[taskId].lastMessage = message;
    updateNextRunAfterExecution(freshConfig.tasks[taskId], taskId, source, result);
    updateDependentModelActions(freshConfig, taskId, result);
    updatePointsCounter(freshConfig, result);
    const healthEvent = updateAutomationHealth(freshConfig, taskId, status, result);
    await writeConfig(freshConfig);
    if (taskId === 'creality') {
      await cleanupOldScreenshots(freshConfig.tasks.creality.retainDays);
    }

    await notifyTaskResult(freshConfig, taskId, status, result, healthEvent);

    return { status, message };
  } catch (error) {
    if (source === 'schedule'
      && ['INCENTIVE_PAGE_NOT_READY', 'BROWSER_CRASHED', 'FINISH_PRINT_AUTH_REQUEST_NOT_OBSERVED'].includes(error.code)
      && error.silentRetry) {
      const freshConfig = await readConfig();
      const retryAt = new Date(Date.now() + SILENT_RETRY_MINUTES * 60 * 1000);
      delayPendingTaskPlan(freshConfig.tasks[taskId], taskId, retryAt);
      if (taskId === 'finishPrint') {
        syncActiveFinishPrintProfile(freshConfig.tasks.finishPrint);
        activateNextFinishPrintProfile(freshConfig.tasks.finishPrint);
      }
      await writeConfig(freshConfig);
      return {
        status: 'skipped',
        message: `${error.message} Se reintentará automáticamente.`
      };
    }

    if (source === 'schedule' && ['REMOTE_BROWSER_OPEN', 'BROWSER_BUSY'].includes(error.code)) {
      const freshConfig = await readConfig();
      freshConfig.tasks[taskId].nextRunAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      if (taskId === 'finishPrint') {
        syncActiveFinishPrintProfile(freshConfig.tasks.finishPrint);
        activateNextFinishPrintProfile(freshConfig.tasks.finishPrint);
      }
      await writeConfig(freshConfig);
      return { status: 'skipped', message: error.message };
    }

    const { runMessage, details } = await appendExecutionError(taskId, source, startedAt, error);
    error.runLogged = true;

    const freshConfig = await readConfig();
    freshConfig.tasks[taskId].lastRunAt = new Date().toISOString();
    freshConfig.tasks[taskId].lastStatus = 'error';
    freshConfig.tasks[taskId].lastMessage = runMessage;
    const failedResult = { success: false, details };
    updateNextRunAfterExecution(freshConfig.tasks[taskId], taskId, source, failedResult);
    const healthEvent = updateAutomationHealth(freshConfig, taskId, 'error', failedResult);
    await writeConfig(freshConfig);

    await notifyTaskResult(freshConfig, taskId, 'error', failedResult, healthEvent);
    throw error;
  } finally {
    running = false;
    runningTask = '';
  }
}

export function schedulerState() {
  return { running, runningTask };
}

async function tick() {
  if (running) return;

  const config = await readConfig();
  if (await holdForAutomationHealth(config)) return;
  const runs = await readRuns();
  if (await redeemScheduledShopGoal(config)) return;
  await refreshDailyBoostAvailability(config);
  for (const taskId of TASK_IDS) {
    const task = config.tasks[taskId];
    if (!task?.enabled) continue;

    if (taskId === 'modelDownloads' && ensureDownloadPlan(task, runs, new Date())) {
      await writeConfig(config);
    }
    if (taskId === 'finishPrint' && ensureFinishPrintPlan(task, runs, new Date())) {
      await writeConfig(config);
    }
    if (taskId === 'comments' && ensureCommentPlan(task, runs, new Date())) {
      await writeConfig(config);
    }

    if (!task.nextRunAt) {
      if (taskId === 'modelDownloads' || taskId === 'finishPrint' || taskId === 'comments') {
        continue;
      } else {
        task.nextRunAt = scheduleNextRun(task);
      }
      await writeConfig(config);
      continue;
    }

    if (isDue(task.nextRunAt)) {
      if (taskId === 'finishPrint' && task.pendingVerification?.printId) continue;
      const delayedUntil = automationGapDelay(config, taskId, new Date());
      if (delayedUntil) {
        delayPendingTaskPlan(task, taskId, delayedUntil);
        if (taskId === 'finishPrint') {
          syncActiveFinishPrintProfile(task);
          activateNextFinishPrintProfile(task);
        }
        await writeConfig(config);
        continue;
      }
      const options = taskId === 'modelDownloads'
        ? { single: true }
        : taskId === 'comments'
          ? { commentKind: scheduledCommentKind(task) }
          : {};
      await runTaskNow(taskId, 'schedule', options).catch((error) => {
        console.error('[scheduler]', error.message);
      });
      break;
    }
  }
}

async function redeemScheduledShopGoal(config, now = new Date()) {
  const goal = config.shopGoal || {};
  const total = Number(config.points?.total);
  if (!goal.enabled || !goal.productId || !Number.isFinite(total) || total < Number(goal.points || 0)) return false;
  const lastAttempt = Date.parse(goal.lastAttemptAt || '');
  if (Number.isFinite(lastAttempt) && now.getTime() - lastAttempt < 30 * 60 * 1000) return false;

  running = true;
  runningTask = 'shopRedemption';
  const startedAt = now.toISOString();
  try {
    goal.lastAttemptAt = startedAt;
    const result = await redeemShopGoal(goal);
    goal.lastCheckedAt = new Date().toISOString();
    if (result.product) {
      goal.name = result.product.name;
      goal.imageUrl = result.product.imageUrl;
      goal.points = result.product.points;
      goal.available = result.product.available;
    }
    if (Number.isFinite(result.availablePoints)) config.points.total = result.availablePoints;

    if (result.insufficient) {
      goal.lastStatus = 'waiting';
      goal.lastMessage = 'El saldo todavía no alcanza el precio actualizado del objetivo.';
      await writeConfig(config);
      return true;
    }
    if (result.unavailable) {
      goal.lastStatus = 'unavailable';
      goal.lastMessage = 'El objetivo no está disponible actualmente; se volverá a comprobar.';
      await writeConfig(config);
      return true;
    }

    goal.enabled = false;
    goal.redeemedAt = new Date().toISOString();
    goal.lastStatus = 'success';
    goal.lastMessage = `Objetivo canjeado: ${goal.name}.`;
    if (Number.isFinite(result.remainingPoints)) config.points.total = result.remainingPoints;
    await writeConfig(config);
    await appendRun({
      taskId: 'shopRedemption',
      source: 'schedule',
      status: 'success',
      message: goal.lastMessage,
      startedAt,
      finishedAt: new Date().toISOString(),
      screenshots: [],
      details: { product: { id: goal.productId, name: goal.name, points: goal.points, imageUrl: goal.imageUrl } }
    });
    if (config.telegram.enabled && config.telegram.notifyOnShopRedemption !== false) {
      await sendTelegram(config, `✅ CC Tools: Objetivo canjeado\n${goal.name}\n${goal.points} puntos`).catch((error) => {
        console.error('[telegram]', error.message);
      });
    }
    return true;
  } catch (error) {
    if (['BROWSER_BUSY', 'REMOTE_BROWSER_OPEN'].includes(error.code)) return false;
    goal.lastAttemptAt = startedAt;
    goal.lastStatus = 'error';
    goal.lastMessage = error.message || 'No se pudo canjear el objetivo.';
    await writeConfig(config);
    const diagnostic = await diagnoseTaskError(error, null, null, {
      code: error.code || 'SHOP_REDEMPTION_FAILED',
      category: 'technical',
      systemic: false,
      message: goal.lastMessage
    });
    await appendRun({
      taskId: 'shopRedemption',
      source: 'schedule',
      status: 'error',
      message: goal.lastMessage,
      startedAt,
      finishedAt: new Date().toISOString(),
      screenshots: error.screenshot ? [error.screenshot] : [],
      details: { failures: [{ title: goal.name, error: goal.lastMessage, diagnostic }], diagnostics: [diagnostic] }
    });
    if (config.telegram.enabled && config.telegram.notifyOnShopRedemptionError !== false) {
      await sendTelegram(config, `❌ CC Tools: No se pudo canjear el objetivo\n${goal.name}\n${goal.lastMessage}`).catch((telegramError) => {
        console.error('[telegram]', telegramError.message);
      });
    }
    return true;
  } finally {
    running = false;
    runningTask = '';
  }
}

function updateNextRunAfterExecution(taskConfig, taskId, source, result) {
  const now = new Date();
  if (taskId === 'modelDownloads') {
    if (source === 'schedule') {
      advanceDownloadPlan(taskConfig);
    } else {
      consumeManualDownloadSuccesses(taskConfig, result.details?.downloaded?.length || 0);
    }
    return;
  }
  if (taskId === 'finishPrint') {
    if (source === 'schedule') {
      advanceFinishPrintPlan(taskConfig);
    } else if (result.details?.printId) {
      advanceFinishPrintPlan(taskConfig);
    }
    syncActiveFinishPrintProfile(taskConfig);
    activateNextFinishPrintProfile(taskConfig);
    return;
  }
  if (taskId === 'comments') {
    if (source === 'schedule' || result.details?.rewardVerification?.status === 'credited') {
      advanceCommentPlan(taskConfig);
    }
    return;
  }

  if (result.details?.retryableToday) {
    taskConfig.nextRunAt = nextAllowedRunAt(taskConfig, new Date(now.getTime() + 60 * 60 * 1000));
    return;
  }

  taskConfig.nextRunAt = scheduleNextRun(taskConfig, now, { forceNextWindow: true });
}

function ensureDownloadPlan(taskConfig, runs = [], now = new Date()) {
  const today = dayKey(taskConfig.timezone || 'Europe/Madrid', now);
  const attemptsToday = countTodayDownloadAttempts(runs, taskConfig);
  if (taskConfig.downloadPlanDate === today) {
    let changed = false;
    const recordedCount = Math.max(0, Number(taskConfig.downloadPlanDoneCount) || 0);
    if (attemptsToday > recordedCount) {
      for (let index = recordedCount; index < attemptsToday; index += 1) {
        advanceDownloadPlan(taskConfig);
      }
      changed = true;
    }

    const plan = Array.isArray(taskConfig.downloadPlan) ? taskConfig.downloadPlan : [];
    const cursor = Math.min(plan.length, Math.max(0, Number(taskConfig.downloadPlanCursor) || 0));
    const expectedNextRunAt = plan[cursor] || '';
    const configuredNextRunAt = taskConfig.nextRunAt || '';
    const configuredForToday = configuredNextRunAt
      && dayKey(taskConfig.timezone || 'Europe/Madrid', new Date(configuredNextRunAt)) === today;
    if (expectedNextRunAt && !configuredForToday) {
      taskConfig.nextRunAt = expectedNextRunAt;
      changed = true;
    }
    return changed;
  }

  const dailyLimit = Math.max(0, Math.min(30, Number(taskConfig.dailyLimit) || 0));
  const remainingCount = Math.max(0, dailyLimit - attemptsToday);
  applyDownloadPlan(taskConfig, generateDownloadPlan(taskConfig, now, { remainingCount }), attemptsToday);
  taskConfig.downloadsToday = attemptsToday;
  return true;
}

async function refreshDailyBoostAvailability(config, now = new Date()) {
  const task = config.tasks.modelBoosts;
  if (!task?.enabled) return;
  const today = dayKey(task.timezone, now);
  if (task.availabilityDate === today) return;
  const retryAt = Date.parse(task.availabilityRetryAt || '');
  if (Number.isFinite(retryAt) && retryAt > now.getTime()) return;

  running = true;
  runningTask = 'modelBoosts';
  try {
    const availability = await checkModelBoostAvailability({
      ...task,
      ownUserId: config.crealityProfile?.userId || ''
    });
    task.availableBoosts = Math.max(0, Number(availability.ticketsAvailable) || 0);
    task.availabilityCheckedAt = availability.checkedAt;
    task.availabilityDate = today;
    task.availabilityRetryAt = '';
    await writeConfig(config);
  } catch (error) {
    task.availabilityRetryAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    await writeConfig(config);
    console.error('[scheduler] No se pudo actualizar la disponibilidad de boosts:', error.message);
  } finally {
    running = false;
    runningTask = '';
  }
}

async function appendExecutionError(taskId, source, startedAt, error) {
  const message = error.message || String(error);
  const runMessage = taskId === 'creality' ? 'Check-in fallido' : message;
  const diagnostic = await diagnoseTaskError(error, null, null, {
    code: error.code || 'TASK_EXECUTION_ERROR',
    category: 'technical',
    systemic: Boolean(error.systemic),
    message
  });
  const details = {
    file: error.finishPrintFile || null,
    failures: [{
      code: diagnostic.code,
      category: diagnostic.category,
      systemic: diagnostic.systemic,
      error: diagnostic.message,
      diagnostic
    }],
    diagnostics: [diagnostic],
    incident: diagnostic.systemic ? diagnostic : null
  };
  await appendRun({
    taskId,
    source,
    status: 'error',
    message: runMessage,
    startedAt,
    finishedAt: new Date().toISOString(),
    screenshots: error.screenshot ? [error.screenshot] : [],
    details
  });
  return { runMessage, details };
}

function taskDisplayName(taskId) {
  return ({
    creality: 'Check-in diario',
    finishPrint: 'Enviar una impresión',
    modelDownloads: 'Descarga de diseños',
    comments: 'Comentarios',
    modelBoosts: 'Impulsar diseños',
    modelLikes: 'Dar me gusta',
    shopRedemption: 'Canje de objetivo'
  })[taskId] || taskId;
}

function applyDownloadPlan(taskConfig, generated, doneCount = 0) {
  taskConfig.downloadPlanDate = generated.date;
  taskConfig.downloadPlan = generated.plan;
  taskConfig.downloadPlanCursor = generated.cursor;
  taskConfig.downloadPlanDoneCount = Math.max(0, Number(doneCount) || 0);
  taskConfig.nextRunAt = generated.nextRunAt;
}

export function advanceDownloadPlan(taskConfig) {
  const plan = Array.isArray(taskConfig.downloadPlan) ? taskConfig.downloadPlan : [];
  const cursor = Math.min(plan.length, Math.max(0, Number(taskConfig.downloadPlanCursor) || 0) + 1);
  taskConfig.downloadPlanCursor = cursor;
  taskConfig.downloadPlanDoneCount = Math.max(0, Number(taskConfig.downloadPlanDoneCount) || 0) + 1;
  taskConfig.downloadsToday = taskConfig.downloadPlanDoneCount;
  taskConfig.nextRunAt = plan[cursor] || '';
}

export function consumeManualDownloadSuccesses(taskConfig, count) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  for (let index = 0; index < total; index += 1) {
    advanceDownloadPlan(taskConfig);
  }
}

function countTodayDownloadAttempts(runs = [], taskConfig = {}) {
  const timezone = taskConfig.timezone || 'Europe/Madrid';
  const today = dayKey(timezone);
  return runs
    .filter((run) => run.taskId === 'modelDownloads'
      && (run.source === 'schedule' || creditedDownloads(run).length > 0)
      && dayKey(timezone, new Date(run.finishedAt || run.createdAt)) === today)
    .length;
}

function creditedDownloads(run) {
  return (Array.isArray(run.details?.downloaded) ? run.details.downloaded : [])
    .filter((design) => design.rewardStatus === 'credited');
}

function ensureFinishPrintPlan(taskConfig, runs = [], now = new Date()) {
  syncActiveFinishPrintProfile(taskConfig);
  const profiles = normalizeFinishPrintProfiles(taskConfig);
  let changed = false;
  profiles.forEach((profile, index) => {
    if (ensureFinishPrintProfilePlan(profile, runs, now, taskConfig.timezone, index === 0)) changed = true;
  });
  taskConfig.printerProfiles = profiles;
  const previousActive = taskConfig.activePrinterProfileId;
  const previousNext = taskConfig.nextRunAt;
  activateNextFinishPrintProfile(taskConfig, { sync: false });
  return changed || previousActive !== taskConfig.activePrinterProfileId || previousNext !== taskConfig.nextRunAt;
}

function ensureFinishPrintProfilePlan(profile, runs, now, timezone, includeLegacyRuns) {
  profile.timezone = timezone || 'Europe/Madrid';
  const today = dayKey(profile.timezone, now);
  const attemptsToday = countTodayFinishPrintAttempts(runs, profile, profile.id, includeLegacyRuns);
  if (profile.printPlanDate === today) {
    let changed = false;
    const recordedCount = Math.max(0, Number(profile.printPlanDoneCount) || 0);
    if (attemptsToday > recordedCount) {
      for (let index = recordedCount; index < attemptsToday; index += 1) {
        advanceFinishPrintPlan(profile);
      }
      changed = true;
    }

    const plan = Array.isArray(profile.printPlan) ? profile.printPlan : [];
    const cursor = Math.min(plan.length, Math.max(0, Number(profile.printPlanCursor) || 0));
    const expectedNextRunAt = plan[cursor] || '';
    const configuredForToday = profile.nextRunAt
      && dayKey(profile.timezone, new Date(profile.nextRunAt)) === today;
    if (expectedNextRunAt && !configuredForToday) {
      profile.nextRunAt = expectedNextRunAt;
      changed = true;
    }
    return changed;
  }

  const dailyLimit = Math.max(0, Math.min(10, Number(profile.dailyLimit) || 0));
  const remainingCount = Math.max(0, dailyLimit - attemptsToday);
  const generated = generateDownloadPlan(profile, now, {
    remainingCount,
    minimumSlotMinutes: finishPrintSlotMinutes(profile)
  });
  profile.printPlanDate = generated.date;
  profile.printPlan = generated.plan;
  profile.printPlanCursor = generated.cursor;
  profile.printPlanDoneCount = attemptsToday;
  profile.nextRunAt = generated.nextRunAt;
  return true;
}

export function advanceFinishPrintPlan(taskConfig) {
  const plan = Array.isArray(taskConfig.printPlan) ? taskConfig.printPlan : [];
  const cursor = Math.min(plan.length, Math.max(0, Number(taskConfig.printPlanCursor) || 0) + 1);
  taskConfig.printPlanCursor = cursor;
  taskConfig.printPlanDoneCount = Math.max(0, Number(taskConfig.printPlanDoneCount) || 0) + 1;
  taskConfig.nextRunAt = plan[cursor] || '';
}

function ensureCommentPlan(taskConfig, runs = [], now = new Date()) {
  const today = dayKey(taskConfig.timezone || 'Europe/Madrid', now);
  const counts = countTodayComments(runs, taskConfig.timezone, now);
  const creditedToday = counts.image + counts.text;
  const attemptsToday = runs.filter((run) => run.taskId === 'comments'
    && run.source === 'schedule'
    && dayKey(taskConfig.timezone || 'Europe/Madrid', new Date(run.finishedAt || run.createdAt)) === today).length;
  const doneCount = Math.max(creditedToday, attemptsToday);
  if (taskConfig.commentPlanDate === today) {
    const plan = Array.isArray(taskConfig.commentPlan) ? taskConfig.commentPlan : [];
    const cursor = Math.min(plan.length, Math.max(doneCount, Number(taskConfig.commentPlanCursor) || 0));
    const nextRunAt = plan[cursor] || '';
    const kindPlanChanged = ensureCommentKindPlan(taskConfig, counts, plan.length, cursor);
    const changed = kindPlanChanged
      || cursor !== taskConfig.commentPlanCursor
      || nextRunAt !== (taskConfig.nextRunAt || '');
    taskConfig.commentPlanCursor = cursor;
    taskConfig.commentPlanDoneCount = doneCount;
    taskConfig.nextRunAt = nextRunAt;
    return changed;
  }

  const imageRemaining = Math.max(0, Math.min(5, Number(taskConfig.imageDailyLimit) || 0) - counts.image);
  const textRemaining = Math.max(0, Math.min(1, Number(taskConfig.textDailyLimit) || 0) - counts.text);
  const generated = generateDownloadPlan(taskConfig, now, { remainingCount: imageRemaining + textRemaining });
  taskConfig.commentPlanDate = generated.date;
  taskConfig.commentPlan = generated.plan;
  taskConfig.commentKindPlan = buildCommentKindPlan(taskConfig, counts);
  taskConfig.commentPlanCursor = generated.cursor;
  taskConfig.commentPlanDoneCount = doneCount;
  taskConfig.nextRunAt = generated.nextRunAt;
  return true;
}

function ensureCommentKindPlan(taskConfig, counts, planLength, cursor) {
  const current = Array.isArray(taskConfig.commentKindPlan) ? taskConfig.commentKindPlan : [];
  if (current.length === planLength
    && current.slice(cursor).every((kind) => kind === 'image' || kind === 'text')) return false;
  const pendingKinds = buildCommentKindPlan(taskConfig, counts);
  taskConfig.commentKindPlan = [
    ...Array(cursor).fill(''),
    ...pendingKinds.slice(0, Math.max(0, planLength - cursor))
  ];
  while (taskConfig.commentKindPlan.length < planLength) taskConfig.commentKindPlan.push('text');
  return true;
}

function scheduledCommentKind(taskConfig) {
  const cursor = Math.max(0, Number(taskConfig.commentPlanCursor) || 0);
  const kind = Array.isArray(taskConfig.commentKindPlan) ? taskConfig.commentKindPlan[cursor] : '';
  return kind === 'image' || kind === 'text' ? kind : '';
}

export function advanceCommentPlan(taskConfig) {
  const plan = Array.isArray(taskConfig.commentPlan) ? taskConfig.commentPlan : [];
  const cursor = Math.min(plan.length, Math.max(0, Number(taskConfig.commentPlanCursor) || 0) + 1);
  taskConfig.commentPlanCursor = cursor;
  taskConfig.commentPlanDoneCount = Math.max(0, Number(taskConfig.commentPlanDoneCount) || 0) + 1;
  taskConfig.nextRunAt = plan[cursor] || '';
}

function countTodayFinishPrintAttempts(runs = [], taskConfig = {}, profileId = '', includeLegacyRuns = false) {
  const timezone = taskConfig.timezone || 'Europe/Madrid';
  const today = dayKey(timezone);
  return runs.filter((run) => isFinishPrintStartRun(run)
    && (!profileId || run.details?.printerProfileId === profileId || (includeLegacyRuns && !run.details?.printerProfileId))
    && dayKey(timezone, new Date(run.finishedAt || run.createdAt)) === today).length;
}

function automationGapDelay(config, taskId, now = new Date()) {
  const lastOtherRunAt = latestOtherTaskRunAt(config, taskId);
  if (!lastOtherRunAt) return null;

  const earliest = new Date(lastOtherRunAt.getTime() + MIN_AUTOMATION_GAP_MINUTES * 60 * 1000);
  return earliest > now ? earliest : null;
}

function latestOtherTaskRunAt(config, taskId) {
  let latest = null;
  for (const otherTaskId of TASK_IDS) {
    if (otherTaskId === taskId) continue;
    const timestamp = config.tasks?.[otherTaskId]?.lastRunAt;
    if (!timestamp) continue;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

export function delayPendingTaskPlan(taskConfig, taskId, delayedRunAt) {
  const target = new Date(delayedRunAt);
  if (Number.isNaN(target.getTime())) return taskConfig;

  const planFields = {
    modelDownloads: ['downloadPlan', 'downloadPlanCursor'],
    finishPrint: ['printPlan', 'printPlanCursor'],
    comments: ['commentPlan', 'commentPlanCursor']
  }[taskId];
  if (!planFields) {
    taskConfig.nextRunAt = target.toISOString();
    return taskConfig;
  }

  const [planKey, cursorKey] = planFields;
  const plan = Array.isArray(taskConfig[planKey]) ? [...taskConfig[planKey]] : [];
  const cursor = Math.min(plan.length, Math.max(0, Number(taskConfig[cursorKey]) || 0));
  const current = new Date(plan[cursor] || taskConfig.nextRunAt || '');
  if (!plan[cursor] || Number.isNaN(current.getTime()) || target <= current) {
    taskConfig.nextRunAt = target.toISOString();
    return taskConfig;
  }

  const shiftMs = target.getTime() - current.getTime();
  for (let index = cursor; index < plan.length; index += 1) {
    const planned = new Date(plan[index]);
    if (!Number.isNaN(planned.getTime())) plan[index] = new Date(planned.getTime() + shiftMs).toISOString();
  }
  taskConfig[planKey] = plan;
  taskConfig.nextRunAt = plan[cursor] || target.toISOString();
  return taskConfig;
}

function executeTask(taskId, taskConfig, options, config) {
  const ownershipOptions = { ...options, ownUserId: config.crealityProfile?.userId || '' };
  if (taskId === 'creality') return runCrealityCheckin({ ...options, timezone: taskConfig.timezone });
  if (taskId === 'finishPrint') {
    return startVirtualPrint(options.finishPrintSelection
      ? manualVirtualPrintConfig(taskConfig, options.finishPrintSelection)
      : taskConfig);
  }
  if (taskId === 'modelDownloads') return runModelDownloads(taskConfig, ownershipOptions);
  if (taskId === 'comments') return runModelComment(taskConfig, ownershipOptions);
  if (taskId === 'modelBoosts') return runModelBoost({ ...taskConfig, ownUserId: ownershipOptions.ownUserId });
  if (taskId === 'modelLikes') return runModelAction('like_model', taskConfig, ownershipOptions);
  return runModelAction('add_to_collection', taskConfig, ownershipOptions);
}

function updatePointsCounter(config, result) {
  const snapshot = pointsSummaryFromResult(result);
  if (!snapshot) return;
  config.points = mergePointsState(config.points, snapshot);
}

function formatRunMessage(taskId, status, result) {
  if (status === 'skipped') return result.message || 'Sin trabajo pendiente';
  if (taskId === 'creality') {
    return result.message || (status === 'success' ? 'Check-in completado' : 'Check-in fallido');
  }
  if (taskId === 'modelLikes') {
    return result.message || (status === 'success' ? 'Me gusta completado.' : 'Me gusta fallido.');
  }
  if (taskId === 'modelCollections') {
    return result.message || (status === 'success' ? 'Añadido a la colección.' : 'Colección fallida.');
  }
  if (taskId === 'comments') {
    return result.message || (status === 'success' ? 'Comentario publicado.' : 'Comentario fallido.');
  }
  return result.message || (status === 'success' ? 'Tarea completada.' : 'Tarea fallida.');
}

async function notifyTaskResult(config, taskId, status, result, healthEvent = {}) {
  if (status === 'skipped') return;

  if (healthEvent.paused) {
    if (shouldNotifyIncident(config, taskId)) {
      const pauseUntil = formatPauseUntil(healthEvent.pausedUntil, config.tasks?.[taskId]?.timezone);
      const source = healthEvent.pauseSource === 'retry-after' ? ' (indicado por Creality Cloud)' : '';
      await sendTelegram(config, `❌ CC Tools: Automatizaciones pausadas\n${healthEvent.reason}${pauseUntil ? `\nReanudación prevista: ${pauseUntil}${source}` : ''}\nRevisa el diagnóstico en Logs.`).catch((error) => {
        console.error('[telegram]', error.message);
      });
    }
    return;
  }

  if (taskId === 'modelBoosts') {
    const design = result.details?.boosted?.[0] || result.details?.acted?.[0];
    const failures = result.details?.failures || [];
    if (status === 'success' && config.telegram.notifyOnModelBoost !== false && design) {
      await sendTelegram(config, `✅ CC Tools: Boost aplicado\n<a href="${escapeTelegramHtmlAttribute(design.url)}">${escapeTelegramHtml(design.title)}</a>\nLotería ejecutada.`, {
        parseMode: 'HTML'
      }).catch((error) => console.error('[telegram]', error.message));
    }
    if (status !== 'success' && config.telegram.notifyOnModelBoostError !== false) {
      const failure = failures[0];
      await sendTelegram(config, `❌ CC Tools: Falló Impulsar diseños\n${failure?.title || 'Diseño desconocido'}\n${publicError(failure)}`)
        .catch((error) => console.error('[telegram]', error.message));
    }
    return;
  }
  if (taskId === 'finishPrint') {
    if (status !== 'success' && config.telegram.notifyOnFinishPrintError !== false) {
      const failure = result.details?.failures?.[0];
      const fileName = result.details?.file?.name || 'G-code';
      await sendTelegram(
        config,
        `❌ CC Tools: Error al enviar una impresión virtual\n${fileName}\n${publicError(failure)}`
      ).catch((error) => {
        console.error('[telegram]', error.message);
      });
    }
    return;
  }

  if (healthEvent.incidentActive) return;

  if (healthEvent.recovered) {
    if (config.telegram.enabled) {
      await sendTelegram(config, '✅ CC Tools: Automatizaciones reanudadas').catch((error) => {
        console.error('[telegram]', error.message);
      });
    }
  }

  if (taskId === 'creality') {
    if (shouldNotify(config, status)) {
      await sendTelegram(config, formatCheckinTelegramMessage(status, result)).catch((error) => {
        console.error('[telegram]', error.message);
      });
    }
    return;
  }

  if (taskId === 'modelDownloads') {
    const downloaded = result.details?.downloaded || [];
    const failures = result.details?.failures || [];

    if (config.telegram.notifyOnDesignDownload !== false) {
      for (const design of downloaded) {
        await sendTelegram(config, `✅ CC Tools: Diseño descargado\n<a href="${escapeTelegramHtmlAttribute(design.url)}">${escapeTelegramHtml(design.title)}</a>`, {
          parseMode: 'HTML'
        }).catch((error) => {
          console.error('[telegram]', error.message);
        });
      }
    }

    if (config.telegram.notifyOnDesignError !== false) {
      if (failures.length) {
        const failure = failures[0];
        const suffix = failures.length > 1 ? `\n${failures.length} intentos fallidos en esta ejecución.` : '';
        await sendTelegram(config, `❌ CC Tools: Descarga de diseño fallida\n${failure.title || 'Diseño desconocido'}\n${publicError(failure)}${suffix}`).catch((error) => {
          console.error('[telegram]', error.message);
        });
      }
    }
  }

  if (taskId === 'comments') {
    const acted = result.details?.acted || [];
    const failures = result.details?.failures || [];
    if (status === 'success' && config.telegram.notifyOnComment !== false) {
      for (const design of acted) {
        const type = design.commentKind === 'image' ? 'con imagen' : 'sin imagen';
        await sendTelegram(config, `✅ CC Tools: Comentario ${type} publicado\n<a href="${escapeTelegramHtmlAttribute(design.url)}">${escapeTelegramHtml(design.title)}</a>`, {
          parseMode: 'HTML'
        }).catch((error) => console.error('[telegram]', error.message));
      }
    }
    if (status !== 'success' && config.telegram.notifyOnCommentError !== false && failures.length) {
      const failure = failures[0];
      await sendTelegram(config, `❌ CC Tools: Comentario fallido\n${failure.title || 'Diseño desconocido'}\n${publicError(failure)}`)
        .catch((error) => console.error('[telegram]', error.message));
    }
    return;
  }

  if (taskId === 'modelLikes' || taskId === 'modelCollections') {
    const info = actionInfo(taskId === 'modelLikes' ? 'like_model' : 'add_to_collection');
    const acted = result.details?.acted || [];
    const failures = result.details?.failures || [];

    const notifySuccess = taskId === 'modelLikes'
      ? config.telegram.notifyOnModelLike !== false
      : config.telegram.notifyOnModelCollection !== false;
    const notifyError = taskId === 'modelLikes'
      ? config.telegram.notifyOnModelLikeError !== false
      : config.telegram.notifyOnModelCollectionError !== false;

    if (notifySuccess) {
      for (const design of acted) {
        const rewardLine = actionRewardTelegramLine(design.rewardVerification);
        await sendTelegram(config, `${info.telegramSuccess}\n<a href="${escapeTelegramHtmlAttribute(design.url)}">${escapeTelegramHtml(design.title)}</a>${rewardLine ? `\n${rewardLine}` : ''}`, {
          parseMode: 'HTML'
        }).catch((error) => {
          console.error('[telegram]', error.message);
        });
      }
    }

    if (notifyError) {
      if (failures.length) {
        const failure = failures[0];
        await sendTelegram(config, `${info.telegramError}\n${failure.title || 'Diseño desconocido'}\n${publicError(failure)}`).catch((error) => {
          console.error('[telegram]', error.message);
        });
      }
    }
  }
}

function formatCheckinTelegramMessage(status, result = {}) {
  if (status !== 'success') return '❌ CC Tools: Check-in fallido';
  return result.details?.checkin?.status === 'already_done'
    ? '✅ CC Tools: Check-in ya realizado'
    : '✅ CC Tools: Check-in completado con éxito';
}

function actionRewardTelegramLine(verification = {}) {
  const message = ({
    credited: 'Punto acreditado.',
    not_credited: 'Acción completada, pero Creality Cloud no acreditó el punto.',
    already_completed: 'La recompensa diaria ya estaba completada.',
    unverified: 'No se pudo verificar la recompensa diaria.'
  })[verification.status] || '';
  const before = verification.before;
  const after = verification.after;
  const progress = before?.found && after?.found
    ? `${before.done}/${before.valid} → ${after.done}/${after.valid}`
    : '';
  return message && progress ? `${message} (${progress})` : message;
}

function updateDependentModelActions(config, taskId, result) {
  if (taskId !== 'modelDownloads') return;
  const downloaded = result.details?.downloaded?.length || 0;
  if (downloaded <= 0) return;

  for (const dependentTaskId of ['modelLikes', 'modelCollections']) {
    const task = config.tasks[dependentTaskId];
    if (!task?.enabled) continue;
    task.nextRunAt = scheduleNextRun(task, new Date());
  }

}

function updateModelBoostState(config, taskId, result) {
  if (taskId !== 'modelBoosts') return;
  const task = config.tasks.modelBoosts;
  if (Number.isFinite(Number(result.details?.ticketsAvailable))) {
    const consumed = result.details?.boostConsumed === true ? 1 : 0;
    task.availableBoosts = Math.max(0, (Number(result.details.ticketsAvailable) || 0) - consumed);
  }
  if (result.details?.availabilityCheckedAt) {
    task.availabilityCheckedAt = result.details.availabilityCheckedAt;
    task.availabilityDate = dayKey(task.timezone, new Date(result.details.availabilityCheckedAt));
  }
}

function shouldNotify(config, status) {
  if (status === 'success') return config.telegram.notifyOnSuccess !== false;
  return config.telegram.notifyOnError !== false;
}

async function holdForAutomationHealth(config) {
  const health = config.automationHealth || {};
  if (health.state !== 'paused') return false;
  const pausedUntil = Date.parse(health.pausedUntil || '');
  if (!isGlobalBlockingIncident(health) || (Number.isFinite(pausedUntil) && pausedUntil <= Date.now())) {
    config.automationHealth = {
      ...health,
      state: 'active',
      reasonCode: '',
      reason: '',
      pausedAt: '',
      pausedUntil: '',
      pauseSource: '',
      pauseTaskId: ''
    };
    await writeConfig(config);
    return false;
  }
  return true;
}

export function updateAutomationHealth(config, taskId, status, result = {}) {
  const health = config.automationHealth || {};
  const incident = result.details?.incident;
  const wasPaused = health.state === 'paused';

  if (incident?.systemic && isGlobalBlockingIncident(incident)) {
    const now = new Date();
    const rewardCooldown = incident.code === 'RATE_LIMIT_CONFIRMED';
    const rewardCooldownDate = localDateKey(now);
    const previousRewardCount = health.rewardCooldownDate === rewardCooldownDate
      ? Math.max(0, Number(health.rewardCooldownCount) || 0)
      : 0;
    const rewardCooldownCount = rewardCooldown ? previousRewardCount + 1 : previousRewardCount;
    const durationMs = incidentPauseMilliseconds(incident, now);
    const pauseSource = ['RATE_LIMITED', 'RATE_LIMIT_CONFIRMED'].includes(incident.code)
      && parseRetryAfterMilliseconds(incident.retryAfter, now) !== null
      ? 'retry-after'
      : 'policy';
    config.automationHealth = {
      ...health,
      state: 'paused',
      reasonCode: incident.code,
      reason: incident.message,
      pausedAt: now.toISOString(),
      pausedUntil: new Date(now.getTime() + durationMs).toISOString(),
      lastIncidentAt: now.toISOString(),
      rewardCooldownDate: rewardCooldown ? rewardCooldownDate : health.rewardCooldownDate || '',
      rewardCooldownCount,
      pauseSource,
      pauseTaskId: taskId
    };
    return {
      paused: !wasPaused || health.reasonCode !== incident.code,
      incidentActive: true,
      reason: incident.message,
      incident,
      pausedUntil: config.automationHealth.pausedUntil,
      pauseSource
    };
  }

  if (incident?.systemic) {
    config.automationHealth = {
      ...health,
      lastIncidentAt: new Date().toISOString(),
      lastIncidentCode: incident.code,
      lastIncidentTaskId: taskId
    };
    return { isolatedIncident: true, incident };
  }

  const rewardRecovered = result.details?.rewardVerification?.status === 'credited';
  if (status === 'success' && wasPaused
    && (health.reasonCode !== 'REWARD_COOLDOWN_SUSPECTED' || rewardRecovered)) {
    config.automationHealth = {
      ...health,
      state: 'active',
      reasonCode: '',
      reason: '',
      pausedAt: '',
      pausedUntil: '',
      lastRecoveredAt: new Date().toISOString(),
      rewardCooldownDate: rewardRecovered ? '' : health.rewardCooldownDate || '',
      rewardCooldownCount: rewardRecovered ? 0 : Math.max(0, Number(health.rewardCooldownCount) || 0),
      pauseSource: '',
      pauseTaskId: ''
    };
    return { recovered: true };
  }
  return {};
}

export function isGlobalBlockingIncident(incident = {}) {
  const code = String(incident.code || incident.reasonCode || '');
  return new Set([
    'RATE_LIMITED',
    'RATE_LIMIT_CONFIRMED',
    'LOGIN_REQUIRED',
    'SECURITY_CHALLENGE',
    'SECURITY_CHALLENGE_DATADOME',
    'SECURITY_CHALLENGE_CLOUDFLARE',
    'CAPTCHA_REQUIRED'
  ]).has(code);
}

function incidentPauseMilliseconds(incident, now = new Date()) {
  if (['RATE_LIMITED', 'RATE_LIMIT_CONFIRMED'].includes(incident.code)) {
    return parseRetryAfterMilliseconds(incident.retryAfter, now) ?? 60 * 60 * 1000;
  }
  if (['BROWSER_PROFILE_LOCKED', 'BROWSER_CLOSED'].includes(incident.code)) return 30 * 60 * 1000;
  if (incident.code === 'LOGIN_REQUIRED') return 24 * 60 * 60 * 1000;
  if (['SECURITY_CHALLENGE', 'SECURITY_CHALLENGE_DATADOME', 'SECURITY_CHALLENGE_CLOUDFLARE', 'CAPTCHA_REQUIRED'].includes(incident.code)) {
    return 12 * 60 * 60 * 1000;
  }
  return 6 * 60 * 60 * 1000;
}

export function parseRetryAfterMilliseconds(value, now = new Date()) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return Math.max(60 * 1000, Math.ceil(Number(raw) * 1000));
  }

  const retryAt = Date.parse(raw);
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(60 * 1000, retryAt - new Date(now).getTime());
}

function minutesUntilTomorrow(now) {
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 15, 0, 0);
  return Math.max(1, Math.ceil((tomorrow.getTime() - now.getTime()) / 60000));
}

function localDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatPauseUntil(value, timezone = 'Europe/Madrid') {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone || 'Europe/Madrid',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function shouldNotifyIncident(config, taskId) {
  if (!config.telegram?.enabled) return false;
  if (taskId === 'creality') return config.telegram.notifyOnError !== false;
  if (taskId === 'modelDownloads') return config.telegram.notifyOnDesignError !== false;
  if (taskId === 'modelLikes') return config.telegram.notifyOnModelLikeError !== false;
  if (taskId === 'finishPrint') return config.telegram.notifyOnFinishPrintError !== false;
  if (taskId === 'comments') return config.telegram.notifyOnCommentError !== false;
  if (taskId === 'modelBoosts') return config.telegram.notifyOnModelBoostError !== false;
  return config.telegram.notifyOnModelCollectionError !== false;
}

function publicError(failure = {}) {
  return failure.diagnostic?.message || failure.error || 'Error desconocido';
}

function dayKey(timezone, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function escapeTelegramHtml(value) {
  return String(value || '').replace(/[&<>]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
  })[char]);
}

function escapeTelegramHtmlAttribute(value) {
  return escapeTelegramHtml(value).replace(/"/g, '&quot;');
}
