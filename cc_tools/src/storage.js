import fs from 'fs/promises';
import path from 'path';
import { canonicalModelUrl, modelKeyFromUrl, modelSlugFromUrl, sameModelIdentity } from './modelIdentity.js';
import { DEFAULT_FAVORITE_PROFILE, normalizeFavoriteProfiles } from './favoriteProfiles.js';
import { activateFinishPrintProfile, normalizeFinishPrintProfiles } from './finishPrintProfiles.js';
import { normalizeShopOrdersState } from './shopOrdersState.js';
import { mergePointTransactions } from './pointsCounter.js';

const DATA_DIR = process.env.CCTOOLS_DATA_DIR || path.resolve('data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const CONFIG_BACKUP_PATH = path.join(DATA_DIR, 'config.json.bak');
const LOGS_PATH = path.join(DATA_DIR, 'runs.json');
const DESIGNS_PATH = path.join(DATA_DIR, 'designs.json');
const EXCLUDED_DESIGNS_PATH = path.join(DATA_DIR, 'excluded-designs.json');
const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');
const SESSION_DIR = path.join(DATA_DIR, 'browser-session');
const TEMP_DOWNLOADS_DIR = path.join(DATA_DIR, 'temp-downloads');
const COMMENT_IMAGES_DIR = path.join(DATA_DIR, 'comment-images');
const CONFIG_BASELINE = Symbol('configBaseline');

let configQueue = Promise.resolve();
let runsQueue = Promise.resolve();
let designsQueue = Promise.resolve();
let configBackupReady = false;

const DEFAULT_CONFIG = {
  timezone: 'Europe/Madrid',
  setup: {
    assistantCompleted: false
  },
  crealityProfile: {
    userId: '',
    name: '',
    avatarUrl: '',
    updatedAt: ''
  },
  crealityFavorites: [{ ...DEFAULT_FAVORITE_PROFILE }],
  automationHealth: {
    state: 'active',
    reasonCode: '',
    reason: '',
    pausedAt: '',
    pausedUntil: '',
    lastIncidentAt: '',
    lastRecoveredAt: '',
    rewardCooldownDate: '',
    rewardCooldownCount: 0,
    pauseSource: ''
  },
  points: {
    total: null,
    previousDayTotal: null,
    earnedToday: 0,
    transactionCount: 0,
    transactions: [],
    date: '',
    updatedAt: '',
    checkedAt: '',
    status: 'unavailable',
    historyComplete: false,
    error: ''
  },
  shopGoal: normalizeStoredShopGoal(),
  shopOrders: normalizeShopOrdersState(),
  telegram: {
    botToken: '',
    chatId: '',
    enabled: false,
    notifyOnSuccess: true,
    notifyOnError: true,
    notifyOnDesignDownload: true,
    notifyOnDesignError: true,
    notifyOnModelLike: true,
    notifyOnModelLikeError: true,
    notifyOnFinishPrint: true,
    notifyOnFinishPrintError: true,
    notifyOnModelCollection: true,
    notifyOnModelCollectionError: true,
    notifyOnComment: true,
    notifyOnCommentError: true,
    notifyOnModelBoost: true,
    notifyOnModelBoostError: true,
    notifyOnShopRedemption: true,
    notifyOnShopRedemptionError: true,
    notifyOnShopOrderShipped: true
  },
  tasks: {
    creality: {
      enabled: false,
      windowStart: '08:00',
      windowEnd: '12:00',
      timezone: 'Europe/Madrid',
      nextRunAt: '',
      lastRunAt: '',
      lastStatus: 'never',
      lastMessage: '',
      retainDays: 5
    },
    finishPrint: {
      enabled: false,
      windowStart: '08:00',
      windowEnd: '20:00',
      timezone: 'Europe/Madrid',
      dailyLimit: 10,
      totalDailyLimit: 10,
      pointsPerPrint: 5,
      minIntervalMinutes: 10,
      printMode: 'random',
      printerName: '',
      printerDeviceId: '',
      printerDeviceName: '',
      printerInterName: '',
      printerDeviceType: null,
      cloudFiles: [],
      cloudFileRecords: [],
      fileUsageCounts: {},
      usageHistoryImportedAt: '',
      shuffleBag: [],
      shuffleBagCursor: 0,
      printerProfiles: [],
      activePrinterProfileId: '',
      pendingVerification: null,
      discoveryUpdatedAt: '',
      printPlanDate: '',
      printPlan: [],
      printPlanCursor: 0,
      printPlanDoneCount: 0,
      nextRunAt: '',
      lastRunAt: '',
      lastStatus: 'never',
      lastMessage: ''
    },
    modelDownloads: {
      enabled: false,
      windowStart: '08:00',
      windowEnd: '12:00',
      timezone: 'Europe/Madrid',
      dailyLimit: 1,
      minIntervalMinutes: 10,
      cleanupAfterHours: 1,
      prioritizeFavorites: true,
      catalogCategories: [],
      downloadPlanDate: '',
      downloadPlan: [],
      downloadPlanCursor: 0,
      downloadPlanDoneCount: 0,
      downloadsToday: 0,
      nextRunAt: '',
      lastRunAt: '',
      lastStatus: 'never',
      lastMessage: ''
    },
    modelLikes: {
      enabled: false,
      windowStart: '08:00',
      windowEnd: '12:00',
      timezone: 'Europe/Madrid',
      prioritizeFavorites: true,
      dailyLimit: 1,
      nextRunAt: '',
      lastRunAt: '',
      lastStatus: 'never',
      lastMessage: ''
    },
    modelCollections: {
      enabled: false,
      windowStart: '08:00',
      windowEnd: '12:00',
      timezone: 'Europe/Madrid',
      dailyLimit: 1,
      nextRunAt: '',
      lastRunAt: '',
      lastStatus: 'never',
      lastMessage: ''
    },
    comments: {
      enabled: false,
      windowStart: '08:00',
      windowEnd: '20:00',
      timezone: 'Europe/Madrid',
      prioritizeFavorites: true,
      imageDailyLimit: 5,
      textDailyLimit: 1,
      dailyLimit: 6,
      minIntervalMinutes: 10,
      comments: [],
      commentPlanDate: '',
      commentPlan: [],
      commentKindPlan: [],
      commentPlanCursor: 0,
      commentPlanDoneCount: 0,
      nextRunAt: '',
      lastRunAt: '',
      lastStatus: 'never',
      lastMessage: ''
    },
    modelBoosts: {
      enabled: false,
      windowStart: '08:00',
      windowEnd: '12:00',
      timezone: 'Europe/Madrid',
      favoriteOnly: true,
      dailyLimit: 1,
      availableBoosts: 0,
      availabilityDate: '',
      availabilityCheckedAt: '',
      availabilityRetryAt: '',
      nextRunAt: '',
      lastRunAt: '',
      lastStatus: 'never',
      lastMessage: ''
    }
  }
};

export function dataDir() {
  return DATA_DIR;
}

export function screenshotsDir() {
  return SCREENSHOTS_DIR;
}

export function browserSessionDir() {
  return SESSION_DIR;
}

export function tempDownloadsDir() {
  return TEMP_DOWNLOADS_DIR;
}

export function commentImagesDir() {
  return COMMENT_IMAGES_DIR;
}

export async function ensureDataDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
  await fs.mkdir(SESSION_DIR, { recursive: true });
  await fs.mkdir(TEMP_DOWNLOADS_DIR, { recursive: true });
  await fs.mkdir(COMMENT_IMAGES_DIR, { recursive: true });
}

