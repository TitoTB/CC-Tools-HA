import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import yazl from 'yazl';
import {
  appendDesign,
  cleanupTemporaryDownloads,
  excludeModelCandidate,
  readDesigns,
  readExcludedDesigns,
  scheduleTemporaryCleanup,
  tempDownloadsDir
} from './storage.js';
import { canonicalModelUrl, modelKeyFromUrl, modelSlugFromUrl } from './modelIdentity.js';
import { restartAutomationBrowser, withAutomationBrowser } from './browserManager.js';
import { navigateToCrealityPage } from './crealityNavigation.js';
import {
  captureDiagnosticImage,
  captureDiagnosticScreenshot,
  diagnoseTaskError,
  failureFromDiagnostic,
  generalizedIncident,
  inspectCrealityPage,
  observeCrealityPage,
  normalizeCaughtError,
  saveDiagnosticImage
} from './crealityDiagnostics.js';
import {
  analyzeActionTrace,
  compareIncentiveProgress,
  readIncentiveProgress,
  waitForIncentiveProgress
} from './incentiveTasks.js';
import { isOwnModel, normalizeModelOwnership, readModelOwnership } from './modelOwnership.js';
import { selectFavoriteCandidates } from './favoriteModelIndex.js';

const CATALOG_URL = 'https://www.crealitycloud.com/es/model-category/3d-print-all';
export const CATALOG_CATEGORIES = Object.freeze([
  'Impresoras 3D',
  'Arte y diseño',
  'Juguetes y juegos',
  'Aficiones y bricolaje',
  'Hogar',
  'Moda',
  'Educación',
  'Miniaturas',
  'Medicina y salud'
].map((name) => ({ name })));
const DOWNLOAD_INCENTIVE_TITLE = 'Download Models';
const CATALOG_SORTS = [
  { key: 'latest', label: 'Más reciente', pattern: /^(Más reciente|Newest|Latest)$/i },
  { key: 'trending', label: 'Tendencias', pattern: /^(Tendencias|Trending)$/i }
];

