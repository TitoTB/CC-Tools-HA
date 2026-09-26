import { verifyVirtualPrint } from './finishPrintExecution.js';
import { buildPrintShuffleBag } from './finishPrintSelection.js';
import { mergePointsState } from './pointsCounter.js';
import { appendRun, readConfig, readRuns, writeConfig } from './storage.js';
import { sendTelegram } from './telegram.js';
import { finishPrintProfileForPending, normalizeFinishPrintProfiles } from './finishPrintProfiles.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_INTERVAL_MS = 5 * 60 * 1000;
export const MAX_REWARD_VERIFICATION_ATTEMPTS = 3;

let timer = null;
let checking = false;

export function startFinishPrintMonitor() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    checkPendingFinishPrint().catch((error) => console.error('[finish-print-monitor]', error.message));
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
  checkPendingFinishPrint().catch((error) => console.error('[finish-print-monitor]', error.message));
}

export function stopFinishPrintMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function recoverStalePendingFinishPrint(now = new Date()) {
  const config = await readConfig();
  const pending = config.tasks.finishPrint.pendingVerification;
  if (!isCompletedPendingFromPreviousDay(pending, now)) return { status: 'unchanged' };

  return finalizeCompletedWithoutVerifiedReward(config, pending, {
    printRecord: pending.printRecord,
    rewardVerification: {
      status: 'unverified',
      before: pending.rewardBefore
    }
  });
}