export async function readConfig() {
  return enqueue('config', async () => {
    await ensureDataDirs();
    const config = await loadConfigWithRecovery();
    return attachBaseline(config);
  });
}

export async function writeConfig(config) {
  const baseline = config?.[CONFIG_BASELINE] ? structuredClone(config[CONFIG_BASELINE]) : null;
  const requested = mergeConfig(DEFAULT_CONFIG, config);
  delete requested.auth;
  return enqueue('config', async () => {
    await ensureDataDirs();
    const current = await loadConfigWithRecovery();
    const merged = baseline
      ? mergeConfig(current, configPatch(baseline, requested))
      : requested;
    delete merged.auth;
    await writeConfigAtomic(merged);
    syncObject(config, merged);
    attachBaseline(config, merged);
    return merged;
  });
}

export async function readRuns() {
  await ensureDataDirs();
  try {
    const raw = await fs.readFile(LOGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return [];
  }
}

export async function appendRun(run) {
  return enqueue('runs', async () => {
    const runs = await readJsonArray(LOGS_PATH);
    runs.unshift({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...run
    });
    await writeJsonAtomic(LOGS_PATH, runs.slice(0, 200));
  });
}

export async function reconcileDownloadRewardHistory() {
  return enqueue('runs', async () => {
    const runs = await readJsonArray(LOGS_PATH);
    let changed = false;

    for (const run of runs) {
      if (run.taskId !== 'modelDownloads') continue;
      const downloaded = Array.isArray(run.details?.downloaded) ? run.details.downloaded : [];
      const unverified = downloaded.filter((design) => design.rewardStatus !== 'credited');
      if (!unverified.length) continue;

      const credited = downloaded.filter((design) => design.rewardStatus === 'credited');
      run.details = run.details || {};
      run.details.downloaded = credited;
      run.details.attemptedDownloads = [
        ...(Array.isArray(run.details.attemptedDownloads) ? run.details.attemptedDownloads : []),
        ...unverified
      ];
      run.details.failures = [
        ...(Array.isArray(run.details.failures) ? run.details.failures : []),
        ...unverified.map((design) => ({
          title: design.title || 'Diseño desconocido',
          url: design.url || '',
          code: 'REWARD_HISTORY_UNVERIFIED',
          category: 'reward',
          systemic: false,
          error: 'La descarga física se realizó, pero los puntos no fueron verificados.'
        }))
      ];
      run.status = credited.length === downloaded.length ? run.status : 'failed';
      run.message = `Diseños acreditados: ${credited.length}/${downloaded.length}. Sin verificar: ${unverified.length}.`;
      changed = true;
    }

    if (changed) await writeJsonAtomic(LOGS_PATH, runs);
    return changed;
  });
}

export async function readDesigns() {
  return enqueue('designs', () => readDesignsInternal(true));
}

export async function readExcludedDesigns() {
  return enqueue('designs', () => readJsonArray(EXCLUDED_DESIGNS_PATH));
}

async function readDesignsInternal(writeNormalized) {
  await ensureDataDirs();
  try {
    const raw = await fs.readFile(DESIGNS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const { designs, changed } = normalizeDesigns(parsed);
    if (changed && writeNormalized) {
      await writeJsonAtomic(DESIGNS_PATH, designs);
    }
    return designs;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return [];
  }
}

export async function appendDesign(design) {
  return enqueue('designs', async () => {
    const designs = await readDesignsInternal(false);
    const excludedDesigns = await readJsonArray(EXCLUDED_DESIGNS_PATH);
    const incoming = normalizeDesignRecord({
      ...design,
      url: canonicalModelUrl(design.url) || String(design.url || '')
    }).record;

    if (excludedDesigns.some((item) => sameModelIdentity(item, incoming))) {
      return { record: incoming, created: false, excluded: true };
    }

    if (incoming.url) {
      const existing = designs.find((item) => sameModelIdentity(item, incoming));
      if (!existing) {
        const exactUrl = designs.find((item) => item.url === incoming.url);
        if (exactUrl) return { record: exactUrl, created: false };
      }

      if (!existing) {
        const record = newDesignRecord(incoming);
        designs.unshift(record);
        await writeJsonAtomic(DESIGNS_PATH, designs);
        return { record, created: true };
      }

      let changed = false;
      for (const key of ['source', 'modelKey', 'modelSlug', 'author', 'authorUrl', 'category', 'ownerUserId', 'favoriteProfileId', 'favoriteProfileName']) {
        if (!existing[key] && incoming[key]) {
          existing[key] = incoming[key];
          changed = true;
        }
      }
      if (!existing.url && incoming.url) {
        existing.url = incoming.url;
        changed = true;
      }
      if (incoming.indexedOnly !== true && existing.indexedOnly === true) {
        existing.indexedOnly = false;
        existing.downloadedAt = incoming.downloadedAt || new Date().toISOString();
        changed = true;
      }
      if (incoming.indexedOnly !== true) {
        for (const key of ['title', 'category', 'fileName', 'fileSize', 'downloadVerified', 'rewardStatus']) {
          if (incoming[key] !== undefined && incoming[key] !== existing[key]) {
            existing[key] = incoming[key];
            changed = true;
          }
        }
      }
      if (incoming.favoriteActive === true && existing.favoriteActive !== true) {
        existing.favoriteActive = true;
        changed = true;
      }
      if (changed) await writeJsonAtomic(DESIGNS_PATH, designs);
      return { record: existing, created: false };
    }

    const record = newDesignRecord(incoming);
    designs.unshift(record);
    await writeJsonAtomic(DESIGNS_PATH, designs);
    return { record, created: true };
  });
}

export async function updateDesignAction(designId, actionKey, outcome = 'credited', rewardVerification = null) {
  return enqueue('designs', async () => {
    const designs = await readDesignsInternal(false);
    const design = designs.find((item) => item.id === designId);
    if (!design) return null;

    const now = new Date().toISOString();
    const isLike = actionKey === 'like_model';
    const prefix = isLike ? 'like' : 'collection';
    const completedField = `${prefix}Completed`;
    const completedAtField = `${prefix}CompletedAt`;
    const completed = ['credited', 'already_applied'].includes(outcome);
    design[completedField] = completed;
    design[completedAtField] = completed ? (design[completedAtField] || now) : '';
    design[`${prefix}ActionState`] = outcome;
    design[`${prefix}LastAttemptAt`] = now;
    design[`${prefix}RewardStatus`] = rewardVerification?.status || '';
    design[`${prefix}ManualOverrideAt`] = '';
    design.updatedAt = now;

    await writeJsonAtomic(DESIGNS_PATH, designs);
    return design;
  });
}

export async function reconcileFavoriteModels(profile, models = [], options = {}) {
  return enqueue('designs', async () => {
    const designs = await readDesignsInternal(false);
    const now = new Date().toISOString();
    const seen = new Set();
    let created = 0;
    let updated = 0;

    for (const model of models) {
      const incoming = normalizeDesignRecord({
        ...model,
        source: 'favorite',
        indexedOnly: true,
        favoriteActive: true,
        favoriteAvailability: 'active',
        favoriteMissingScans: 0,
        favoriteProfileId: String(profile.userId || ''),
        favoriteProfileName: String(profile.name || ''),
        ownerUserId: String(profile.userId || ''),
        author: String(profile.name || ''),
        authorUrl: String(profile.profileUrl || ''),
        lastSeenAt: now,
        discoveredAt: model.discoveredAt || now,
        downloadedAt: ''
      }).record;
      const key = incoming.modelKey || incoming.url;
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const existing = designs.find((item) => sameModelIdentity(item, incoming));
      if (!existing) {
        designs.unshift(newDesignRecord(incoming));
        created += 1;
        continue;
      }

      for (const keyName of ['url', 'modelKey', 'modelSlug', 'title', 'author', 'authorUrl', 'ownerUserId', 'favoriteProfileId', 'favoriteProfileName', 'lastSeenAt']) {
        if (incoming[keyName] && existing[keyName] !== incoming[keyName]) existing[keyName] = incoming[keyName];
      }
      if (!existing.discoveredAt && incoming.discoveredAt) existing.discoveredAt = incoming.discoveredAt;
      existing.favoriteActive = true;
      existing.favoriteProfileRemoved = false;
      existing.favoriteAvailability = 'active';
      existing.favoriteMissingScans = 0;
      existing.updatedAt = existing.updatedAt || now;
      updated += 1;
    }

    if (options.full === true) {
      for (const design of designs) {
        if (String(design.favoriteProfileId || '') !== String(profile.userId || '')) continue;
        const key = design.modelKey || design.url;
        if (seen.has(key)) continue;
        design.favoriteMissingScans = Math.max(0, Number(design.favoriteMissingScans) || 0) + 1;
        design.favoriteAvailability = design.favoriteMissingScans >= 2 ? 'unavailable' : 'missing';
        design.favoriteActive = false;
        design.lastMissingAt = now;
        updated += 1;
      }
    }

    await writeJsonAtomic(DESIGNS_PATH, designs);
    return { created, updated, seen: seen.size };
  });
}

export async function deactivateFavoriteProfile(userId) {
  return enqueue('designs', async () => {
    const designs = await readDesignsInternal(false);
    let changed = 0;
    for (const design of designs) {
      if (String(design.favoriteProfileId || '') !== String(userId || '')) continue;
      design.favoriteActive = false;
      design.favoriteProfileRemoved = true;
      changed += 1;
    }
    if (changed) await writeJsonAtomic(DESIGNS_PATH, designs);
    return changed;
  });
}

export async function updateDesignOwnership(designId, ownership = {}, ownUserId = '') {
  return updateDesignMetadata(designId, ownership, ownUserId);
}

export async function updateDesignMetadata(designId, metadata = {}, ownUserId = '') {
  return enqueue('designs', async () => {
    const designs = await readDesignsInternal(false);
    const design = designs.find((item) => item.id === designId);
    if (!design) return null;

    const ownerUserId = String(metadata.ownerUserId || '').trim();
    if (metadata.author) design.author = String(metadata.author).trim();
    if (metadata.authorUrl) design.authorUrl = String(metadata.authorUrl).trim();
    if (metadata.category) design.category = String(metadata.category).trim();
    if (metadata.categoryRepairAttemptAt) {
      design.categoryRepairAttemptAt = String(metadata.categoryRepairAttemptAt);
    }
    if (ownerUserId) {
      design.ownerUserId = ownerUserId;
      design.isOwnModel = ownerUserId === String(ownUserId || '').trim();
    }
    await writeJsonAtomic(DESIGNS_PATH, designs);
    return design;
  });
}

export async function reconcileDownloadedDesignHistory() {
  const runs = await readRuns();
  const records = runs.flatMap((run) => run?.taskId === 'modelDownloads'
    && Array.isArray(run.details?.downloaded) ? run.details.downloaded : [])
    .filter((record) => record?.url);

  let restored = 0;
  for (const record of records) {
    const result = await appendDesign(record);
    if (result.created) restored += 1;
  }
  return restored;
}

export async function markDesignCommented(designId, comment = {}) {
  return enqueue('designs', async () => {
    const designs = await readDesignsInternal(false);
    const design = designs.find((item) => item.id === designId);
    if (!design) return null;

    const now = new Date().toISOString();
    design.commentCompleted = true;
    design.commentCompletedAt = design.commentCompletedAt || comment.completedAt || now;
    design.commentKind = comment.kind === 'image' ? 'image' : 'text';
    design.commentActionState = comment.actionState === 'already_applied' ? 'already_applied' : 'published';
    design.commentLastAttemptAt = now;
    design.updatedAt = now;

    await writeJsonAtomic(DESIGNS_PATH, designs);
    return design;
  });
}

export async function markDesignCommentUnavailable(designId) {
  return enqueue('designs', async () => {
    const designs = await readDesignsInternal(false);
    const design = designs.find((item) => item.id === designId);
    if (!design) return null;

    design.commentUnavailable = true;
    await writeJsonAtomic(DESIGNS_PATH, designs);
    return design;
  });
}

export async function markDesignBoosted(designId) {
  return enqueue('designs', async () => {
    const designs = await readDesignsInternal(false);
    const design = designs.find((item) => item.id === designId);
    if (!design) return null;

    const now = new Date().toISOString();
    design.boostCount = Math.max(0, Number(design.boostCount) || 0) + 1;
    design.boostLastAt = now;
    design.updatedAt = now;
    await writeJsonAtomic(DESIGNS_PATH, designs);
    return design;
  });
}

export async function reconcileDesignActionHistory() {
  return enqueue('designs', async () => {
    const designs = await readDesignsInternal(false);
    const runs = await readJsonArray(LOGS_PATH);
    const reconciled = new Set();
    let changed = false;

    for (const run of runs) {
      if (run.taskId === 'comments') {
        const commentRecords = Array.isArray(run.details?.commented) && run.details.commented.length
          ? run.details.commented
          : Array.isArray(run.details?.acted) ? run.details.acted : [];
        for (const record of commentRecords) {
          if (!record?.id || reconciled.has(`comment_model:${record.id}`)) continue;
          reconciled.add(`comment_model:${record.id}`);
          const design = designs.find((item) => item.id === record.id);
          if (!design) continue;
          const occurredAt = run.finishedAt || run.createdAt || '';
          design.commentCompleted = true;
          design.commentCompletedAt = design.commentCompletedAt || occurredAt;
          design.commentKind = record.commentKind || run.details?.commentKind || design.commentKind || 'text';
          design.commentActionState = 'published';
          design.commentLastAttemptAt = occurredAt;
          design.updatedAt = latestTimestamp([design.updatedAt, occurredAt]);
          changed = true;
        }
        continue;
      }

      const actionKey = run.taskId === 'modelLikes'
        ? 'like_model'
        : run.taskId === 'modelCollections' ? 'add_to_collection' : '';
      if (!actionKey) continue;

      const records = [
        ...(Array.isArray(run.details?.acted) ? run.details.acted : []),
        ...(run.details?.actionAttempt ? [run.details.actionAttempt] : [])
      ];
      for (const record of records) {
        const verification = record.rewardVerification || run.details?.rewardVerification;
        if (!record?.id || !verification?.status) continue;
        const key = `${actionKey}:${record.id}`;
        if (reconciled.has(key)) continue;
        reconciled.add(key);

        const design = designs.find((item) => item.id === record.id);
        if (!design) continue;
        const prefix = actionKey === 'like_model' ? 'like' : 'collection';
        const runAt = Date.parse(run.finishedAt || run.createdAt || '') || 0;
        const manualOverrideAt = Date.parse(design[`${prefix}ManualOverrideAt`] || '') || 0;
        if (manualOverrideAt > 0 && manualOverrideAt >= runAt) continue;
        const outcome = verification.status === 'credited'
          ? 'credited'
          : verification.status === 'not_credited' ? 'applied_uncredited' : 'ambiguous';
        design[`${prefix}Completed`] = outcome === 'credited';
        design[`${prefix}CompletedAt`] = outcome === 'credited'
          ? (design[`${prefix}CompletedAt`] || run.finishedAt || run.createdAt || '')
          : '';
        design[`${prefix}ActionState`] = outcome;
        design[`${prefix}LastAttemptAt`] = run.finishedAt || run.createdAt || '';
        design[`${prefix}RewardStatus`] = verification.status;
        design.updatedAt = latestTimestamp([design.updatedAt, run.finishedAt, run.createdAt]);
        changed = true;
      }
    }

    if (changed) await writeJsonAtomic(DESIGNS_PATH, designs);
    return changed;
  });
}

export async function excludeDesign(designId) {
  return enqueue('designs', async () => {
    const designs = await readDesignsInternal(false);
    const index = designs.findIndex((item) => item.id === designId);
    if (index < 0) return null;

    const [design] = designs.splice(index, 1);
    const excluded = await readJsonArray(EXCLUDED_DESIGNS_PATH);
    if (!excluded.some((item) => sameModelIdentity(item, design))) {
      excluded.unshift({
        id: design.id,
        title: design.title,
        url: design.url,
        modelKey: design.modelKey || modelKeyFromUrl(design.url),
        modelSlug: design.modelSlug || modelSlugFromUrl(design.url),
        excludedAt: new Date().toISOString()
      });
      await writeJsonAtomic(EXCLUDED_DESIGNS_PATH, excluded);
    }
    await writeJsonAtomic(DESIGNS_PATH, designs);
    return design;
  });
}

export async function excludeModelCandidate(design, reason = 'not_downloadable') {
  return enqueue('designs', async () => {
    const incoming = {
      id: crypto.randomUUID(),
      title: String(design?.title || 'Diseño no descargable'),
      url: canonicalModelUrl(design?.url) || String(design?.url || ''),
      modelKey: design?.modelKey || modelKeyFromUrl(design?.url),
      modelSlug: design?.modelSlug || modelSlugFromUrl(design?.url),
      author: String(design?.author || ''),
      authorUrl: String(design?.authorUrl || ''),
      ownerUserId: String(design?.ownerUserId || ''),
      isOwnModel: design?.isOwnModel === true,
      reason,
      excludedAt: new Date().toISOString()
    };
    if (!incoming.url) return { record: incoming, created: false };

    const excluded = await readJsonArray(EXCLUDED_DESIGNS_PATH);
    const existing = excluded.find((item) => sameModelIdentity(item, incoming));
    if (existing) return { record: existing, created: false };

    excluded.unshift(incoming);
    await writeJsonAtomic(EXCLUDED_DESIGNS_PATH, excluded);
    return { record: incoming, created: true };
  });
}

export async function cleanupOldScreenshots(retainDays) {
  await ensureDataDirs();
  const cutoff = Date.now() - Math.max(1, Number(retainDays) || 5) * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(SCREENSHOTS_DIR, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map(async (entry) => {
      const fullPath = path.join(SCREENSHOTS_DIR, entry.name);
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(fullPath).catch(() => {});
      }
    }));
}

export function scheduleTemporaryCleanup(directory, delayMs = 60 * 1000) {
  setTimeout(() => {
    fs.rm(directory, { recursive: true, force: true }).catch((error) => {
      console.error('[cleanup]', error.message);
    });
  }, delayMs).unref();
}

async function loadConfigWithRecovery() {
  let parsed;
  try {
    parsed = await readJsonObject(CONFIG_PATH);
  } catch (error) {
    let backup;
    try {
      const storedBackup = await readJsonObject(CONFIG_BACKUP_PATH);
      backup = normalizeStoredConfig(storedBackup);
    } catch (backupError) {
      if (error.code !== 'ENOENT' || backupError.code !== 'ENOENT') {
        console.error('[storage] No existe una configuración válida; se crearán valores iniciales.', {
          configError: error.message,
          backupError: backupError.message
        });
      }
      const initial = structuredClone(DEFAULT_CONFIG);
      await writeJsonAtomic(CONFIG_PATH, initial);
      await writeJsonAtomic(CONFIG_BACKUP_PATH, initial);
      configBackupReady = true;
      return initial;
    }

    console.error(`[storage] config.json no es válido; restaurando ${path.basename(CONFIG_BACKUP_PATH)}.`);
    await writeJsonAtomic(CONFIG_PATH, backup);
    configBackupReady = true;
    return backup;
  }

  const config = normalizeStoredConfig(parsed);
  if (Object.prototype.hasOwnProperty.call(parsed, 'auth')) {
    await writeJsonAtomic(CONFIG_PATH, config);
  }
  if (!configBackupReady) {
    await writeJsonAtomic(CONFIG_BACKUP_PATH, config);
    configBackupReady = true;
  }
  return config;
}

async function writeConfigAtomic(config) {
  await writeJsonAtomic(CONFIG_PATH, config);
  await writeJsonAtomic(CONFIG_BACKUP_PATH, config);
  configBackupReady = true;
}

export async function cleanupTemporaryDownloads(retainHours = 1) {
  const cutoff = Date.now() - Math.min(168, Math.max(1, Number(retainHours) || 1)) * 60 * 60 * 1000;
  const entries = await fs.readdir(TEMP_DOWNLOADS_DIR, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(TEMP_DOWNLOADS_DIR, entry.name);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) {
      await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {});
    }
  }));
}