export async function runModelDownloads(taskConfig = {}, options = {}) {
  const dailyLimit = options.test || options.single ? 1 : clamp(Number(taskConfig.dailyLimit), 0, 30, 1);
  const minIntervalMinutes = clamp(Number(taskConfig.minIntervalMinutes), 10, 1440, 10);
  const catalogCategories = normalizeCatalogCategories(taskConfig.catalogCategories);
  const cleanupAfterHours = Math.min(168, Math.max(1, Number(taskConfig.cleanupAfterHours) || 1));

  if (dailyLimit <= 0) {
    return {
      success: true,
      message: 'No hay descargas configuradas para hoy.',
      details: { downloaded: [], failures: [] }
    };
  }

  await cleanupTemporaryDownloads(cleanupAfterHours);
  const batchDir = path.join(tempDownloadsDir(), new Date().toISOString().replace(/[:.]/g, '-'));
  await fs.mkdir(batchDir, { recursive: true });

  const downloaded = [];
  const failures = [];
  const screenshots = [];

  try {
    return await withAutomationBrowser({ acceptDownloads: true, downloadsPath: batchDir }, async (context) => {
      let page = context.pages()[0] || await context.newPage();
      let observer = observeCrealityPage(page, 'modelDownloads');
      try {
        const [previousDesigns, excludedDesigns] = await Promise.all([
          readDesigns(),
          readExcludedDesigns()
        ]);
        const downloadedDesigns = previousDesigns.filter((design) => design.indexedOnly !== true);
        const seenModels = buildSeenModels([...downloadedDesigns, ...excludedDesigns]);
        const candidateSeenModels = cloneSeenModels(seenModels);
        const candidates = selectPriorityDownloadCandidates(
          previousDesigns,
          taskConfig.prioritizeFavorites,
          options.ownUserId
        );
        const candidateTarget = Math.max(dailyLimit * 8, 40);
        for (const candidate of candidates) {
          rememberSeenModel(candidateSeenModels, candidate);
        }

        const incentiveBefore = await readIncentiveProgress(page, observer, DOWNLOAD_INCENTIVE_TITLE, {
          timezone: taskConfig.timezone,
          requireTaskList: true
        });
        if (!incentiveBefore.found) {
          throw taskError(
            'INCENTIVE_TASK_NOT_FOUND',
            'reward',
            incentiveTaskNotFoundMessage(DOWNLOAD_INCENTIVE_TITLE, incentiveBefore.availableTasks),
            false
          );
        }
        if (incentiveBefore.completed) {
          return {
            success: true,
            skipped: true,
            message: 'La recompensa diaria de descargas ya estaba completada.',
            details: {
              downloaded: [],
              failures: [],
              skipped: true,
              reason: `${DOWNLOAD_INCENTIVE_TITLE} ya estaba en ${incentiveBefore.done}/${incentiveBefore.valid}.`,
              rewardVerification: {
                status: 'already_completed',
                before: incentiveBefore,
                after: incentiveBefore
              }
            },
            screenshots
          };
        }

        let candidateIndex = 0;
        let randomCandidatesLoaded = false;
        let silentlySkipped = 0;
        let catalogStats = [];
        while (downloaded.length < dailyLimit) {
          if (candidateIndex >= candidates.length) {
            if (randomCandidatesLoaded) break;
            const catalogResult = await collectCandidateModels(
              page,
              candidateSeenModels,
              candidateTarget,
              observer,
              catalogCategories
            );
            candidates.push(...catalogResult.candidates);
            catalogStats = catalogResult.stats;
            randomCandidatesLoaded = true;
            if (candidateIndex >= candidates.length) break;
          }

          const candidate = candidates[candidateIndex];
          candidateIndex += 1;
          if (downloaded.length >= dailyLimit) break;

          if (downloaded.length > 0) {
            await page.waitForTimeout(minIntervalMinutes * 60 * 1000);
          }

          try {
            await observer.snapshot();
            const result = await downloadModel(page, candidate, batchDir, observer, options.ownUserId);
            if (result.verificationPage && result.verificationPage !== page) {
              observer.stop();
              page = result.verificationPage;
              observer = observeCrealityPage(page, 'modelDownloads');
            }
            ({ page, observer } = await ensureAutomationPage(page, observer, batchDir));
            if (result.skipped) {
              const excluded = await excludeModelCandidate({
                ...candidate,
                title: result.title || candidate.title,
                url: result.url || candidate.url,
                author: result.author || '',
                authorUrl: result.authorUrl || '',
                category: result.category || '',
                ownerUserId: result.ownerUserId || '',
                isOwnModel: false,
                ownerUserId: result.ownerUserId || '',
                isOwnModel: result.isOwnModel === true
              }, result.skipReason || 'not_downloadable');
              rememberSeenModel(seenModels, excluded.record);
              silentlySkipped += 1;
              continue;
            }
            const network = analyzeActionTrace(result.actionTrace, 'download_model', result.pageDiagnostic);
            const incentiveAfter = network.systemic
              ? { found: false, title: DOWNLOAD_INCENTIVE_TITLE, checkedAt: new Date().toISOString() }
              : await waitForIncentiveProgress(
                page,
                observer,
                DOWNLOAD_INCENTIVE_TITLE,
                incentiveBefore,
                undefined,
                { timezone: taskConfig.timezone }
              );
            const rewardVerification = compareIncentiveProgress(incentiveBefore, incentiveAfter);
            rewardVerification.responses = result.actionTrace.responses;
            rewardVerification.failedRequests = result.actionTrace.failedRequests;
            rewardVerification.network = network;
            rewardVerification.actionEvidence = result.actionEvidence;
            const identity = modelIdentity(result.url);
            if (hasSeenModel(seenModels, identity)) continue;
            if (rewardVerification.status !== 'credited') {
              const { record } = await appendDesign({
                title: result.title,
                url: result.url,
                author: result.author || '',
                authorUrl: result.authorUrl || '',
                category: result.category || '',
                fileName: result.fileName || '',
                fileSize: result.fileSize || 0,
                source: candidate.source || 'random',
                downloadMethod: result.downloadMethod || '',
                downloadVerified: true,
                rewardStatus: rewardVerification.status,
                rewardVerification
              });
              rememberSeenModel(seenModels, record);

              const diagnostic = downloadRewardDiagnostic(rewardVerification, candidate);
              failures.push(failureFromDiagnostic(diagnostic, {
                title: result.title || candidate.title || 'Diseño desconocido',
                url: result.url || candidate.url
              }));
              const screenshot = await captureDiagnosticScreenshot(
                page,
                'model-downloads-reward',
                rewardVerification.status
              );
              screenshots.push(...await saveActionImages(result.diagnosticImages, 'modelDownloads'));
              if (screenshot) screenshots.push(screenshot);

              return {
                success: false,
                message: `Descarga no acreditada. ${downloadRewardMessage(rewardVerification)}`,
                details: {
                  downloaded: [],
                  attemptedDownloads: [{ ...record, rewardVerification }],
                  failures,
                  diagnostics: [diagnostic],
                  rewardVerification,
                  incident: diagnostic
                },
                screenshots
              };
            }

            const { record, created } = await appendDesign({
              title: result.title,
              url: result.url,
              author: result.author || '',
              authorUrl: result.authorUrl || '',
              category: result.category || '',
              ownerUserId: result.ownerUserId || '',
              isOwnModel: false,
              fileName: result.fileName || '',
              fileSize: result.fileSize || 0,
              source: candidate.source || 'random',
              downloadMethod: result.downloadMethod || '',
              downloadVerified: true,
              rewardStatus: 'credited',
              rewardVerification
            });

            rememberSeenModel(seenModels, record);
            if (!created) continue;
            downloaded.push(record);
          } catch (error) {
            error = normalizeCaughtError(error, {
              code: 'EMPTY_DOWNLOAD_ERROR',
              category: 'download',
              message: 'La descarga terminó sin devolver información sobre el error.',
              phase: `descarga del modelo ${candidate.url || 'desconocido'}`
            });
            if (error.verificationPage && error.verificationPage !== page) {
              observer.stop();
              page = error.verificationPage;
              observer = observeCrealityPage(page, 'modelDownloads');
            }
            if (page.isClosed()) {
              ({ page, observer } = await ensureAutomationPage(page, observer, batchDir));
            }
            let diagnostic = await diagnoseTaskError(error, page, observer, {
              code: error.code || 'MODEL_DOWNLOAD_FAILED',
              category: error.category || 'download',
              systemic: Boolean(error.systemic),
              message: error.userMessage || error.message,
              url: candidate.url
            });
            if (['MODEL_REVIEW_FAILED', 'MODEL_NOT_FOUND'].includes(diagnostic.code)) {
              const excluded = await excludeModelCandidate(
                candidate,
                diagnostic.code === 'MODEL_NOT_FOUND' ? 'model_not_found' : 'model_review_failed'
              );
              rememberSeenModel(seenModels, excluded.record);
              silentlySkipped += 1;
              continue;
            }
            if (error.actionTrace) {
              const network = analyzeActionTrace(error.actionTrace, 'download_model', error.actionPageDiagnostic || null);
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
              screenshots.push(...await saveActionImages(error.actionImages, 'modelDownloads'));
            }
            failures.push({
              ...failureFromDiagnostic(diagnostic, {
                title: candidate.title || 'Diseño desconocido',
                url: candidate.url
              }),
              source: candidate.source || 'catalog'
            });

            const incident = generalizedIncident(failures);
            if (incident) {
              const screenshot = await captureDiagnosticScreenshot(page, 'model-downloads', incident.code);
              if (screenshot) screenshots.push(screenshot);
              break;
            }
          }
        }

        const relevantFailures = downloaded.length >= dailyLimit ? [] : failures;
        if (!downloaded.length && !relevantFailures.length && silentlySkipped > 0) {
          return {
            success: true,
            skipped: true,
            message: 'No se encontraron modelos gratuitos descargables en esta ejecución.',
            details: {
              downloaded: [],
              failures: [],
              skipped: true,
              silentlySkipped
            },
            screenshots
          };
        }
        if (!downloaded.length && !relevantFailures.length) {
          const diagnostic = {
            code: 'NO_NEW_MODELS',
            category: 'catalog',
            systemic: false,
            message: 'No se encontraron diseños nuevos para descargar.',
            detectedAt: new Date().toISOString(),
            url: CATALOG_URL,
            technical: formatCatalogStats(catalogStats),
            catalogStats
          };
          relevantFailures.push(failureFromDiagnostic(diagnostic, {
            title: 'Catálogo de modelos',
            url: CATALOG_URL
          }));
          const screenshot = await captureDiagnosticScreenshot(page, 'model-catalog', 'no-new-models');
          if (screenshot) screenshots.push(screenshot);
        }
        const incident = generalizedIncident(relevantFailures);
        return {
          success: downloaded.length >= dailyLimit && relevantFailures.length === 0,
          message: buildMessage(downloaded, relevantFailures, dailyLimit),
          details: {
            downloaded,
            failures: relevantFailures,
            diagnostics: relevantFailures.map((failure) => failure.diagnostic).filter(Boolean),
            incident
          },
          screenshots
        };
      } finally {
        observer.stop();
      }
    });
  } finally {
    scheduleTemporaryCleanup(batchDir, cleanupAfterHours * 60 * 60 * 1000);
  }
}