export async function checkPendingFinishPrint() {
  if (checking) return { status: 'busy' };
  const config = await readConfig();
  const pending = config.tasks.finishPrint.pendingVerification;
  if (!pending?.printId) {
    const runs = await readRuns();
    let learned = 0;
    const profiles = normalizeFinishPrintProfiles(config.tasks.finishPrint);
    for (const profile of profiles) learned += learnPrintDurationsFromRuns(profile, runs);
    config.tasks.finishPrint.printerProfiles = profiles;
    if (learned) await writeConfig(config);
    return { status: 'idle', learned };
  }
  if (pending.nextCheckAt && new Date(pending.nextCheckAt).getTime() > Date.now()) {
    return { status: 'waiting' };
  }

  checking = true;
  try {
    const result = await verifyVirtualPrint({
      printId: pending.printId,
      gcodeId: pending.file?.id,
      rewardBefore: pending.rewardBefore,
      timezone: pending.timezone
    });
    const freshConfig = await readConfig();
    const current = freshConfig.tasks.finishPrint.pendingVerification;
    if (current?.printId !== pending.printId) return { status: 'replaced' };

    if (result.status === 'printing') {
      current.lastCheckedAt = new Date().toISOString();
      current.nextCheckAt = new Date(Date.now() + CHECK_INTERVAL_MS).toISOString();
      current.printRecord = result.printRecord;
      await writeConfig(freshConfig);
      return result;
    }

    if (result.status === 'unverified') {
      const attempts = Math.max(0, Number(current.verificationAttempts) || 0) + 1;
      if (shouldStopRewardVerification(result.printRecord, attempts)) {
        current.verificationAttempts = attempts;
        return finalizeCompletedWithoutVerifiedReward(freshConfig, current, result);
      }
      scheduleVerificationRetry(current, result.printRecord, attempts);
      await writeConfig(freshConfig);
      return result;
    }

    const credited = ['credited', 'already_completed'].includes(result.status);
    if (!credited && result.status !== 'not_credited') {
      current.lastCheckedAt = new Date().toISOString();
      current.nextCheckAt = new Date(Date.now() + RETRY_INTERVAL_MS).toISOString();
      current.verificationAttempts = Math.max(0, Number(current.verificationAttempts) || 0) + 1;
      await writeConfig(freshConfig);
      return result;
    }
    if (result.status === 'credited' && printRewardPointsPending(
      current.rewardBefore,
      result.rewardVerification?.after,
      freshConfig.tasks.finishPrint.pointsPerPrint
    )) {
      const attempts = Math.max(0, Number(current.verificationAttempts) || 0) + 1;
      if (shouldStopRewardVerification(result.printRecord, attempts)) {
        current.verificationAttempts = attempts;
        return finalizeCompletedWithoutVerifiedReward(freshConfig, current, {
          ...result,
          rewardVerification: {
            ...result.rewardVerification,
            status: 'unverified'
          }
        });
      }
      scheduleVerificationRetry(current, result.printRecord, attempts);
      await writeConfig(freshConfig);
      return { ...result, status: 'points_pending' };
    }
    const file = current.file || {};
    const printerProfile = finishPrintProfileForPending(freshConfig.tasks.finishPrint, current);
    learnPrintDuration(printerProfile, file, result.printRecord);
    if (!credited) removeUncreditedPrintFile(printerProfile, file);
    freshConfig.tasks.finishPrint.pendingVerification = null;
    freshConfig.tasks.finishPrint.lastRunAt = new Date().toISOString();
    freshConfig.tasks.finishPrint.lastStatus = credited ? 'success' : 'failed';
    freshConfig.tasks.finishPrint.lastMessage = credited
      ? `Impresión verificada: ${file.name || 'G-code'} acreditó la recompensa.`
      : `Impresión no acreditada: ${file.name || 'G-code'} se retiró de la selección automática.`;
    const points = result.rewardVerification?.after?.pointsSummary;
    if (points) freshConfig.points = mergePointsState(freshConfig.points, points);
    await writeConfig(freshConfig);
    await appendRun({
      taskId: 'finishPrint',
      source: current.source || 'schedule',
      status: credited ? 'success' : 'failed',
      message: freshConfig.tasks.finishPrint.lastMessage,
      finishedAt: freshConfig.tasks.finishPrint.lastRunAt,
      details: {
        file,
        printRecord: result.printRecord,
        rewardVerification: result.rewardVerification,
        removedFromAutomaticSelection: !credited
      }
    });
    const notificationEnabled = credited
      ? freshConfig.telegram.notifyOnFinishPrint !== false
      : freshConfig.telegram.notifyOnFinishPrintError !== false;
    if (notificationEnabled) {
      const message = credited
        ? `✅ CC Tools: Impresión virtual completada\n${file.name || 'G-code'}\nRecompensa verificada.`
        : `❌ CC Tools: Impresión virtual sin recompensa\n${file.name || 'G-code'}\nEl archivo se ha retirado de la selección automática.`;
      await sendTelegram(freshConfig, message).catch((error) => {
        console.error('[telegram]', error.message);
      });
    }
    return result;
  } catch (error) {
    const freshConfig = await readConfig();
    const current = freshConfig.tasks.finishPrint.pendingVerification;
    if (current?.printId === pending.printId) {
      if (error.code === 'FINISH_PRINT_RECORD_NOT_FOUND') {
        if (current.printRecord?.completed) {
          return finalizeCompletedWithoutVerifiedReward(freshConfig, current, {
            printRecord: current.printRecord,
            rewardVerification: { status: 'unverified', before: current.rewardBefore }
          });
        }
        freshConfig.tasks.finishPrint.pendingVerification = null;
        freshConfig.tasks.finishPrint.lastRunAt = new Date().toISOString();
        freshConfig.tasks.finishPrint.lastStatus = 'failed';
        freshConfig.tasks.finishPrint.lastMessage = 'La impresión pendiente ya no existe en Creality Cloud; se liberó el bloqueo.';
        await writeConfig(freshConfig);
        return { status: 'stale_cleared', error: error.code || error.message || String(error) };
      }
      current.lastCheckedAt = new Date().toISOString();
      current.nextCheckAt = new Date(Date.now() + RETRY_INTERVAL_MS).toISOString();
      current.verificationError = error.code || error.message || String(error);
      await writeConfig(freshConfig);
    }
    return { status: 'retry', error: error.code || error.message || String(error) };
  } finally {
    checking = false;
  }
}

export function shouldStopRewardVerification(printRecord, attempts) {
  return Boolean(printRecord?.completed)
    && Math.max(0, Number(attempts) || 0) >= MAX_REWARD_VERIFICATION_ATTEMPTS;
}

function scheduleVerificationRetry(pending, printRecord, attempts) {
  pending.lastCheckedAt = new Date().toISOString();
  pending.nextCheckAt = new Date(Date.now() + RETRY_INTERVAL_MS).toISOString();
  pending.verificationAttempts = attempts;
  pending.printRecord = printRecord;
}