export async function setDesignActionCompleted(designId, actionKey, completed) {
  return enqueue('designs', async () => {
    const designs = await readDesignsInternal(false);
    const design = designs.find((item) => item.id === designId);
    if (!design) return null;

    const prefix = actionKey === 'like_model'
      ? 'like'
      : actionKey === 'add_to_collection' ? 'collection' : '';
    if (!prefix) throw new Error('DESIGN_ACTION_INVALID');

    const isCompleted = Boolean(completed);
    design[`${prefix}Completed`] = isCompleted;
    design[`${prefix}CompletedAt`] = isCompleted ? new Date().toISOString() : '';
    design[`${prefix}ActionState`] = isCompleted ? 'manual_completed' : 'pending';
    design[`${prefix}RewardStatus`] = '';
    design[`${prefix}ManualOverrideAt`] = new Date().toISOString();
    design.updatedAt = new Date().toISOString();

    await writeJsonAtomic(DESIGNS_PATH, designs);
    return design;
  });
}

function normalizeStoredConfig(stored) {
  const config = mergeConfig(DEFAULT_CONFIG, stored);
  delete config.auth;
  const storedDownloadTask = config.tasks.modelDownloads;
  config.tasks.modelDownloads = Object.fromEntries(
    Object.keys(DEFAULT_CONFIG.tasks.modelDownloads).map((key) => [key, storedDownloadTask[key]])
  );
  config.crealityFavorites = normalizeFavoriteProfiles(config.crealityFavorites);
  config.shopGoal = normalizeStoredShopGoal(config.shopGoal);
  config.shopOrders = normalizeShopOrdersState(config.shopOrders);
  config.points.transactions = mergePointTransactions(config.points.transactions, []);
  config.tasks.finishPrint.printerProfiles = normalizeFinishPrintProfiles(config.tasks.finishPrint);
  activateFinishPrintProfile(
    config.tasks.finishPrint,
    config.tasks.finishPrint.activePrinterProfileId || config.tasks.finishPrint.printerProfiles[0]?.id
  );
  config.tasks.finishPrint.totalDailyLimit = config.tasks.finishPrint.printerProfiles
    .reduce((total, profile) => total + profile.dailyLimit, 0);
  const timezone = String(stored?.timezone || stored?.tasks?.creality?.timezone || DEFAULT_CONFIG.timezone);
  config.timezone = timezone;
  for (const task of Object.values(config.tasks)) {
    task.timezone = timezone;
  }
  if (config.tasks.finishPrint.pendingVerification) {
    config.tasks.finishPrint.pendingVerification.timezone = timezone;
  }
  return config;
}

