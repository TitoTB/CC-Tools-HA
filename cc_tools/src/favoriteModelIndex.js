import { withIsolatedBrowser } from './browserManager.js';
import { canonicalModelUrl, modelKeyFromUrl } from './modelIdentity.js';
import { normalizeFavoriteProfiles } from './favoriteProfiles.js';
import { appendRun, readConfig, readDesigns, readRuns, reconcileFavoriteModels, writeConfig } from './storage.js';

const FULL_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const DELTA_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETRY_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const syncs = new Map();
let syncQueue = Promise.resolve();
let fullRefreshPromise = null;
let timer = null;

export function startFavoriteModelIndex() {
  if (timer) clearInterval(timer);
  queueConfiguredFavoriteSyncs().catch((error) => console.error('[favorites]', error.message));
  timer = setInterval(() => {
    queueConfiguredFavoriteSyncs().catch((error) => console.error('[favorites]', error.message));
  }, RETRY_SYNC_INTERVAL_MS);
  timer.unref?.();
}

export function stopFavoriteModelIndex() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function queueFavoriteProfileSync(profile, options = {}) {
  const userId = String(profile?.userId || '');
  if (!userId) return Promise.resolve(null);
  if (syncs.has(userId)) return syncs.get(userId);

  const run = syncQueue
    .catch(() => {})
    .then(() => syncFavoriteProfile(profile, options));
  const promise = run
    .catch(async (error) => {
      await updateProfileSyncState(userId, { indexStatus: 'error', indexedAt: new Date().toISOString() });
      console.error(`[favorites] ${profile.name || userId}: ${error.message}`);
      try {
        await appendFavoriteSyncError(profile, error, options.source || 'schedule');
      } catch (logError) {
        console.error(`[favorites] No se pudo registrar el error de ${profile.name || userId}: ${logError.message}`);
      }
      return { ok: false, error: error.message };
    })
    .finally(() => syncs.delete(userId));
  syncQueue = promise.then(() => undefined, () => undefined);
  syncs.set(userId, promise);
  return promise;
}

export function favoriteProfilesRefreshRunning() {
  return Boolean(fullRefreshPromise);
}

export function queueFavoriteProfilesFullRefresh(profiles = [], options = {}) {
  if (fullRefreshPromise) return fullRefreshPromise;

  fullRefreshPromise = (async () => {
    const results = [];
    for (const profile of profiles) {
      let result = await queueFavoriteProfileSync(profile, { full: true, source: options.source || 'manual' });
      if (result?.ok && result.full !== true) {
        result = await queueFavoriteProfileSync(profile, { full: true, source: options.source || 'manual' });
      }
      results.push({ userId: profile.userId, ok: result?.ok === true });
    }
    return results;
  })().finally(() => {
    fullRefreshPromise = null;
  });

  return fullRefreshPromise;
}

export async function queueConfiguredFavoriteSyncs() {
  const config = await readConfig();
  const designs = await readDesigns();
  let statsChanged = false;
  for (const profile of config.crealityFavorites) {
    const indexedModels = designs.filter((design) =>
      String(design.favoriteProfileId || '') === String(profile.userId || '')
        && design.favoriteActive === true);
    const lastModelIndexedAt = latestDiscoveredAt(indexedModels, profile.lastModelIndexedAt);
    if (profile.indexedModelCount !== indexedModels.length) {
      profile.indexedModelCount = indexedModels.length;
      statsChanged = true;
    }
    if (lastModelIndexedAt && profile.lastModelIndexedAt !== lastModelIndexedAt) {
      profile.lastModelIndexedAt = lastModelIndexedAt;
      statsChanged = true;
    }
  }
  if (statsChanged) await writeConfig(config);
  const profiles = normalizeFavoriteProfiles(config.crealityFavorites);
  const now = Date.now();
  for (const profile of profiles) {
    const emptyIndex = profile.indexedModelCount === 0;
    const full = emptyIndex || !profile.fullIndexedAt || now - Date.parse(profile.fullIndexedAt) >= FULL_SYNC_INTERVAL_MS;
    const stale = emptyIndex || !profile.indexedAt || now - Date.parse(profile.indexedAt) >= DELTA_SYNC_INTERVAL_MS;
    if (full || stale) queueFavoriteProfileSync(profile, { full });
  }
}