async function finalizeCompletedWithoutVerifiedReward(config, pending, result) {
  const file = pending.file || {};
  const finishedAt = new Date().toISOString();
  const rewardVerification = {
    ...result.rewardVerification,
    status: 'unverified'
  };

  const printerProfile = finishPrintProfileForPending(config.tasks.finishPrint, pending);
  learnPrintDuration(printerProfile, file, result.printRecord);
  config.tasks.finishPrint.pendingVerification = null;
  config.tasks.finishPrint.lastRunAt = finishedAt;
  config.tasks.finishPrint.lastStatus = 'success';
  config.tasks.finishPrint.lastMessage = `Impresión finalizada: ${file.name || 'G-code'}. No se pudo verificar la recompensa.`;
  const points = rewardVerification.after?.pointsSummary;
  if (points) config.points = mergePointsState(config.points, points);
  await writeConfig(config);
  await appendRun({
    taskId: 'finishPrint',
    source: pending.source || 'schedule',
    status: 'success',
    message: config.tasks.finishPrint.lastMessage,
    finishedAt,
    details: {
      file,
      printRecord: result.printRecord,
      rewardVerification,
      verificationAttempts: Math.max(0, Number(pending.verificationAttempts) || 0)
    }
  });
  return {
    ...result,
    status: 'completed_unverified',
    rewardVerification
  };
}

export function isCompletedPendingFromPreviousDay(pending, now = new Date()) {
  if (!pending?.printId || !pending.printRecord?.completed || !pending.startedAt) return false;
  const timezone = pending.timezone || 'Europe/Madrid';
  return localDayKey(new Date(pending.startedAt), timezone) < localDayKey(now, timezone);
}

function localDayKey(date, timezone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function printRewardPointsPending(before, after, expectedPoints = 5) {
  const beforeTotal = Number(before?.pointsSummary?.total);
  const afterTotal = Number(after?.pointsSummary?.total);
  const expected = Math.max(0, Number(expectedPoints) || 0);
  if (!Number.isFinite(beforeTotal) || !Number.isFinite(afterTotal) || expected <= 0) return false;
  return afterTotal < beforeTotal + expected;
}

export function removeUncreditedPrintFile(finishPrint, file, random = Math.random) {
  const id = String(file?.id || '').trim();
  const name = String(file?.name || '').trim();
  finishPrint.cloudFiles = (finishPrint.cloudFiles || []).filter((item) => item !== name);
  finishPrint.cloudFileRecords = (finishPrint.cloudFileRecords || [])
    .filter((item) => (id && item?.id !== id) || (!id && item?.name !== name));
  finishPrint.shuffleBag = buildPrintShuffleBag(finishPrint, random);
  finishPrint.shuffleBagCursor = 0;
  return finishPrint;
}

export function learnPrintDuration(finishPrint, file, printRecord) {
  const duration = printRecordDurationSeconds(printRecord);
  if (!duration) return 0;

  const id = String(file?.id || '').trim();
  const name = String(file?.name || '').trim();
  const record = (finishPrint.cloudFileRecords || []).find((item) =>
    (id && String(item?.id || '').trim() === id)
      || (!id && name && String(item?.name || '').trim() === name));
  if (!record || Number(record.printTime) > 0) return Math.max(0, Number(record?.printTime) || 0);

  record.printTime = duration;
  file.printTime = duration;
  return duration;
}

export function learnPrintDurationsFromRuns(finishPrint, runs = []) {
  let learned = 0;
  for (const run of Array.isArray(runs) ? runs : []) {
    if (run?.taskId !== 'finishPrint' || !run?.details?.printRecord?.completed) continue;
    const file = run.details.file || {};
    const id = String(file?.id || '').trim();
    const name = String(file?.name || '').trim();
    const before = (finishPrint.cloudFileRecords || []).find((record) =>
      (id && String(record?.id || '').trim() === id)
        || (name && String(record?.name || '').trim() === name));
    const previous = Math.max(0, Number(before?.printTime) || 0);
    const duration = learnPrintDuration(finishPrint, file, run.details.printRecord);
    if (!previous && duration) learned += 1;
  }
  return learned;
}

export function printRecordDurationSeconds(printRecord = {}) {
  const startedAt = normalizePrintTimestamp(printRecord.printStartTime);
  const finishedAt = normalizePrintTimestamp(printRecord.printEndTime);
  if (startedAt && finishedAt > startedAt) return Math.max(1, Math.round(finishedAt - startedAt));

  const printJobTime = Math.max(0, Number(printRecord.printJobTime) || 0);
  return printJobTime ? Math.max(1, Math.round(printJobTime)) : 0;
}

function normalizePrintTimestamp(value) {
  const timestamp = Math.max(0, Number(value) || 0);
  if (!timestamp) return 0;
  return timestamp >= 1e12 ? timestamp / 1000 : timestamp;
}