async function collectCandidateModels(page, seenModels, desiredCount, observer, categoryNames = []) {
  const selectedCategories = normalizeCatalogCategories(categoryNames);
  const sources = selectedCategories.length ? selectedCategories : [''];
  const found = new Map();
  const localSeen = cloneSeenModels(seenModels);
  const stats = [];

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const categoryName = sources[sourceIndex];
    await openCatalogCategory(page, observer, categoryName);
    const sourceTarget = Math.ceil(desiredCount * (sourceIndex + 1) / sources.length);

    for (const sort of CATALOG_SORTS) {
      const sortApplied = await selectCatalogSort(page, sort.pattern);
      await page.locator('a[href*="model-detail"]').first()
        .waitFor({ state: 'attached', timeout: 10000 })
        .catch(() => {});

      const strategy = await scanCatalogStrategy(
        page,
        sort,
        sortApplied,
        seenModels,
        localSeen,
        found,
        sourceTarget
      );
      stats.push({ ...strategy, category: categoryName || 'Todas las categorías' });
      if (found.size >= sourceTarget) break;
    }
  }

  return { candidates: shuffle(Array.from(found.values())), stats };
}

async function openCatalogCategory(page, observer, categoryName = '') {
  await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const diagnostic = await inspectCrealityPage(page, observer, { requireBody: true });
  if (diagnostic) {
    const screenshot = await captureDiagnosticScreenshot(page, 'model-catalog', diagnostic.code);
    throw diagnosticError(diagnostic, screenshot);
  }
  if (!categoryName) return;

  const matches = page.getByText(categoryName, { exact: true });
  let selected = false;
  for (let index = 0; index < await matches.count(); index += 1) {
    const category = matches.nth(index);
    if (!(await category.isVisible().catch(() => false))) continue;
    selected = await category.click({ timeout: 8000 }).then(() => true).catch(() => false);
    if (selected) break;
  }
  if (!selected) {
    throw taskError(
      'CATALOG_CATEGORY_NOT_FOUND',
      'catalog',
      `No se pudo abrir la categoría "${categoryName}" del catálogo.`,
      false
    );
  }
  await page.waitForTimeout(2500);
}

export async function collectCatalogCandidates(page, knownDesigns = [], desiredCount = 20, observer, categoryNames = []) {
  const seenModels = buildSeenModels(knownDesigns);
  const result = await collectCandidateModels(page, seenModels, desiredCount, observer, categoryNames);
  return result.candidates;
}

async function selectCatalogSort(page, pattern) {
  const control = page.locator('span.hand, [role="tab"], button, [class*="sort"]').filter({ hasText: pattern }).first();
  if (!(await control.isVisible().catch(() => false))) return false;
  const clicked = await control.click({ timeout: 8000 }).then(() => true).catch(() => false);
  if (!clicked) return false;
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  return true;
}

async function scanCatalogStrategy(page, sort, sortApplied, seenModels, localSeen, found, desiredCount) {
  const pageIdentities = new Set();
  const knownIdentities = new Set();
  const startFound = found.size;
  let rawLinks = 0;
  let scrollRounds = 0;
  let stagnantRounds = 0;
  let previousUnique = 0;

  for (let attempt = 0; attempt < 20 && found.size < desiredCount && stagnantRounds < 5; attempt += 1) {
    const links = await page.locator('a[href*="model-detail"]').evaluateAll((anchors) => anchors.map((anchor) => ({
      href: anchor.href,
      text: anchor.textContent || anchor.getAttribute('title') || ''
    }))).catch(() => []);
    rawLinks = Math.max(rawLinks, links.length);

    for (const link of links) {
      const identity = modelIdentity(link.href);
      const foundKey = identity.modelKey || identity.url;
      if (!identity.url || !foundKey) continue;
      pageIdentities.add(foundKey);
      if (hasSeenModel(seenModels, identity)) knownIdentities.add(foundKey);
      if (hasSeenModel(localSeen, identity) || found.has(foundKey)) continue;
      found.set(foundKey, {
        ...identity,
        title: normalize(link.text)
      });
      rememberSeenModel(localSeen, identity);
    }

    stagnantRounds = pageIdentities.size > previousUnique ? 0 : stagnantRounds + 1;
    previousUnique = pageIdentities.size;
    if (found.size >= desiredCount) break;

    await page.mouse.wheel(0, 2400).catch(() => {});
    await page.waitForTimeout(1400);
    scrollRounds += 1;
  }

  return {
    sort: sort.key,
    label: sort.label,
    sortApplied,
    rawLinks,
    uniqueLinks: pageIdentities.size,
    knownLinks: knownIdentities.size,
    newCandidates: found.size - startFound,
    scrollRounds,
    stagnantRounds
  };
}