export async function syncFavoriteProfile(profile, options = {}) {
  const full = options.full === true || !profile.fullIndexedAt;
  await updateProfileSyncState(profile.userId, { indexStatus: 'syncing' });
  const currentDesigns = await readDesigns();
  const knownKeys = new Set(currentDesigns
    .filter((design) => String(design.favoriteProfileId || '') === String(profile.userId || ''))
    .map((design) => design.modelKey || modelKeyFromUrl(design.url))
    .filter(Boolean));

  const scan = await scanFavoriteProfile(profile, { full, knownKeys });
  const models = scan.models;
  if (!models.length) {
    throw new Error('La página del perfil se cargó sin ningún diseño; se reintentará la indexación.');
  }
  const currentConfig = await readConfig();
  if (!normalizeFavoriteProfiles(currentConfig.crealityFavorites).some((item) => item.userId === profile.userId)) {
    return { ok: false, removed: true, models: 0 };
  }

  const reconciledFull = full && scan.complete;
  const reconciliation = await reconcileFavoriteModels(profile, models, { full: reconciledFull });
  const indexedModels = (await readDesigns()).filter((design) =>
    String(design.favoriteProfileId || '') === String(profile.userId || '')
      && design.favoriteActive === true);
  const indexedModelCount = indexedModels.length;
  if (indexedModelCount === 0) {
    const error = new Error('La indexación encontró diseños, pero no pudo guardarlos; se reintentará más tarde.');
    error.technical = {
      scannedModels: models.length,
      reconciledModels: reconciliation.seen,
      createdModels: reconciliation.created,
      updatedModels: reconciliation.updated,
      fullScan: full,
      completeScan: scan.complete
    };
    throw error;
  }
  const lastModelIndexedAt = latestDiscoveredAt(indexedModels, profile.lastModelIndexedAt);
  const timestamp = new Date().toISOString();
  await updateProfileSyncState(profile.userId, {
    indexStatus: 'ready',
    indexedAt: timestamp,
    fullIndexedAt: reconciledFull ? timestamp : profile.fullIndexedAt,
    lastModelIndexedAt,
    indexedModelCount
  });
  return { ok: true, full: reconciledFull, complete: scan.complete, models: reconciliation.seen, ...reconciliation };
}

function latestDiscoveredAt(designs = [], fallback = '') {
  return designs.reduce((latest, design) => {
    const discoveredAt = String(design.discoveredAt || '');
    const latestTime = Date.parse(latest || '') || 0;
    return Date.parse(discoveredAt) > latestTime ? discoveredAt : latest;
  }, fallback || '');
}

