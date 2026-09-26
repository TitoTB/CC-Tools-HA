import { normalizeGcodeFiles, normalizeGcodeRecords } from './finishPrintSelection.js';

const PROFILE_FIELDS = [
  'windowStart', 'windowEnd', 'dailyLimit', 'minIntervalMinutes',
  'printMode',
  'printerName', 'printerDeviceId', 'printerDeviceName', 'printerInterName', 'printerDeviceType',
  'cloudFiles', 'cloudFileRecords', 'fileUsageCounts', 'shuffleBag', 'shuffleBagCursor',
  'discoveryUpdatedAt', 'printPlanDate', 'printPlan', 'printPlanCursor',
  'printPlanDoneCount', 'nextRunAt'
];

export function normalizeFinishPrintProfiles(task = {}) {
  const source = Array.isArray(task.printerProfiles) && task.printerProfiles.length
    ? task.printerProfiles
    : task.printerName ? [legacyProfile(task)] : [];
  const seen = new Set();
  return source.map((profile, index) => normalizeProfile(profile, index))
    .filter((profile) => {
      if (seen.has(profile.id)) return false;
      seen.add(profile.id);
      return true;
    });
}

export function syncActiveFinishPrintProfile(task = {}) {
  const profiles = normalizeFinishPrintProfiles(task);
  const active = profiles.find((profile) => profile.id === task.activePrinterProfileId);
  if (active) copyFields(task, active);
  task.printerProfiles = profiles;
  return active || null;
}

export function activateFinishPrintProfile(task = {}, profileOrId) {
  const profiles = normalizeFinishPrintProfiles(task);
  const requestedId = typeof profileOrId === 'string' ? profileOrId : profileOrId?.id;
  const profile = profiles.find((item) => item.id === requestedId) || profiles[0];
  task.printerProfiles = profiles;
  task.activePrinterProfileId = profile?.id || '';
  if (profile) copyFields(profile, task);
  return profile || null;
}

export function activateNextFinishPrintProfile(task = {}, options = {}) {
  if (options.sync !== false) syncActiveFinishPrintProfile(task);
  const profiles = normalizeFinishPrintProfiles(task);
  const scheduled = profiles.filter((profile) => profile.nextRunAt)
    .sort((left, right) => Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt));
  return activateFinishPrintProfile(task, scheduled[0] || profiles[0]);
}

export function finishPrintProfileForPending(task = {}, pending = task.pendingVerification) {
  const profiles = normalizeFinishPrintProfiles(task);
  task.printerProfiles = profiles;
  return profiles.find((profile) => profile.id === pending?.printerProfileId)
    || profiles.find((profile) => profile.printerName === pending?.printerName)
    || (pending?.manualSelection === true ? task : null)
    || profiles.find((profile) => profile.id === task.activePrinterProfileId)
    || profiles[0];
}

export function totalFinishPrintDailyLimit(task = {}) {
  return normalizeFinishPrintProfiles(task)
    .reduce((total, profile) => total + profile.dailyLimit, 0);
}

function legacyProfile(task) {
  return Object.fromEntries(['id', ...PROFILE_FIELDS].map((key) => [key, key === 'id' ? 'printer-1' : task[key]]));
}

function normalizeProfile(profile = {}, index = 0) {
  const cloudFiles = normalizeGcodeFiles(profile.cloudFiles);
  const cloudFileRecords = normalizeGcodeRecords(profile.cloudFileRecords)
    .filter((record) => cloudFiles.includes(record.name));
  const id = String(profile.id || `printer-${index + 1}`).trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
    || `printer-${index + 1}`;
  return {
    id,
    windowStart: validClock(profile.windowStart, '08:00'),
    windowEnd: validClock(profile.windowEnd, '20:00'),
    dailyLimit: clamp(profile.dailyLimit, 0, 10, 1),
    minIntervalMinutes: clamp(profile.minIntervalMinutes, 10, 1440, 10),
    printMode: ['quantities', 'ordered', 'random'].includes(profile.printMode) ? profile.printMode : 'random',
    printerName: String(profile.printerName || '').trim().slice(0, 120),
    printerDeviceId: String(profile.printerDeviceId || '').trim().slice(0, 120),
    printerDeviceName: String(profile.printerDeviceName || '').trim().slice(0, 160),
    printerInterName: String(profile.printerInterName || '').trim().slice(0, 120),
    printerDeviceType: profile.printerDeviceType !== null
      && profile.printerDeviceType !== ''
      && Number.isFinite(Number(profile.printerDeviceType))
      ? Number(profile.printerDeviceType)
      : null,
    cloudFiles,
    cloudFileRecords,
    fileUsageCounts: profile.fileUsageCounts && typeof profile.fileUsageCounts === 'object' ? { ...profile.fileUsageCounts } : {},
    shuffleBag: Array.isArray(profile.shuffleBag) ? profile.shuffleBag.filter((file) => cloudFiles.includes(file)) : [],
    shuffleBagCursor: Math.max(0, Number(profile.shuffleBagCursor) || 0),
    discoveryUpdatedAt: String(profile.discoveryUpdatedAt || ''),
    printPlanDate: String(profile.printPlanDate || ''),
    printPlan: Array.isArray(profile.printPlan) ? profile.printPlan.map(String) : [],
    printPlanCursor: Math.max(0, Number(profile.printPlanCursor) || 0),
    printPlanDoneCount: Math.max(0, Number(profile.printPlanDoneCount) || 0),
    nextRunAt: String(profile.nextRunAt || '')
  };
}

function copyFields(source, target) {
  for (const key of PROFILE_FIELDS) {
    const value = source[key];
    if (value === undefined) continue;
    target[key] = Array.isArray(value) ? [...value] : value && typeof value === 'object' ? { ...value } : value;
  }
}

function validClock(value, fallback) {
  return /^\d{1,2}:\d{2}$/.test(String(value || '')) ? String(value) : fallback;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