async function readJsonObject(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  if (!raw.trim()) throw new SyntaxError(`${path.basename(filePath)} está vacío.`);
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SyntaxError(`${path.basename(filePath)} no contiene un objeto JSON.`);
  }
  return parsed;
}

async function readJsonArray(filePath) {
  await ensureDataDirs();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
  }
}

function enqueue(kind, operation) {
  const queue = kind === 'config' ? configQueue : kind === 'runs' ? runsQueue : designsQueue;
  const pending = queue.then(operation);
  const settled = pending.catch(() => {});
  if (kind === 'config') configQueue = settled;
  else if (kind === 'runs') runsQueue = settled;
  else designsQueue = settled;
  return pending;
}

function attachBaseline(config, baseline = config) {
  if (!config || typeof config !== 'object') return config;
  Object.defineProperty(config, CONFIG_BASELINE, {
    value: structuredClone(baseline),
    configurable: true,
    writable: true,
    enumerable: false
  });
  return config;
}

function syncObject(target, source) {
  if (!target || typeof target !== 'object') return;
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, structuredClone(source));
}

function configPatch(baseline, requested) {
  const patch = {};
  for (const [key, value] of Object.entries(requested)) {
    const previous = baseline?.[key];
    if (isPlainObject(value) && isPlainObject(previous)) {
      const nested = configPatch(previous, value);
      if (Object.keys(nested).length) patch[key] = nested;
    } else if (!sameValue(previous, value)) {
      patch[key] = structuredClone(value);
    }
  }
  return patch;
}

function sameValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function newDesignRecord(incoming) {
  const downloadedAt = incoming.indexedOnly === true ? String(incoming.downloadedAt || '') : (incoming.downloadedAt || new Date().toISOString());
  return {
    id: crypto.randomUUID(),
    downloadedAt,
    updatedAt: downloadedAt,
    title: 'Diseño sin título',
    author: '',
    authorUrl: '',
    ownerUserId: '',
    isOwnModel: false,
    likeCompleted: false,
    likeCompletedAt: '',
    likeActionState: 'pending',
    likeLastAttemptAt: '',
    likeRewardStatus: '',
    likeManualOverrideAt: '',
    collectionCompleted: false,
    collectionCompletedAt: '',
    collectionActionState: 'pending',
    collectionLastAttemptAt: '',
    collectionRewardStatus: '',
    collectionManualOverrideAt: '',
    commentCompleted: false,
    commentUnavailable: false,
    commentCompletedAt: '',
    commentKind: '',
    commentActionState: 'pending',
    commentLastAttemptAt: '',
    boostCount: 0,
    boostLastAt: '',
    indexedOnly: false,
    favoriteActive: false,
    favoriteAvailability: '',
    favoriteMissingScans: 0,
    favoriteProfileRemoved: false,
    ...incoming
  };
}