export async function scanFavoriteProfile(profile, options = {}) {
  return withIsolatedBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${profile.profileUrl}/model`, { waitUntil: 'domcontentloaded' });
    await page.locator('a[href*="model-detail"]').first().waitFor({ state: 'attached', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const found = new Map();
    let stagnantRounds = 0;
    let knownOnlyRounds = 0;
    let previousCount = 0;
    let complete = !options.full;
    for (let round = 0; round < 120; round += 1) {
      const links = await page.locator('a[href*="model-detail"]').evaluateAll((anchors) => anchors.map((anchor) => ({
        href: anchor.href,
        title: anchor.getAttribute('title') || anchor.querySelector('img')?.getAttribute('alt') || anchor.textContent || ''
      }))).catch(() => []);
      let newUnknown = 0;
      for (const link of links) {
        const url = canonicalModelUrl(link.href);
        const modelKey = modelKeyFromUrl(url);
        if (!url || !modelKey) continue;
        const wasFound = found.has(modelKey);
        if (!wasFound && !options.knownKeys?.has(modelKey)) newUnknown += 1;
        const title = String(link.title || '').replace(/\s+/g, ' ').trim();
        const existing = found.get(modelKey);
        if (!existing || title.length > existing.title.length) found.set(modelKey, { url, modelKey, title });
      }

      stagnantRounds = found.size === previousCount ? stagnantRounds + 1 : 0;
      knownOnlyRounds = newUnknown === 0 ? knownOnlyRounds + 1 : 0;
      previousCount = found.size;
      if (!options.full && knownOnlyRounds >= 3) break;

      const state = await page.evaluate(() => ({
        top: window.scrollY,
        height: Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0),
        viewport: window.innerHeight
      }));
      const atBottom = state.top + state.viewport >= state.height - 10;
      if (options.full && atBottom && stagnantRounds >= 4) {
        complete = true;
        break;
      }
      await page.evaluate(() => window.scrollTo(0, Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0)));
      await page.waitForTimeout(1200);
    }
    return { models: Array.from(found.values()), complete };
  });
}

export function selectFavoriteCandidates(designs = [], field = '', ownUserId = '') {
  const candidates = designs.filter((design) => design?.url
    && design.favoriteActive === true
    && design.favoriteAvailability !== 'unavailable'
    && String(design.ownerUserId || design.favoriteProfileId || '') !== String(ownUserId || '')
    && (!field || design[field] !== true));
  const groups = new Map();
  const profileScores = new Map();
  for (const design of designs) {
    if (design?.favoriteActive !== true) continue;
    const key = String(design.favoriteProfileId || design.ownerUserId || 'unknown');
    const completed = field ? design[field] === true : design.indexedOnly !== true;
    profileScores.set(key, (profileScores.get(key) || 0) + (completed ? 1 : 0));
  }
  for (const design of candidates) {
    const key = String(design.favoriteProfileId || design.ownerUserId || 'unknown');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(design);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => Date.parse(right.discoveredAt || 0) - Date.parse(left.discoveredAt || 0));
  }
  const orderedGroups = [...groups.entries()]
    .sort(([left], [right]) => (profileScores.get(left) || 0) - (profileScores.get(right) || 0) || left.localeCompare(right))
    .map(([, group]) => group);
  const output = [];
  while (orderedGroups.some((group) => group.length)) {
    for (const group of orderedGroups) {
      if (group.length) output.push(group.shift());
    }
  }
  return output;
}

async function updateProfileSyncState(userId, patch) {
  const config = await readConfig();
  const profile = config.crealityFavorites.find((item) => String(item.userId || '') === String(userId || ''));
  if (!profile) return;
  Object.assign(profile, patch);
  await writeConfig(config);
}

async function appendFavoriteSyncError(profile, error, source) {
  const userId = String(profile?.userId || '');
  const message = error?.message || String(error || 'No se pudo indexar el perfil favorito.');
  const code = error?.code || 'FAVORITE_PROFILE_INDEX_FAILED';
  const now = Date.now();
  const duplicate = (await readRuns()).some((run) => {
    const timestamp = Date.parse(run.finishedAt || run.createdAt || '');
    return run.taskId === 'favoriteProfiles'
      && run.status === 'error'
      && String(run.details?.favoriteProfile?.userId || '') === userId
      && run.details?.diagnostics?.some((diagnostic) => diagnostic.code === code && diagnostic.message === message)
      && Number.isFinite(timestamp)
      && now - timestamp < 6 * 60 * 60 * 1000;
  });
  if (duplicate) return;

  const finishedAt = new Date(now).toISOString();
  const diagnostic = {
    code,
    category: 'technical',
    systemic: false,
    message,
    url: profile?.profileUrl || '',
    technical: {
      profileUserId: userId,
      profileName: profile?.name || '',
      errorName: error?.name || 'Error',
      ...(error?.technical && typeof error.technical === 'object' ? error.technical : {})
    }
  };
  await appendRun({
    taskId: 'favoriteProfiles',
    source,
    status: 'error',
    message: `No se pudo actualizar el perfil favorito ${profile?.name || userId}.`,
    startedAt: finishedAt,
    finishedAt,
    screenshots: [],
    details: {
      favoriteProfile: {
        userId,
        name: profile?.name || '',
        url: profile?.profileUrl || ''
      },
      failures: [{
        title: profile?.name || `Perfil ${userId}`,
        url: profile?.profileUrl || '',
        code,
        category: 'technical',
        error: message,
        diagnostic
      }],
      diagnostics: [diagnostic]
    }
  });
}