export function formatCatalogStats(stats = []) {
  if (!stats.length) return 'El catálogo no devolvió estadísticas de exploración.';
  return stats.map((entry) => [
    `Categoría: ${entry.category || 'Todas las categorías'}`,
    `Ordenación: ${entry.label || entry.sort || 'desconocida'}`,
    `Selector aplicado: ${entry.sortApplied ? 'sí' : 'no'}`,
    `Enlaces visibles: ${Number(entry.rawLinks) || 0}`,
    `Modelos únicos: ${Number(entry.uniqueLinks) || 0}`,
    `Ya conocidos o excluidos: ${Number(entry.knownLinks) || 0}`,
    `Candidatos nuevos: ${Number(entry.newCandidates) || 0}`,
    `Rondas de scroll: ${Number(entry.scrollRounds) || 0}`,
    `Rondas sin crecimiento: ${Number(entry.stagnantRounds) || 0}`
  ].join('\n')).join('\n\n');
}

export function normalizeCatalogCategories(values = []) {
  const allowed = new Set(CATALOG_CATEGORIES.map((category) => category.name));
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter((value) => allowed.has(value))));
}

export function selectPriorityDownloadCandidates(designs = [], prioritizeFavorites = true, ownUserId = '') {
  if (prioritizeFavorites === false) return [];
  return selectFavoriteCandidates(designs, '', ownUserId)
    .filter((design) => design.indexedOnly === true)
    .map((design) => ({ ...design, source: 'favorite' }));
}

async function downloadModel(page, candidate, batchDir, observer, ownUserId = '') {
  await navigateToCrealityPage(page, candidate.url);
  await page.waitForTimeout(3500);

  const diagnostic = await inspectCrealityPage(page, observer, { requireBody: true });
  if (diagnostic) throw diagnosticError(diagnostic);

  const title = await getModelTitle(page, candidate);
  const author = await readModelOwnership(page);
  const category = await readModelCategory(page);
  const metadata = { ...author, category };
  if (isOwnModel(author, ownUserId)) {
    return {
      skipped: true,
      skipReason: 'own_model',
      title,
      ...metadata,
      isOwnModel: true,
      url: canonicalModelUrl(page.url()) || candidate.url
    };
  }
  if (await isCommercialModel(page)) {
    return {
      skipped: true,
      skipReason: 'commercial_model',
      title,
      ...metadata,
      url: canonicalModelUrl(page.url()) || candidate.url
    };
  }
  const filesButton = page.locator('button, [role="button"], a, .el-button, [class*="btn"], [class*="button"]').filter({
    hasText: /Ver archivos STL\/CAD|STL\/CAD|View files|View STL|Files/i
  }).first();

  if (!(await filesButton.isVisible().catch(() => false))) {
    return downloadDirectModel(page, candidate, batchDir, title, observer, metadata);
  }

  await filesButton.scrollIntoViewIfNeeded().catch(() => {});
  await filesButton.click({ timeout: 8000 });
  await page.waitForTimeout(1800);

  const downloadButton = page.locator('button, [role="button"], a, .el-button, [class*="btn"], [class*="button"]').filter({
    hasText: /Descargar todo|Download all|Download/i
  }).first();

  if (!(await downloadButton.isVisible().catch(() => false))) {
    return downloadDirectModel(page, candidate, batchDir, title, observer, metadata);
  }

  return saveDownload(page, candidate, batchDir, title, downloadButton, {
    observer,
    author: metadata,
    downloadDescriptorUrl: /\/api\/cxy\/v3\/model\/memberDownload(?:\?|$)/i
  });
}

export function normalizeModelAuthor(name, href, baseUrl = 'https://www.crealitycloud.com/') {
  const { author, authorUrl } = normalizeModelOwnership(name, href, baseUrl);
  return { author, authorUrl };
}

export async function readModelCategory(page) {
  const links = await page.locator('a[href*="/model-category/"]').evaluateAll((anchors) => anchors.map((anchor) => ({
    href: anchor.href,
    text: anchor.textContent || ''
  }))).catch(() => []);
  const title = await page.title().catch(() => '');
  return selectModelCategory(links, title);
}