function mergeConfig(base, incoming) {
  const output = structuredClone(base);
  mergeInto(output, incoming || {});
  return output;
}

function mergeInto(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = target[key] && typeof target[key] === 'object' ? target[key] : {};
      mergeInto(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

function normalizeDesigns(input) {
  let changed = false;
  const designs = input.map((design) => {
    const result = normalizeDesignRecord(design);
    changed = changed || result.changed;
    return result.record;
  });
  return { designs, changed };
}

function normalizeDesignRecord(design) {
  const record = { ...design };
  let changed = false;
  const canonicalUrl = canonicalModelUrl(record.url) || String(record.url || '');
  const modelKey = record.modelKey || modelKeyFromUrl(canonicalUrl);
  const modelSlug = record.modelSlug || modelSlugFromUrl(canonicalUrl);

  if (record.url !== canonicalUrl) {
    record.url = canonicalUrl;
    changed = true;
  }
  if (modelKey && record.modelKey !== modelKey) {
    record.modelKey = modelKey;
    changed = true;
  }
  if (modelSlug && record.modelSlug !== modelSlug) {
    record.modelSlug = modelSlug;
    changed = true;
  }
  if (typeof record.author !== 'string') {
    record.author = '';
    changed = true;
  }
  if (typeof record.authorUrl !== 'string') {
    record.authorUrl = '';
    changed = true;
  }
  if (typeof record.category !== 'string') {
    record.category = '';
    changed = true;
  }
  if (typeof record.categoryRepairAttemptAt !== 'string') {
    record.categoryRepairAttemptAt = '';
    changed = true;
  }
  if (typeof record.ownerUserId !== 'string') {
    record.ownerUserId = '';
    changed = true;
  }
  if (typeof record.isOwnModel !== 'boolean') {
    record.isOwnModel = false;
    changed = true;
  }
  if (typeof record.indexedOnly !== 'boolean') {
    record.indexedOnly = false;
    changed = true;
  }
  if (typeof record.favoriteActive !== 'boolean') {
    record.favoriteActive = false;
    changed = true;
  }
  if (typeof record.favoriteAvailability !== 'string') {
    record.favoriteAvailability = '';
    changed = true;
  }
  if (!Number.isFinite(Number(record.favoriteMissingScans)) || Number(record.favoriteMissingScans) < 0) {
    record.favoriteMissingScans = 0;
    changed = true;
  }
  if (typeof record.favoriteProfileRemoved !== 'boolean') {
    record.favoriteProfileRemoved = false;
    changed = true;
  }
  if (typeof record.likeCompleted !== 'boolean') {
    record.likeCompleted = false;
    changed = true;
  }
  if (typeof record.likeCompletedAt !== 'string') {
    record.likeCompletedAt = '';
    changed = true;
  }
  if (typeof record.likeActionState !== 'string') {
    record.likeActionState = record.likeCompleted ? 'credited' : 'pending';
    changed = true;
  }
  if (typeof record.likeLastAttemptAt !== 'string') {
    record.likeLastAttemptAt = '';
    changed = true;
  }
  if (typeof record.likeRewardStatus !== 'string') {
    record.likeRewardStatus = record.likeCompleted ? 'credited' : '';
    changed = true;
  }
  if (typeof record.likeManualOverrideAt !== 'string') {
    record.likeManualOverrideAt = '';
    changed = true;
  }
  if (typeof record.collectionCompleted !== 'boolean') {
    record.collectionCompleted = false;
    changed = true;
  }
  if (typeof record.collectionCompletedAt !== 'string') {
    record.collectionCompletedAt = '';
    changed = true;
  }
  if (typeof record.collectionActionState !== 'string') {
    record.collectionActionState = record.collectionCompleted ? 'credited' : 'pending';
    changed = true;
  }
  if (typeof record.collectionLastAttemptAt !== 'string') {
    record.collectionLastAttemptAt = '';
    changed = true;
  }
  if (typeof record.collectionRewardStatus !== 'string') {
    record.collectionRewardStatus = record.collectionCompleted ? 'credited' : '';
    changed = true;
  }
  if (typeof record.collectionManualOverrideAt !== 'string') {
    record.collectionManualOverrideAt = '';
    changed = true;
  }
  if (typeof record.commentCompleted !== 'boolean') {
    record.commentCompleted = false;
    changed = true;
  }
  if (typeof record.commentUnavailable !== 'boolean') {
    record.commentUnavailable = false;
    changed = true;
  }
  if (typeof record.commentCompletedAt !== 'string') {
    record.commentCompletedAt = '';
    changed = true;
  }
  if (typeof record.commentKind !== 'string') {
    record.commentKind = '';
    changed = true;
  }
  if (typeof record.commentActionState !== 'string') {
    record.commentActionState = record.commentCompleted ? 'published' : 'pending';
    changed = true;
  }
  if (typeof record.commentLastAttemptAt !== 'string') {
    record.commentLastAttemptAt = '';
    changed = true;
  }
  if (!Number.isFinite(Number(record.boostCount)) || Number(record.boostCount) < 0) {
    record.boostCount = 0;
    changed = true;
  } else if (record.boostCount !== Math.floor(Number(record.boostCount))) {
    record.boostCount = Math.floor(Number(record.boostCount));
    changed = true;
  }
  if (typeof record.boostLastAt !== 'string') {
    record.boostLastAt = '';
    changed = true;
  }
  if (typeof record.updatedAt !== 'string' || !record.updatedAt) {
    record.updatedAt = latestTimestamp([
      record.downloadedAt,
      record.likeCompletedAt,
      record.likeLastAttemptAt,
      record.collectionCompletedAt,
      record.collectionLastAttemptAt,
      record.commentCompletedAt,
      record.commentLastAttemptAt,
      record.boostLastAt
    ]);
    changed = true;
  }
  if (typeof record.downloadVerified !== 'boolean') {
    record.downloadVerified = Boolean(record.fileName && Number(record.fileSize) > 0);
    changed = true;
  }
  if (typeof record.rewardStatus !== 'string') {
    record.rewardStatus = 'unverified';
    changed = true;
  }

  return { record, changed };
}

function normalizeStoredShopGoal(value = {}) {
  return {
    enabled: value.enabled === true,
    productId: String(value.productId || ''),
    name: String(value.name || ''),
    imageUrl: String(value.imageUrl || ''),
    points: Math.max(0, Number(value.points) || 0),
    region: String(value.region || 'ES'),
    regionName: String(value.regionName || ''),
    available: value.available !== false,
    scheduledAt: String(value.scheduledAt || ''),
    lastCheckedAt: String(value.lastCheckedAt || ''),
    lastAttemptAt: String(value.lastAttemptAt || ''),
    lastStatus: String(value.lastStatus || 'never'),
    lastMessage: String(value.lastMessage || ''),
    redeemedAt: String(value.redeemedAt || '')
  };
}

function latestTimestamp(values) {
  const timestamps = values
    .map((value) => ({ value: String(value || ''), time: Date.parse(value || '') }))
    .filter((entry) => Number.isFinite(entry.time));
  timestamps.sort((left, right) => right.time - left.time);
  return timestamps[0]?.value || new Date().toISOString();
}