export function selectModelCategory(links = [], pageTitle = '') {
  const names = Array.from(new Set((Array.isArray(links) ? links : [])
    .filter((link) => /\/model-category\//i.test(String(link?.href || '')))
    .filter((link) => !/\/model-category\/3d-print-all(?:[/?#]|$)/i.test(String(link?.href || '')))
    .map((link) => normalize(link?.text))
    .filter(Boolean)));
  const mainCategories = new Set(CATALOG_CATEGORIES.map((category) => category.name));
  return names.find((name) => mainCategories.has(name))
    || names.at(-1)
    || selectModelCategoryFromTitle(pageTitle);
}

export function selectModelCategoryFromTitle(pageTitle = '') {
  const parts = String(pageTitle || '')
    .split('|')
    .map((part) => normalize(part))
    .filter(Boolean);
  if (parts.length < 3 || !/Creality Cloud/i.test(parts.at(-1))) return '';
  return parts.at(-2) || '';
}

async function isCommercialModel(page) {
  const bodyText = await page.locator('body').innerText({ timeout: 2500 }).catch(() => '');
  if (hasCommercialModelLabel(bodyText)) return true;

  const actionAreas = page.locator([
    '.action-btn-box',
    '.all-operate-btn',
    '[class*="action-btn-box"]',
    '.pay-model-buy',
    '.model-price-box-info'
  ].join(', '));
  const count = await actionAreas.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const area = actionAreas.nth(index);
    const text = await area.innerText({ timeout: 1000 }).catch(() => '');
    if (hasPaidPrimaryActionText(text)) return true;

    const markup = await area.evaluate((element) => [
      element.className,
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      ...Array.from(element.querySelectorAll('*')).flatMap((child) => [
        child.className,
        child.getAttribute('aria-label'),
        child.getAttribute('title'),
        child.getAttribute('alt')
      ])
    ].filter(Boolean).join(' ')).catch(() => '');
    if (hasPaidActionMarkup(markup, text)) return true;
  }

  return false;
}

export function hasCommercialModelLabel(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => normalize(line))
    .some((line) => /^(modelo comercial|commercial model|modelo de pago|paid model|modelo premium|premium model)$/i.test(line));
}

export function hasPaidPrimaryActionText(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => normalize(line))
    .some((line) => (
      /^(comprar|buy|purchase)(?:\s+(?:modelo|model|ahora|now))?(?:\s+(?:por|for))?(?:\s+\d[\d.,]*)?(?:\s*(?:puntos?|points?|cr[eé]ditos?|credits?))?$/i.test(line)
      || /^\d[\d.,]*\s*(?:puntos?|points?|cr[eé]ditos?|credits?)$/i.test(line)
    ));
}

export function hasPaidActionMarkup(markup, text = '') {
  const normalizedMarkup = normalize(markup);
  if (!/(?:^|[\s_-])(coin|coins|credit|credits|point|points|price|purchase|paid)(?:$|[\s_-])/i.test(normalizedMarkup)) {
    return false;
  }

  const normalizedText = normalize(text);
  return hasPaidPrimaryActionText(normalizedText)
    || /(?:^|\s)\d[\d.,]*(?:\s|$)/.test(normalizedText)
    || /comprar|buy|purchase|puntos?|points?|cr[eé]ditos?|credits?/i.test(normalizedText);
}

async function downloadDirectModel(page, candidate, batchDir, title, observer, author) {
  const directButton = page.locator('.operate-box').filter({
    hasText: /Descargar\s*3MF|Download\s*3MF/i
  }).first();

  if (!(await directButton.isVisible().catch(() => false))) {
    throw taskError(
      'MODEL_CONTROLS_NOT_FOUND',
      'page',
      'No se encontró el botón de archivos STL/CAD ni la descarga directa 3MF.'
    );
  }

  return saveDownload(page, candidate, batchDir, title, directButton, {
    observer,
    author,
    method: '3mf-direct',
    downloadDescriptorUrl: /\/api\/cxy\/v3\/model\/3mfDownload(?:\?|$)/i,
    confirmationUrl: /\/api\/cxy\/v3\/model\/3mfDownloadSuccess(?:\?|$)/i,
    confirmationTimeoutMs: 25000
  });
}

async function saveDownload(page, candidate, batchDir, title, button, options = {}) {
  await button.scrollIntoViewIfNeeded().catch(() => {});
  const modelUrl = canonicalModelUrl(page.url()) || canonicalModelUrl(candidate.url) || candidate.url;
  const before = await inspectControlState(button);
  const beforeImage = await captureDiagnosticImage(page);
  const actionMark = options.observer.mark();
  const confirmation = options.confirmationUrl
    ? observeRequestOutcome(page, options.confirmationUrl)
    : null;
  const downloadDescriptor = options.downloadDescriptorUrl
    ? observeDownloadDescriptor(page, options.downloadDescriptorUrl)
    : null;
  let savedFile = null;
  let confirmationOutcome = null;
  let descriptorOutcome = null;
  let verificationPage = null;
  let keepAlivePage = null;
  let keepAliveHandedOff = false;
  try {
    keepAlivePage = await page.context().newPage();
    if (downloadDescriptor) {
      const browserDownload = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
      await humanClick(page, button);
      descriptorOutcome = await downloadDescriptor.wait(10000);
      const download = await browserDownload;
      if (download) {
        savedFile = await persistBrowserDownload(download, batchDir, title).catch(() => null);
      }
      if (!savedFile && descriptorOutcome?.downloadUrls?.length) {
        savedFile = await persistSignedDownloads(descriptorOutcome.downloadUrls, batchDir, title);
      }
      if (!savedFile && descriptorOutcome?.downloadUrl) {
        savedFile = await persistSignedDownload(descriptorOutcome.downloadUrl, batchDir, title);
      }
      if (!savedFile) {
        throw taskError(
          'DOWNLOAD_CAPTURE_FAILED',
          'download',
          'Creality Cloud inició la descarga, pero CC Tools no pudo guardar el archivo temporal.'
        );
      }
    } else {
      const download = await Promise.all([
        page.waitForEvent('download', { timeout: 45000 }),
        humanClick(page, button)
      ]).then(([downloadEvent]) => downloadEvent);
      savedFile = await persistBrowserDownload(download, batchDir, title);
    }

    confirmationOutcome = confirmation
      ? await confirmation.wait(options.confirmationTimeoutMs || 25000)
      : null;
    if (!confirmation) {
      await waitForRegistration(page, options.registrationWaitMs || 5000);
    } else {
      // Keep the model page alive briefly so the site's post-download callback can settle.
      await delay(1200);
    }
    const actionTrace = await options.observer.captureSince(actionMark);
    const after = await inspectControlState(button);
    const afterImage = await captureDiagnosticImage(page);
    const pageDiagnostic = page.isClosed()
      ? null
      : await inspectCrealityPage(page, options.observer, {
        requireBody: !downloadDescriptor
      });
    verificationPage = page.isClosed() ? keepAlivePage : page;
    if (verificationPage === keepAlivePage) keepAliveHandedOff = true;

    return {
      title,
      ...(options.author || {}),
      url: modelUrl,
      fileName: savedFile.name,
      fileSize: savedFile.size,
      downloadMethod: options.method || 'files-popup',
      actionTrace,
      pageDiagnostic,
      verificationPage,
      actionEvidence: {
        before,
        after,
        file: savedFile,
        confirmation: confirmationOutcome,
        descriptor: descriptorOutcome ? { status: descriptorOutcome.status } : null
      },
      diagnosticImages: [{ image: beforeImage, code: 'before-action' }, { image: afterImage, code: 'after-action' }]
    };
  } catch (error) {
    error = normalizeCaughtError(error, {
      code: 'EMPTY_DOWNLOAD_ACTION_ERROR',
      category: 'download',
      message: 'La acción de descarga terminó sin devolver información sobre el error.',
      phase: 'acción de descarga del modelo'
    });
    const actionTrace = await options.observer.captureSince(actionMark);
    const after = await inspectControlState(button);
    const image = await captureDiagnosticImage(page);
    error.actionTrace = actionTrace;
    error.actionEvidence = {
      before,
      after,
      file: savedFile,
      confirmation: confirmationOutcome,
      descriptor: descriptorOutcome ? { status: descriptorOutcome.status } : null
    };
    error.actionPageDiagnostic = await inspectCrealityPage(page, options.observer, {
      requireBody: !downloadDescriptor
    });
    error.actionImages = [
      { image: beforeImage, code: 'before-action' },
      { image, code: 'action-error' }
    ];
    if (page.isClosed() && keepAlivePage && !keepAlivePage.isClosed()) {
      error.verificationPage = keepAlivePage;
      keepAliveHandedOff = true;
    }
    throw error;
  } finally {
    confirmation?.dispose();
    downloadDescriptor?.dispose();
    if (keepAlivePage && !keepAliveHandedOff) {
      await keepAlivePage.close().catch(() => {});
    }
  }
}

async function persistBrowserDownload(download, batchDir, title) {
  const suggestedName = sanitizeFilename(download.suggestedFilename() || `${slugify(title)}.zip`);
  const filePath = path.join(batchDir, suggestedName);
  await download.saveAs(filePath);
  const downloadFailure = await download.failure();
  if (downloadFailure) {
    throw taskError('DOWNLOAD_FAILED', 'download', `El navegador indicó que la descarga falló: ${downloadFailure}`);
  }
  return verifiedFile(filePath, suggestedName);
}

export async function persistSignedDownload(downloadUrl, batchDir, title, preferredName = '') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let response;
  try {
    response = await fetch(downloadUrl, {
      redirect: 'follow',
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    const message = error?.name === 'AbortError'
      ? 'La descarga firmada superó el tiempo máximo de 45 segundos.'
      : `No se pudo recuperar el archivo firmado: ${error?.message || String(error)}`;
    throw taskError('SIGNED_DOWNLOAD_FAILED', 'download', message);
  }

  if (!response.ok) {
    clearTimeout(timeout);
    throw taskError(
      'SIGNED_DOWNLOAD_FAILED',
      'download',
      `El almacenamiento de Creality Cloud respondió con HTTP ${response.status}.`
    );
  }

  const suggestedName = sanitizeFilename(
    preferredName || filenameFromDisposition(response.headers.get('content-disposition')) || `${slugify(title)}.3mf`
  );
  const filePath = path.join(batchDir, suggestedName);
  if (!response.body) {
    clearTimeout(timeout);
    throw taskError('EMPTY_DOWNLOAD', 'download', 'El almacenamiento no devolvió el contenido del archivo.');
  }
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'La descarga firmada superó el tiempo máximo de 45 segundos.'
      : `No se pudo guardar el archivo firmado: ${error?.message || String(error)}`;
    throw taskError('SIGNED_DOWNLOAD_FAILED', 'download', message);
  } finally {
    clearTimeout(timeout);
  }
  return verifiedFile(filePath, suggestedName);
}

export async function persistSignedDownloads(downloads, batchDir, title) {
  const entries = Array.isArray(downloads)
    ? downloads.filter((entry) => entry?.url)
    : [];
  if (!entries.length) {
    throw taskError('SIGNED_DOWNLOAD_FAILED', 'download', 'Creality Cloud no devolvió archivos firmados para guardar.');
  }

  const partsDir = await fs.mkdtemp(path.join(batchDir, '.parts-'));
  const zipName = sanitizeFilename(`${slugify(title) || 'modelo'}.zip`);
  const zipPath = path.join(batchDir, zipName);
  const usedNames = new Set();
  try {
    const files = [];
    for (const [index, entry] of entries.entries()) {
      const fallbackName = `parte-${index + 1}${extensionFromUrl(entry.url) || '.stl'}`;
      const requestedName = ensureFileExtension(entry.fileName || fallbackName, entry.url);
      const targetName = uniqueFilename(sanitizeFilename(requestedName), usedNames);
      const saved = await persistSignedDownload(entry.url, partsDir, requestedName, targetName);
      const savedPath = path.join(partsDir, saved.name);
      files.push({ path: savedPath, name: targetName });
    }
    await createZipArchive(files, zipPath);
    return verifiedFile(zipPath, zipName);
  } finally {
    await fs.rm(partsDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function createZipArchive(files, zipPath) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new yazl.ZipFile();
    output.on('close', resolve);
    output.on('error', reject);
    archive.outputStream.on('error', reject);
    archive.outputStream.pipe(output);
    for (const file of files) archive.addFile(file.path, file.name, { compress: true });
    archive.end();
  });
}

function ensureFileExtension(fileName, downloadUrl) {
  const cleanName = String(fileName || '').trim();
  if (path.extname(cleanName)) return cleanName;
  return `${cleanName || 'archivo'}${extensionFromUrl(downloadUrl) || '.stl'}`;
}

function extensionFromUrl(value) {
  try {
    return path.extname(decodeURIComponent(new URL(value).pathname));
  } catch {
    return '';
  }
}

function uniqueFilename(preferred, usedNames) {
  const baseName = sanitizeFilename(preferred || 'archivo.stl');
  let candidate = baseName;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const extension = path.extname(baseName);
    const stem = path.basename(baseName, extension);
    candidate = `${stem}-${suffix}${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

async function verifiedFile(filePath, name) {
  const stat = await fs.stat(filePath).catch(() => ({ size: 0 }));
  if (!stat.size) {
    throw taskError('EMPTY_DOWNLOAD', 'download', 'El archivo descargado está vacío o no pudo guardarse.');
  }
  return { name, size: stat.size };
}

function filenameFromDisposition(value) {
  const raw = String(value || '');
  const match = raw.match(/filename\*=(?:UTF-8'')?([^;]+)/i) || raw.match(/filename="?([^";]+)"?/i);
  if (!match) return '';
  const encoded = match[1].trim().replace(/^"|"$/g, '');
  try {
    return decodeURIComponent(encoded.replace(/\+/g, ' '));
  } catch {
    return encoded;
  }
}

function observeDownloadDescriptor(page, urlPattern) {
  let outcome = null;
  let resolveOutcome;
  const outcomePromise = new Promise((resolve) => {
    resolveOutcome = resolve;
  });
  const settle = (value) => {
    if (outcome) return;
    outcome = value;
    resolveOutcome(value);
  };
  const matches = (request) => request.method() === 'POST' && urlPattern.test(request.url());
  const onResponse = async (response) => {
    if (!matches(response.request())) return;
    const body = await response.json().catch(() => null);
    settle({
      status: response.ok() ? 'response' : 'rejected',
      httpStatus: response.status(),
      downloadUrl: body?.result?.downloadUrl || '',
      downloadUrls: Array.isArray(body?.result?.downloadUrls)
        ? body.result.downloadUrls.map((entry) => ({
          fileName: entry?.fileName || '',
          url: entry?.url || ''
        })).filter((entry) => entry.url)
        : [],
      observedAt: new Date().toISOString()
    });
  };
  const onRequestFailed = (request) => {
    if (!matches(request)) return;
    settle({
      status: 'failed',
      error: request.failure()?.errorText || 'REQUEST_FAILED',
      downloadUrl: '',
      observedAt: new Date().toISOString()
    });
  };

  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  return {
    async wait(timeoutMs) {
      if (outcome) return outcome;
      return Promise.race([
        outcomePromise,
        delay(timeoutMs).then(() => ({
          status: 'not_observed',
          downloadUrl: '',
          downloadUrls: [],
          timeoutMs,
          observedAt: new Date().toISOString()
        }))
      ]);
    },
    dispose() {
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    }
  };
}

function observeRequestOutcome(page, urlPattern) {
  let outcome = null;
  let resolveOutcome;
  const outcomePromise = new Promise((resolve) => {
    resolveOutcome = resolve;
  });

  const matches = (request) => request.method() === 'POST' && urlPattern.test(request.url());
  const settle = (value) => {
    if (outcome) return;
    outcome = value;
    resolveOutcome(value);
  };
  const onResponse = (response) => {
    const request = response.request();
    if (!matches(request)) return;
    settle({
      status: 'response',
      httpStatus: response.status(),
      url: response.url(),
      observedAt: new Date().toISOString()
    });
  };
  const onRequestFailed = (request) => {
    if (!matches(request)) return;
    settle({
      status: 'failed',
      error: request.failure()?.errorText || 'REQUEST_FAILED',
      url: request.url(),
      observedAt: new Date().toISOString()
    });
  };

  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  return {
    async wait(timeoutMs) {
      if (outcome) return outcome;
      return Promise.race([
        outcomePromise,
        page.waitForTimeout(timeoutMs).then(() => ({
          status: 'not_observed',
          timeoutMs,
          observedAt: new Date().toISOString()
        }))
      ]);
    },
    dispose() {
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    }
  };
}

async function saveActionImages(values = [], taskId) {
  const paths = [];
  for (const value of values) {
    const saved = await saveDiagnosticImage(value?.image, taskId, value?.code || 'action');
    if (saved) paths.push(saved);
  }
  return paths;
}

async function inspectControlState(control) {
  return {
    visible: await control.isVisible().catch(() => false),
    text: normalize(await control.textContent().catch(() => '')),
    className: normalize(await control.getAttribute('class').catch(() => '')),
    ariaPressed: await control.getAttribute('aria-pressed').catch(() => null),
    ariaChecked: await control.getAttribute('aria-checked').catch(() => null),
    title: normalize(await control.getAttribute('title').catch(() => '')),
    html: String(await control.evaluate((node) => node.outerHTML).catch(() => ''))
      .replace(/\sdata-v-[a-z0-9-]+(?:="")?/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1600)
  };
}

async function humanClick(page, locator) {
  try {
    await locator.click({ timeout: 8000 });
    return;
  } catch {}

  const box = await locator.boundingBox().catch(() => null);
  if (box) {
    const x = box.x + box.width * (0.42 + Math.random() * 0.16);
    const y = box.y + box.height * (0.42 + Math.random() * 0.16);
    await page.mouse.move(x, y, { steps: 8 });
    await page.waitForTimeout(150 + Math.floor(Math.random() * 220));
    await page.mouse.down();
    await page.waitForTimeout(80 + Math.floor(Math.random() * 120));
    await page.mouse.up();
    return;
  }

  throw taskError('ACTION_CONTROL_NOT_CLICKABLE', 'page', 'El control de descarga no aceptó un clic normal del navegador.');
}

async function waitForRegistration(page, waitMs) {
  await page.waitForLoadState('networkidle', { timeout: waitMs }).catch(() => {});
  await delay(waitMs);
}

function downloadRewardDiagnostic(verification, candidate) {
  const notCredited = verification.status === 'not_credited';
  const network = verification.network || {};
  const confirmation = verification.actionEvidence?.confirmation || null;
  const confirmationMissing = confirmation?.status === 'not_observed';
  const networkSpecific = !['ACTION_ENDPOINT_ACCEPTED', 'ACTION_ENDPOINT_NOT_OBSERVED'].includes(network.code);
  const code = networkSpecific
    ? network.code
    : confirmationMissing
      ? 'DOWNLOAD_CONFIRMATION_NOT_OBSERVED'
    : network.code === 'ACTION_ENDPOINT_NOT_OBSERVED'
      ? 'ACTION_ENDPOINT_NOT_OBSERVED'
      : notCredited ? 'ACTION_CONFIRMED_REWARD_NOT_CREDITED' : 'REWARD_VERIFICATION_FAILED';
  return {
    code,
    category: 'reward',
    systemic: Boolean(network.systemic),
    message: networkSpecific
      ? network.message
      : confirmationMissing
        ? 'Creality Cloud entregó el archivo, pero no emitió la confirmación final 3mfDownloadSuccess.'
      : network.code === 'ACTION_ENDPOINT_NOT_OBSERVED'
        ? `${network.message} Download Models no aumentó.`
        : notCredited
          ? 'El endpoint aceptó la descarga, pero Creality Cloud no incrementó Download Models.'
          : 'El archivo se descargó, pero no se pudo verificar la tarea Download Models.',
    detectedAt: new Date().toISOString(),
    url: candidate.url,
    before: verification.before,
    after: verification.after,
    responses: verification.responses || [],
    network,
    retryAfter: network.retryAfter || '',
    actionEvidence: verification.actionEvidence || null,
    failedRequests: verification.failedRequests || []
  };
}

function downloadRewardMessage(verification = {}) {
  const before = verification.before;
  const after = verification.after;
  const progress = before?.found && after?.found
    ? `${before.done}/${before.valid} → ${after.done}/${after.valid}`
    : '';
  const message = verification.status === 'not_credited'
    ? 'Creality Cloud no incrementó Download Models.'
    : 'No se pudo verificar Download Models.';
  return progress ? `${message} (${progress})` : message;
}

function incentiveTaskNotFoundMessage(title, availableTasks = []) {
  const suffix = availableTasks.length ? ` Tareas detectadas: ${availableTasks.join(', ')}.` : '';
  return `No se encontró la tarea diaria "${title}".${suffix}`;
}

async function getModelTitle(page, candidate) {
  const titleCandidates = [
    page.locator('h1').first(),
    page.locator('[class*="model-title"], [class*="model-name"]').first()
  ];

  for (const locator of titleCandidates) {
    const text = normalize(await locator.textContent({ timeout: 2000 }).catch(() => ''));
    if (text && text.length <= 140) return text;
  }

  const pageTitle = normalize((await page.title().catch(() => '')).replace(/\s*[-|].*$/, ''));
  if (pageTitle && pageTitle.length <= 140 && !/^creality cloud$/i.test(pageTitle)) return pageTitle;

  const fallback = normalize(candidate.title);
  if (fallback && !/^\d+(?:[.,]\d+)?$/.test(fallback)) return fallback;
  return 'Diseño sin título';
}

function buildMessage(downloaded, failures, target) {
  const parts = [`Diseños descargados: ${downloaded.length}/${target}.`];
  if (failures.length) parts.push(`Fallos: ${failures.length}.`);
  return parts.join(' ');
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function modelIdentity(value) {
  const url = canonicalModelUrl(value);
  return {
    url,
    modelKey: modelKeyFromUrl(url),
    modelSlug: modelSlugFromUrl(url)
  };
}

function buildSeenModels(designs) {
  const seen = { keys: new Set(), slugs: new Set() };
  for (const design of designs) {
    rememberSeenModel(seen, design);
  }
  return seen;
}

function cloneSeenModels(seen) {
  return {
    keys: new Set(seen.keys),
    slugs: new Set(seen.slugs)
  };
}

function rememberSeenModel(seen, item) {
  const identity = item.modelKey || item.modelSlug ? item : modelIdentity(item.url);
  if (identity.modelKey) seen.keys.add(identity.modelKey);
  if (identity.modelSlug) seen.slugs.add(identity.modelSlug);
}

function hasSeenModel(seen, item) {
  if (!item) return false;
  return Boolean(
    (item.modelKey && seen.keys.has(item.modelKey))
    || (item.modelSlug && seen.slugs.has(item.modelSlug))
  );
}

function shuffle(items) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function sanitizeFilename(value) {
  return String(value || 'download.zip').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 180);
}

function slugify(value) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'download';
}

function taskError(code, category, message, systemic = false) {
  const error = new Error(message);
  error.code = code;
  error.category = category;
  error.systemic = systemic;
  error.userMessage = message;
  return error;
}

function diagnosticError(value, screenshot = '') {
  const error = taskError(value.code, value.category, value.message, value.systemic);
  error.diagnostic = value;
  error.screenshot = screenshot;
  return error;
}

async function ensureAutomationPage(page, observer, batchDir) {
  if (page && !page.isClosed()) return { page, observer };

  observer?.stop();
  const context = await restartAutomationBrowser({
    acceptDownloads: true,
    downloadsPath: batchDir
  });
  const replacement = context.pages()[0] || await context.newPage();
  return {
    page: replacement,
    observer: observeCrealityPage(replacement, 'modelDownloads')
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
