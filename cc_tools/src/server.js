import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { openLoginBrowser, closeLoginBrowser } from './crealityTask.js';
import {
  appendRun,
  commentImagesDir,
  deactivateFavoriteProfile,
  excludeDesign,
  readConfig,
  readDesigns,
  readRuns,
  reconcileDownloadRewardHistory,
  reconcileDownloadedDesignHistory,
  reconcileDesignActionHistory,
  setDesignActionCompleted,
  screenshotsDir,
  tempDownloadsDir,
  writeConfig
} from './storage.js';
import { startScheduler, runTaskNow, schedulerState } from './scheduler.js';
import { generateDownloadPlan, scheduleNextRun } from './timeWindow.js';
import { sendTelegram } from './telegram.js';
import { browserManagerState, shutdownBrowser, withAutomationBrowser } from './browserManager.js';
import { buildHealthMetrics } from './healthMetrics.js';
import { mergePointsState, readPointsSummary } from './pointsCounter.js';
import { discoverGcodeFiles, discoverGcodeLibrary, discoverPrinters } from './finishPrintDiscovery.js';
import { controlPrinter, readPrinterStatuses } from './finishPrintStatus.js';
import {
  recoverStalePendingFinishPrint,
  startFinishPrintMonitor,
  stopFinishPrintMonitor
} from './finishPrintMonitor.js';
import { readCrealityProfile } from './crealityProfile.js';
import { startDesignMetadataRepair, stopDesignMetadataRepair } from './designMetadataRepair.js';
import { readFavoriteProfile } from './crealityFavoriteProfile.js';
import { DEFAULT_FAVORITE_PROFILE, normalizeFavoriteProfiles, parseFavoriteProfileUrl } from './favoriteProfiles.js';
import {
  favoriteProfilesRefreshRunning,
  queueFavoriteProfileSync,
  queueFavoriteProfilesFullRefresh,
  startFavoriteModelIndex,
  stopFavoriteModelIndex
} from './favoriteModelIndex.js';
import { finishPrintSlotMinutes, requiredFinishPrintWindowMinutes } from './finishPrintSchedule.js';
import {
  activateNextFinishPrintProfile,
  normalizeFinishPrintProfiles,
  syncActiveFinishPrintProfile,
  totalFinishPrintDailyLimit
} from './finishPrintProfiles.js';
import {
  buildPrintUsageHistory,
  buildPrintShuffleBag,
  countCreditedFinishPrintRun,
  isFinishPrintStartRun,
  normalizeGcodeFiles,
  normalizeGcodeRecords
} from './finishPrintSelection.js';
import { filterDesigns, normalizeDesignSort, sortDesigns } from './designSearch.js';
import { buildCommentKindPlan, countTodayComments, normalizeComments } from './modelCommentTask.js';
import { CATALOG_CATEGORIES, normalizeCatalogCategories } from './modelDownloadTask.js';
import { normalizeShopGoal, readShopCatalog } from './shopGoal.js';
import { readShopOrders } from './shopOrders.js';
import { notifyShippedShopOrders } from './shopOrderNotifications.js';
import {
  archiveShopOrder,
  markShopOrdersRefreshError,
  mergeShopOrdersState,
  shopOrdersRefreshDue,
  shippedShopOrderTransitions
} from './shopOrdersState.js';
import {
  buildHomeAssistantEvents,
  buildHomeAssistantState,
  internalTaskId
} from './homeAssistantApi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '..', 'public');
const app = express();
const host = process.env.CCTOOLS_HOST || '0.0.0.0';
const port = Number(process.env.CCTOOLS_PORT || 8080);

app.use(express.json({ limit: '1mb' }));

app.use('/api', (_req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store'
  });
  next();
});

app.use('/assets', express.static(path.join(publicDir, 'assets')));

app.get('/api/status', async (req, res) => {
  const config = await readConfig();
  const runs = await readRuns();
  res.json({
    ok: true,
    scheduler: schedulerState(),
    browser: browserManagerState(),
    runtimePaths: { downloads: tempDownloadsDir() },
    favoriteProfilesRefreshRunning: favoriteProfilesRefreshRunning(),
    config: sanitizeConfig(config),
    nextExecutions: buildNextExecutions(config, runs),
    dailyCounters: buildDailyCounters(config, runs),
    healthMetrics: buildHealthMetrics(config, runs),
    latestRuns: runs.slice(0, 20)
  });
});

app.post('/api/automation/resume', async (req, res) => {
  const config = await readConfig();
  config.automationHealth = {
    ...(config.automationHealth || {}),
    state: 'active',
    reasonCode: '',
    reason: '',
    pausedAt: '',
    pausedUntil: '',
    lastRecoveredAt: new Date().toISOString(),
    pauseSource: ''
  };
  await writeConfig(config);
  const runs = await readRuns();
  res.json({
    ok: true,
    message: 'Automatizaciones reactivadas.',
    healthMetrics: buildHealthMetrics(config, runs)
  });
});

app.post('/api/points/refresh', async (req, res) => {
  try {
    const config = await readConfig();
    const timezone = config.tasks.creality.timezone || 'Europe/Madrid';
    const fullHistory = req.body?.fullHistory === true || config.points.historyComplete !== true;
    const snapshot = await withAutomationBrowser({}, async (context) => {
      const page = context.pages()[0] || await context.newPage();
      return readPointsSummary(page, { timezone, fullHistory });
    });
    const currentPoints = fullHistory && snapshot.historyComplete !== true
      ? { ...config.points, historyComplete: false }
      : config.points;
    config.points = mergePointsState(currentPoints, snapshot, {
      replaceTransactions: fullHistory && snapshot.historyComplete === true
    });
    await writeConfig(config);
    res.json({
      ok: snapshot.status === 'current',
      points: config.points,
      error: snapshot.status === 'current' ? '' : (snapshot.error || 'POINTS_UNAVAILABLE')
    });
  } catch (error) {
    res.status(409).json({ ok: false, error: error.message || 'POINTS_REFRESH_FAILED' });
  }
});

app.get('/api/shop/catalog', async (req, res) => {
  try {
    const catalog = await readShopCatalog(req.query.region);
    res.json({ ok: true, ...catalog });
  } catch (error) {
    res.status(409).json({
      ok: false,
      error: error.code || 'SHOP_CATALOG_FAILED',
      message: error.message || 'No se pudo consultar la tienda de Creality Cloud.'
    });
  }
});

app.post('/api/shop/orders/refresh', async (_req, res) => {
  const config = await readConfig();
  if (!shopOrdersRefreshDue(config.shopOrders)) {
    return res.json({ ok: true, orders: config.shopOrders, refreshed: false });
  }
  try {
    const orders = await readShopOrders();
    const previousOrders = config.shopOrders;
    config.shopOrders = mergeShopOrdersState(previousOrders, orders);
    const shippedOrders = shippedShopOrderTransitions(previousOrders, config.shopOrders);
    await writeConfig(config);
    await appendShippedOrderRuns(shippedOrders, 'manual');
    await notifyShippedShopOrders(config, shippedOrders);
    return res.json({ ok: true, orders: config.shopOrders, refreshed: true });
  } catch (error) {
    if (!['BROWSER_BUSY', 'REMOTE_BROWSER_OPEN'].includes(error.code)) {
      config.shopOrders = markShopOrdersRefreshError(config.shopOrders, error);
      await writeConfig(config);
    }
    return res.status(409).json({
      ok: false,
      error: error.code || 'SHOP_ORDERS_REFRESH_FAILED',
      message: error.message || 'No se pudieron actualizar los pedidos de Creality Cloud.',
      orders: config.shopOrders
    });
  }
});

app.patch('/api/shop/orders/:id/archive', async (req, res) => {
  const config = await readConfig();
  const orders = archiveShopOrder(config.shopOrders, req.params.id);
  if (!orders) return res.status(404).json({ ok: false, error: 'SHOP_ORDER_NOT_ARCHIVABLE' });
  config.shopOrders = orders;
  await writeConfig(config);
  return res.json({ ok: true, orders });
});

app.put('/api/shop/goal', async (req, res) => {
  const product = req.body?.product || {};
  const productId = String(product.id || '').trim();
  const name = String(product.name || '').trim();
  const points = Math.max(0, Number(product.points) || 0);
  if (!productId || !name || !points) {
    return res.status(400).json({ ok: false, error: 'SHOP_GOAL_INVALID' });
  }
  const config = await readConfig();
  config.shopGoal = normalizeShopGoal({
    enabled: true,
    productId,
    name,
    imageUrl: String(product.imageUrl || ''),
    points,
    region: String(product.region || 'ES'),
    regionName: String(product.regionName || ''),
    available: product.available !== false,
    scheduledAt: new Date().toISOString(),
    lastStatus: 'scheduled',
    lastMessage: 'Canje programado.'
  });
  await writeConfig(config);
  res.json({ ok: true, goal: config.shopGoal });
});

app.delete('/api/shop/goal', async (req, res) => {
  const config = await readConfig();
  config.shopGoal = normalizeShopGoal();
  await writeConfig(config);
  res.json({ ok: true, goal: config.shopGoal });
});

app.post('/api/creality/profile/refresh', async (req, res) => {
  if (browserManagerState().active) {
    return res.status(409).json({ ok: false, error: 'BROWSER_BUSY' });
  }
  try {
    const profile = await readCrealityProfile();
    const config = await readConfig();
    config.crealityProfile = profile;
    await writeConfig(config);
    return res.json({ ok: true, profile });
  } catch (error) {
    return res.status(409).json({ ok: false, error: error.code || error.message || 'CREALITY_PROFILE_UNAVAILABLE' });
  }
});

app.post('/api/creality/favorites', async (req, res) => {
  const parsed = parseFavoriteProfileUrl(req.body?.url);
  if (!parsed) {
    return res.status(400).json({ ok: false, error: 'FAVORITE_PROFILE_URL_INVALID' });
  }
  try {
    const config = await readConfig();
    if (!config.crealityProfile?.userId) {
      config.crealityProfile = await readCrealityProfile();
      await writeConfig(config);
    }
    if (String(config.crealityProfile?.userId || '') === parsed.userId) {
      return res.status(400).json({ ok: false, error: 'FAVORITE_PROFILE_IS_OWN' });
    }

    const favorites = normalizeFavoriteProfiles(config.crealityFavorites);
    if (favorites.some((profile) => profile.userId === parsed.userId)) {
      return res.status(409).json({ ok: false, error: 'FAVORITE_PROFILE_DUPLICATE' });
    }

    const profile = await readFavoriteProfile(parsed.profileUrl);
    profile.indexStatus = 'pending';
    config.crealityFavorites = normalizeFavoriteProfiles([...favorites, profile]);
    await writeConfig(config);
    queueFavoriteProfileSync(profile, { full: true, source: 'manual' });
    return res.json({ ok: true, favorites: config.crealityFavorites });
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error.code || error.message || 'FAVORITE_PROFILE_UNAVAILABLE'
    });
  }
});

app.post('/api/creality/favorites/refresh', async (req, res) => {
  const config = await readConfig();
  let favorites = normalizeFavoriteProfiles(config.crealityFavorites);
  const alreadyRunning = favoriteProfilesRefreshRunning();
  if (!alreadyRunning) {
    favorites = favorites.map((profile) => ({ ...profile, indexStatus: 'pending' }));
    config.crealityFavorites = favorites;
    await writeConfig(config);
  }

  queueFavoriteProfilesFullRefresh(favorites, { source: 'manual' })
    .catch((error) => console.error('[favorites] full refresh:', error.message));
  return res.status(202).json({
    ok: true,
    favorites,
    alreadyRunning
  });
});

app.get('/api/integration/status', async (_req, res) => {
  res.json(await homeAssistantState());
});

app.get('/api/integration/events', async (req, res) => {
  res.json({
    ok: true,
    apiVersion: 1,
    events: buildHomeAssistantEvents(await readRuns(), req.query.limit)
  });
});

app.patch('/api/integration/tasks/:taskId', async (req, res) => {
  const taskId = internalTaskId(req.params.taskId);
  if (!taskId) return res.status(404).json({ ok: false, error: 'INTEGRATION_TASK_NOT_FOUND' });
  try {
    const config = await readConfig();
    await setIntegrationTaskEnabled(config, taskId, req.body?.enabled === true);
    await writeConfig(config);
    return res.json(await homeAssistantState());
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error.code || 'INTEGRATION_TASK_UPDATE_FAILED',
      message: error.message || 'No se pudo actualizar la herramienta.'
    });
  }
});

app.post('/api/integration/tasks/:taskId/run', async (req, res) => {
  const taskId = internalTaskId(req.params.taskId);
  if (!taskId || taskId === 'finishPrint') {
    return res.status(404).json({ ok: false, error: 'INTEGRATION_TASK_NOT_FOUND' });
  }
  if (schedulerState().running) {
    return res.status(409).json({
      ok: false,
      error: 'TASK_ALREADY_RUNNING',
      message: 'Ya hay una ejecución en curso.'
    });
  }
  runTaskNow(taskId, 'manual').catch((error) => {
    console.error('[home-assistant]', error.message);
  });
  return res.status(202).json({ ok: true, accepted: true });
});

app.post('/api/integration/printers/:printerId/run', async (req, res) => {
  const printerId = String(req.params.printerId || '').trim();
  const config = await readConfig();
  if (!normalizeFinishPrintProfiles(config.tasks.finishPrint).some((profile) => profile.id === printerId)) {
    return res.status(404).json({ ok: false, error: 'FINISH_PRINT_PROFILE_NOT_FOUND' });
  }
  if (schedulerState().running) {
    return res.status(409).json({
      ok: false,
      error: 'TASK_ALREADY_RUNNING',
      message: 'Ya hay una ejecución en curso.'
    });
  }
  runTaskNow('finishPrint', 'manual', {
    finishPrintProfileId: printerId
  }).catch((error) => {
    console.error('[home-assistant]', error.message);
  });
  return res.status(202).json({ ok: true, accepted: true });
});

app.delete('/api/creality/favorites/:userId', async (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!/^\d+$/.test(userId)) {
    return res.status(400).json({ ok: false, error: 'FAVORITE_PROFILE_INVALID' });
  }
  if (userId === DEFAULT_FAVORITE_PROFILE.userId) {
    return res.status(400).json({ ok: false, error: 'FAVORITE_PROFILE_DEFAULT' });
  }

  const config = await readConfig();
  config.crealityFavorites = normalizeFavoriteProfiles(config.crealityFavorites)
    .filter((profile) => profile.userId !== userId);
  await writeConfig(config);
  await deactivateFavoriteProfile(userId);
  return res.json({ ok: true, favorites: config.crealityFavorites });
});

app.post('/api/tasks/finish-print/discover-printers', async (req, res) => {
  try {
    const printers = await discoverPrinters();
    res.json({ ok: true, printers });
  } catch (error) {
    res.status(409).json({ ok: false, error: error.code || error.message, message: error.message });
  }
});

app.post('/api/tasks/finish-print/discover-files', async (req, res) => {
  try {
    const files = await discoverGcodeFiles({
      name: String(req.body?.printerName || '').trim(),
      printerInterName: String(req.body?.printerInterName || '').trim(),
      deviceType: req.body?.deviceType
    });
    res.json({ ok: true, files });
  } catch (error) {
    res.status(409).json({ ok: false, error: error.code || error.message, message: error.message });
  }
});

app.post('/api/tasks/finish-print/discover-library', async (req, res) => {
  try {
    const files = await discoverGcodeLibrary();
    res.json({ ok: true, files });
  } catch (error) {
    res.status(409).json({ ok: false, error: error.code || error.message, message: error.message });
  }
});

app.post('/api/tasks/finish-print/status', async (req, res) => {
  try {
    const config = await readConfig();
    const task = config.tasks.finishPrint;
    const profiles = normalizeFinishPrintProfiles(task);
    const statuses = await readPrinterStatuses(finishPrintKnownPrinters(profiles, task));
    let changed = false;
    for (const status of statuses) {
      const profile = profiles.find((item) => item.printerName === status.printerName
        || (item.printerDeviceName && item.printerDeviceName === status.deviceName));
      if (profile) {
        status.printerProfileId = profile.id;
        if (status.telemetryId && profile.printerTelemetryId !== status.telemetryId) {
          profile.printerTelemetryId = status.telemetryId;
          changed = true;
        }
        if (status.deviceName && profile.printerDeviceName !== status.deviceName) {
          profile.printerDeviceName = status.deviceName;
          changed = true;
        }
        if (status.imageUrl && profile.printerImageUrl !== status.imageUrl) {
          profile.printerImageUrl = status.imageUrl;
          changed = true;
        }
      }
      const pending = task.pendingVerification;
      status.pending = Boolean(pending?.printId && (
        pending.printId === status.printId
        || pending.printerProfileId === status.printerProfileId
        || pending.printerName === status.printerName
      ));
      if (status.pending) {
        status.canStop = Boolean(status.telemetryId);
        if (!status.gcodeName) status.gcodeName = pending.file?.name || '';
      }
    }
    if (changed) {
      task.printerProfiles = profiles;
      await writeConfig(config);
    }
    res.json({ ok: true, printers: statuses, pendingVerification: task.pendingVerification || null });
  } catch (error) {
    res.status(409).json({
      ok: false,
      error: error.code || error.message,
      message: error.message,
      diagnostics: error.diagnostics || null
    });
  }
});

app.post('/api/tasks/finish-print/control', async (req, res) => {
  const action = String(req.body?.action || '').trim();
  const printerName = String(req.body?.printerName || '').trim();
  try {
    const config = await readConfig();
    if (action === 'kill') {
      const task = config.tasks.finishPrint;
      const pending = task.pendingVerification;
      if (!pending?.printId || (pending.printerName && pending.printerName !== printerName)) {
        return res.status(409).json({
          ok: false,
          error: 'FINISH_PRINT_PROCESS_NOT_FOUND',
          message: 'No hay ningún proceso pendiente de esta impresora que se pueda eliminar.'
        });
      }
      const finishedAt = new Date().toISOString();
      task.pendingVerification = null;
      task.lastRunAt = finishedAt;
      task.lastStatus = 'failed';
      task.lastMessage = `Proceso de impresión eliminado manualmente: ${pending.file?.name || pending.printId}.`;
      await writeConfig(config);
      await appendRun({
        taskId: 'finishPrint',
        source: 'manual',
        status: 'failed',
        message: task.lastMessage,
        finishedAt,
        details: {
          controlAction: 'kill',
          printerName,
          printId: pending.printId,
          releasedPending: true,
          file: pending.file || {}
        }
      });
      return res.json({ ok: true, action, printerName, killed: true, releasedPending: true });
    }
    const profiles = normalizeFinishPrintProfiles(config.tasks.finishPrint);
    const result = await controlPrinter({
      printerName,
      action,
      knownPrinters: finishPrintKnownPrinters(profiles, config.tasks.finishPrint)
    });
    const pending = config.tasks.finishPrint.pendingVerification;
    let releasedPending = false;
    if (action === 'stop' && pending?.printId && (
      pending.printId === result.printId || pending.printerName === result.printerName
    )) {
      config.tasks.finishPrint.pendingVerification = null;
      config.tasks.finishPrint.lastRunAt = new Date().toISOString();
      config.tasks.finishPrint.lastStatus = 'failed';
      config.tasks.finishPrint.lastMessage = `Impresión detenida manualmente: ${pending.file?.name || result.printId || result.printerName}.`;
      releasedPending = true;
      await writeConfig(config);
      await appendRun({
        taskId: 'finishPrint',
        source: 'manual',
        status: 'failed',
        message: config.tasks.finishPrint.lastMessage,
        finishedAt: config.tasks.finishPrint.lastRunAt,
        details: {
          controlAction: 'stop',
          printerName: result.printerName,
          printId: result.printId,
          stateBefore: result.stateBefore,
          stateBeforeLabel: result.stateBeforeLabel,
          controlResponses: result.responses,
          releasedPending: true,
          file: pending.file || {}
        }
      });
    }
    if (action === 'stop' && !releasedPending) {
      await appendRun({
        taskId: 'finishPrint',
        source: 'manual',
        status: 'failed',
        message: `Impresión detenida manualmente en ${result.printerName}.`,
        finishedAt: new Date().toISOString(),
        details: {
          controlAction: 'stop',
          printerName: result.printerName,
          printId: result.printId,
          stateBefore: result.stateBefore,
          stateBeforeLabel: result.stateBeforeLabel,
          controlResponses: result.responses,
          releasedPending: false
        }
      });
    }
    res.json({ ok: true, ...result, releasedPending });
  } catch (error) {
    const message = error.message || 'No se pudo controlar la impresora.';
    await appendRun({
      taskId: 'finishPrint',
      source: 'manual',
      status: 'error',
      message,
      finishedAt: new Date().toISOString(),
      details: {
        controlAction: action,
        printerName,
        failures: [{
          title: printerName || 'Impresora',
          error: message,
          diagnostic: {
            code: error.code || 'FINISH_PRINT_CONTROL_FAILED',
            category: 'technical',
            message,
            technical: { action, printerName, ...(error.diagnostics || {}) }
          }
        }]
      }
    }).catch(() => {});
    res.status(409).json({
      ok: false,
      error: error.code || error.message,
      message: error.message,
      diagnostics: error.diagnostics || null
    });
  }
});

app.post('/api/tasks/finish-print/run', async (req, res) => {
  try {
    const result = await runTaskNow('finishPrint', 'manual');
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(409).json({
      ok: false,
      error: error.code || 'FINISH_PRINT_EXECUTION_FAILED',
      message: error.message || 'No se pudo iniciar la impresión virtual.'
    });
  }
});

function finishPrintKnownPrinters(profiles, task = {}) {
  const fallbackGcodeId = String(
    task.pendingVerification?.file?.id
    || task.cloudFileRecords?.find?.((file) => file?.id)?.id
    || ''
  ).trim();
  return (Array.isArray(profiles) ? profiles : []).map((profile) => ({
    name: profile.printerName,
    deviceId: profile.printerDeviceId,
    deviceName: profile.printerDeviceName,
    telemetryId: profile.printerTelemetryId,
    model: profile.printerInterName,
    imageUrl: profile.printerImageUrl,
    deviceType: profile.printerDeviceType,
    authenticationGcodeId: String(
      profile.cloudFileRecords?.find?.((file) => file?.id)?.id || fallbackGcodeId
    ).trim()
  }));
}

app.post('/api/tasks/finish-print/run-selected', async (req, res) => {
  try {
    const result = await runTaskNow('finishPrint', 'manual', {
      finishPrintSelection: {
        printer: req.body?.printer,
        file: req.body?.file
      }
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(409).json({
      ok: false,
      error: error.code || 'FINISH_PRINT_EXECUTION_FAILED',
      message: error.message || 'No se pudo iniciar la impresión virtual.'
    });
  }
});

app.post(
  '/api/tasks/comments/images',
  express.raw({ type: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], limit: '10mb' }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ ok: false, error: 'COMMENT_IMAGE_REQUIRED' });
      }
      const mime = String(req.get('content-type') || '').split(';')[0].toLowerCase();
      const extension = ({
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp'
      })[mime];
      if (!extension) return res.status(415).json({ ok: false, error: 'COMMENT_IMAGE_FORMAT_INVALID' });
      const id = crypto.randomUUID();
      const filename = `${id}${extension}`;
      await fs.mkdir(commentImagesDir(), { recursive: true });
      await fs.writeFile(path.join(commentImagesDir(), filename), req.body, { flag: 'wx' });
      res.json({
        ok: true,
        image: {
          id,
          filename,
          name: decodeURIComponent(String(req.get('x-file-name') || 'imagen').slice(0, 180)),
          mime
        }
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.code || 'COMMENT_IMAGE_UPLOAD_FAILED', message: error.message });
    }
  }
);

app.post('/api/tasks/comments/run', async (req, res) => {
  try {
    const result = await runTaskNow('comments', 'manual');
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(409).json({
      ok: false,
      error: error.code || 'COMMENT_EXECUTION_FAILED',
      message: error.message || 'No se pudo ejecutar el comentario. Revisa el diagnóstico en Logs.'
    });
  }
});

app.post('/api/tasks/model-boosts/run', async (req, res) => {
  try {
    const result = await runTaskNow('modelBoosts', 'manual');
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(409).json({
      ok: false,
      error: error.code || 'MODEL_BOOST_EXECUTION_FAILED',
      message: error.message || 'No se pudo ejecutar Impulsar diseños. Revisa el diagnóstico en Logs.'
    });
  }
});

app.get('/api/schedule/preview', async (req, res) => {
  const config = await readConfig();
  const runs = await readRuns();
  if (ensureCurrentDownloadPlan(config.tasks.modelDownloads, runs)) {
    await writeConfig(config);
  }
  res.json({
    ok: true,
    items: buildSchedulePreview(config, runs)
  });
});

app.patch('/api/config', async (req, res) => {
  const config = await readConfig();
  const input = req.body || {};
  let timezoneChanged = false;
  let setupCompletedNow = false;

  if (input.session) {
    const timezone = String(input.session.timezone || '').trim();
    if (!isValidTimezone(timezone)) {
      return res.status(400).json({ ok: false, error: 'INVALID_TIMEZONE' });
    }
    timezoneChanged = timezone !== config.timezone;
    config.timezone = timezone;
    for (const task of Object.values(config.tasks)) {
      task.timezone = timezone;
    }
    if (config.tasks.finishPrint.pendingVerification) {
      config.tasks.finishPrint.pendingVerification.timezone = timezone;
    }
  }

  if (input.telegram) {
    config.telegram.enabled = Boolean(input.telegram.enabled);
    config.telegram.notifyOnSuccess = input.telegram.notifyOnSuccess !== false;
    config.telegram.notifyOnError = input.telegram.notifyOnError !== false;
    config.telegram.notifyOnDesignDownload = input.telegram.notifyOnDesignDownload !== false;
    config.telegram.notifyOnDesignError = input.telegram.notifyOnDesignError !== false;
    config.telegram.notifyOnModelLike = input.telegram.notifyOnModelLike !== false;
    config.telegram.notifyOnModelLikeError = input.telegram.notifyOnModelLikeError !== false;
    config.telegram.notifyOnFinishPrint = input.telegram.notifyOnFinishPrint !== false;
    config.telegram.notifyOnFinishPrintError = input.telegram.notifyOnFinishPrintError !== false;
    config.telegram.notifyOnComment = input.telegram.notifyOnComment !== false;
    config.telegram.notifyOnCommentError = input.telegram.notifyOnCommentError !== false;
    config.telegram.notifyOnModelBoost = input.telegram.notifyOnModelBoost !== false;
    config.telegram.notifyOnModelBoostError = input.telegram.notifyOnModelBoostError !== false;
    config.telegram.notifyOnShopRedemption = input.telegram.notifyOnShopRedemption !== false;
    config.telegram.notifyOnShopRedemptionError = input.telegram.notifyOnShopRedemptionError !== false;
    config.telegram.notifyOnShopOrderShipped = input.telegram.notifyOnShopOrderShipped !== false;
    if (String(input.telegram.botToken || '').trim()) {
      config.telegram.botToken = String(input.telegram.botToken).trim();
    }
    config.telegram.chatId = String(input.telegram.chatId || '');
  }

  if (input.creality) {
    const enabled = Boolean(input.creality.enabled);
    const windowStart = validClock(input.creality.windowStart, '08:00');
    const windowEnd = validClock(input.creality.windowEnd, '12:00');
    if (enabled && windowStart === windowEnd) {
      return res.status(400).json({ ok: false, error: 'WINDOW_START_EQUALS_END' });
    }
    config.tasks.creality.enabled = enabled;
    config.tasks.creality.windowStart = windowStart;
    config.tasks.creality.windowEnd = windowEnd;
    config.tasks.creality.timezone = config.timezone || 'Europe/Madrid';
    config.tasks.creality.nextRunAt = scheduleNextRun(config.tasks.creality);
  }

  if (input.finishPrint) {
    if (Array.isArray(input.finishPrint.printerProfiles)) {
      const validation = await applyFinishPrintProfilesConfig(config, input.finishPrint);
      if (validation) return res.status(400).json({ ok: false, ...validation });
    } else {
    const previousPrinterName = config.tasks.finishPrint.printerName || '';
    config.tasks.finishPrint.enabled = Boolean(input.finishPrint.enabled);
    config.tasks.finishPrint.windowStart = validClock(input.finishPrint.windowStart, config.tasks.finishPrint.windowStart || '08:00');
    config.tasks.finishPrint.windowEnd = validClock(input.finishPrint.windowEnd, config.tasks.finishPrint.windowEnd || '20:00');
    config.tasks.finishPrint.timezone = config.timezone || 'Europe/Madrid';
    config.tasks.finishPrint.dailyLimit = clamp(Number(input.finishPrint.dailyLimit), 0, 10, config.tasks.finishPrint.dailyLimit || 1);
    config.tasks.finishPrint.pointsPerPrint = 5;
    config.tasks.finishPrint.minIntervalMinutes = clamp(
      Number(input.finishPrint.minIntervalMinutes),
      10,
      1440,
      config.tasks.finishPrint.minIntervalMinutes || 10
    );
    if (Object.hasOwn(input.finishPrint, 'printerName')) {
      config.tasks.finishPrint.printerName = String(input.finishPrint.printerName || '').trim().slice(0, 120);
    }
    if (Object.hasOwn(input.finishPrint, 'printerDeviceId')) {
      config.tasks.finishPrint.printerDeviceId = String(input.finishPrint.printerDeviceId || '').trim().slice(0, 120);
    }
    if (Object.hasOwn(input.finishPrint, 'printerDeviceName')) {
      config.tasks.finishPrint.printerDeviceName = String(input.finishPrint.printerDeviceName || '').trim().slice(0, 160);
    }
    if (Object.hasOwn(input.finishPrint, 'printerInterName')) {
      config.tasks.finishPrint.printerInterName = String(input.finishPrint.printerInterName || '').trim().slice(0, 120);
    }
    if (Object.hasOwn(input.finishPrint, 'printerDeviceType')) {
      const printerDeviceType = Number(input.finishPrint.printerDeviceType);
      config.tasks.finishPrint.printerDeviceType = Number.isFinite(printerDeviceType) ? printerDeviceType : null;
    }
    if (Object.hasOwn(input.finishPrint, 'cloudFiles')) {
      const cloudFiles = normalizeGcodeFiles(input.finishPrint.cloudFiles);
      const cloudFileRecords = normalizeGcodeRecords(input.finishPrint.cloudFileRecords)
        .filter((record) => cloudFiles.includes(record.name));
      const selectionChanged = previousPrinterName !== config.tasks.finishPrint.printerName
        || JSON.stringify(cloudFiles) !== JSON.stringify(config.tasks.finishPrint.cloudFiles || [])
        || JSON.stringify(cloudFileRecords) !== JSON.stringify(config.tasks.finishPrint.cloudFileRecords || []);
      config.tasks.finishPrint.cloudFiles = cloudFiles;
      config.tasks.finishPrint.cloudFileRecords = cloudFileRecords;
      if (selectionChanged) {
        config.tasks.finishPrint.shuffleBag = buildPrintShuffleBag(config.tasks.finishPrint);
        config.tasks.finishPrint.shuffleBagCursor = 0;
      }
    }
    if (Object.hasOwn(input.finishPrint, 'discoveryUpdatedAt')) {
      config.tasks.finishPrint.discoveryUpdatedAt = String(input.finishPrint.discoveryUpdatedAt || '');
    }
    const requiredMinutes = requiredFinishPrintWindowMinutes(config.tasks.finishPrint);
    if (windowDurationMinutes(config.tasks.finishPrint) < requiredMinutes) {
      return res.status(400).json({ ok: false, error: 'WINDOW_TOO_SHORT', requiredMinutes });
    }
    if (config.tasks.finishPrint.enabled) {
      const runs = await readRuns();
      const attemptsToday = countTodayFinishPrintStarts(runs, config.tasks.finishPrint);
      const remainingCount = Math.max(0, config.tasks.finishPrint.dailyLimit - attemptsToday);
      const plan = generateDownloadPlan(config.tasks.finishPrint, new Date(), {
        remainingCount,
        minimumSlotMinutes: finishPrintSlotMinutes(config.tasks.finishPrint)
      });
      config.tasks.finishPrint.printPlanDate = plan.date;
      config.tasks.finishPrint.printPlan = plan.plan;
      config.tasks.finishPrint.printPlanCursor = plan.cursor;
      config.tasks.finishPrint.printPlanDoneCount = attemptsToday;
      config.tasks.finishPrint.nextRunAt = plan.nextRunAt;
    } else {
      config.tasks.finishPrint.printPlan = [];
      config.tasks.finishPrint.printPlanCursor = 0;
      config.tasks.finishPrint.nextRunAt = '';
    }
    syncActiveFinishPrintProfile(config.tasks.finishPrint);
    config.tasks.finishPrint.totalDailyLimit = totalFinishPrintDailyLimit(config.tasks.finishPrint);
    }
  }

  if (input.comments) {
    const task = config.tasks.comments;
    task.enabled = Boolean(input.comments.enabled);
    task.windowStart = validClock(input.comments.windowStart, task.windowStart || '08:00');
    task.windowEnd = validClock(input.comments.windowEnd, task.windowEnd || '20:00');
    task.timezone = config.timezone || 'Europe/Madrid';
    task.prioritizeFavorites = input.comments.prioritizeFavorites !== false;
    task.imageDailyLimit = clamp(Number(input.comments.imageDailyLimit), 0, 5, task.imageDailyLimit ?? 5);
    task.textDailyLimit = clamp(Number(input.comments.textDailyLimit), 0, 1, task.textDailyLimit ?? 1);
    task.dailyLimit = task.imageDailyLimit + task.textDailyLimit;
    task.minIntervalMinutes = clamp(Number(input.comments.minIntervalMinutes), 10, 1440, task.minIntervalMinutes || 10);
    if (Object.hasOwn(input.comments, 'comments')) {
      task.comments = normalizeComments(input.comments.comments).slice(0, 250);
    }
    const requiredMinutes = task.dailyLimit * (task.minIntervalMinutes + 2);
    if (windowDurationMinutes(task) < requiredMinutes) {
      return res.status(400).json({ ok: false, error: 'WINDOW_TOO_SHORT', requiredMinutes });
    }
    if (task.enabled) {
      const counts = countTodayComments(await readRuns(), task.timezone);
      const remainingCount = Math.max(0, task.imageDailyLimit - counts.image)
        + Math.max(0, task.textDailyLimit - counts.text);
      const generated = generateDownloadPlan(task, new Date(), { remainingCount });
      task.commentPlanDate = generated.date;
      task.commentPlan = generated.plan;
      task.commentKindPlan = buildCommentKindPlan(task, counts);
      task.commentPlanCursor = generated.cursor;
      task.commentPlanDoneCount = counts.image + counts.text;
      task.nextRunAt = generated.nextRunAt;
    } else {
      task.commentPlan = [];
      task.commentKindPlan = [];
      task.commentPlanCursor = 0;
      task.nextRunAt = '';
    }
  }

  if (input.modelBoosts) {
    const task = config.tasks.modelBoosts;
    task.enabled = Boolean(input.modelBoosts.enabled);
    task.windowStart = validClock(input.modelBoosts.windowStart, task.windowStart || '08:00');
    task.windowEnd = validClock(input.modelBoosts.windowEnd, task.windowEnd || '12:00');
    task.favoriteOnly = input.modelBoosts.favoriteOnly !== false;
    task.timezone = config.timezone || 'Europe/Madrid';
    task.dailyLimit = 1;
    task.nextRunAt = task.enabled ? scheduleNextRun(task) : '';
  }

  if (input.modelDownloads) {
    config.tasks.modelDownloads.enabled = Boolean(input.modelDownloads.enabled);
    config.tasks.modelDownloads.windowStart = validClock(input.modelDownloads.windowStart, '08:00');
    config.tasks.modelDownloads.windowEnd = validClock(input.modelDownloads.windowEnd, '12:00');
    config.tasks.modelDownloads.timezone = config.timezone || 'Europe/Madrid';
    config.tasks.modelDownloads.dailyLimit = clamp(Number(input.modelDownloads.dailyLimit), 0, 30, 1);
    config.tasks.modelDownloads.minIntervalMinutes = clamp(Number(input.modelDownloads.minIntervalMinutes), 10, 1440, 10);
    config.tasks.modelDownloads.cleanupAfterHours = clamp(Number(input.modelDownloads.cleanupAfterHours), 1, 168, 1);
    config.tasks.modelDownloads.prioritizeFavorites = input.modelDownloads.prioritizeFavorites !== false;
    config.tasks.modelDownloads.catalogCategories = normalizeCatalogCategories(input.modelDownloads.catalogCategories);
    const requiredMinutes = requiredModelDownloadWindowMinutes(config.tasks.modelDownloads);
    if (windowDurationMinutes(config.tasks.modelDownloads) < requiredMinutes) {
      return res.status(400).json({ ok: false, error: 'WINDOW_TOO_SHORT', requiredMinutes });
    }
    if (!config.tasks.modelDownloads.enabled) {
      config.tasks.modelLikes.enabled = false;
      config.tasks.modelLikes.nextRunAt = '';
    }
    if (config.tasks.modelDownloads.enabled) {
      const plan = generateDownloadPlan(config.tasks.modelDownloads, new Date());
      config.tasks.modelDownloads.downloadPlanDate = plan.date;
      config.tasks.modelDownloads.downloadPlan = plan.plan;
      config.tasks.modelDownloads.downloadPlanCursor = plan.cursor;
      config.tasks.modelDownloads.downloadsToday = 0;
      config.tasks.modelDownloads.nextRunAt = plan.nextRunAt;
    } else {
      config.tasks.modelDownloads.downloadPlan = [];
      config.tasks.modelDownloads.downloadPlanCursor = 0;
      config.tasks.modelDownloads.nextRunAt = '';
    }
  }

  for (const taskId of ['modelLikes']) {
    if (!input[taskId]) continue;
    config.tasks[taskId].enabled = Boolean(input[taskId].enabled) && config.tasks.modelDownloads.enabled;
    config.tasks[taskId].windowStart = validClock(input[taskId].windowStart, '08:00');
    config.tasks[taskId].windowEnd = validClock(input[taskId].windowEnd, '12:00');
    config.tasks[taskId].prioritizeFavorites = input[taskId].prioritizeFavorites !== false;
    config.tasks[taskId].timezone = config.timezone || 'Europe/Madrid';
    config.tasks[taskId].dailyLimit = 1;
    config.tasks[taskId].nextRunAt = config.tasks[taskId].enabled ? scheduleNextRun(config.tasks[taskId]) : '';
  }

  if (input.setup) {
    setupCompletedNow = config.setup.assistantCompleted !== true
      && input.setup.assistantCompleted === true;
    config.setup.assistantCompleted = Boolean(input.setup.assistantCompleted);
  }

  if (timezoneChanged) {
    await rebuildSchedulesForTimezone(config);
  }

  await writeConfig(config);
  if (setupCompletedNow) {
    queueFavoriteProfilesFullRefresh(normalizeFavoriteProfiles(config.crealityFavorites), { source: 'schedule' })
      .catch((error) => console.error('[favorites] initial refresh:', error.message));
  }
  const runs = await readRuns();
  res.json({
    ok: true,
    config: sanitizeConfig(config),
    nextExecutions: buildNextExecutions(config, runs)
  });
});

app.post('/api/telegram/test', async (req, res) => {
  const config = await readConfig();
  try {
    await sendTelegram(config, 'CC Tools: prueba de Telegram correcta.');
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/tasks/creality/run', async (req, res) => {
  try {
    const result = await runTaskNow('creality', 'manual', { skipRaffle: true });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(409).json({ ok: false, error: error.message });
  }
});

app.post('/api/tasks/model-downloads/run', async (req, res) => {
  try {
    const result = await runTaskNow('modelDownloads', 'manual', { test: Boolean(req.body?.test) });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(409).json({ ok: false, error: error.message });
  }
});

app.post('/api/tasks/model-likes/run', async (req, res) => {
  try {
    const result = await runTaskNow('modelLikes', 'manual', { test: Boolean(req.body?.test) });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(409).json({ ok: false, error: error.message });
  }
});

app.get('/api/designs', async (req, res) => {
  const page = clamp(Number(req.query.page), 1, Number.MAX_SAFE_INTEGER, 1);
  const pageSize = 20;
  const query = String(req.query.q || '').slice(0, 120);
  const sorting = normalizeDesignSort(String(req.query.sort || ''), String(req.query.direction || ''));
  const config = await readConfig();
  const filters = {
    from: String(req.query.from || ''),
    to: String(req.query.to || ''),
    like: String(req.query.like || 'all'),
    collection: String(req.query.collection || 'all'),
    comment: String(req.query.comment || 'all'),
    favoriteAuthor: String(req.query.favoriteAuthor || 'all'),
    timezone: config.timezone || 'Europe/Madrid'
  };
  const allDesigns = (await readDesigns()).filter((design) => design.indexedOnly !== true);
  const designs = sortDesigns(filterDesigns(allDesigns, query, filters), sorting.key, sorting.direction);
  const totalPages = Math.max(1, Math.ceil(designs.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  res.json({
    ok: true,
    page: safePage,
    pageSize,
    total: designs.length,
    totalPages,
    query,
    filters,
    sort: sorting.key,
    direction: sorting.direction,
    designs: designs.slice(start, start + pageSize)
  });
});

app.delete('/api/designs/:id', async (req, res) => {
  try {
    const design = await excludeDesign(String(req.params.id || ''));
    if (!design) return res.status(404).json({ ok: false, error: 'DESIGN_NOT_FOUND' });
    res.json({ ok: true, design });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || 'DESIGN_DELETE_FAILED' });
  }
});

app.get('/api/tasks/model-downloads/categories', (_req, res) => {
  res.json({ ok: true, categories: CATALOG_CATEGORIES });
});

app.patch('/api/designs/:id/actions/:action', async (req, res) => {
  const actionKey = ({ like: 'like_model' })[String(req.params.action || '')];
  if (!actionKey) return res.status(400).json({ ok: false, error: 'DESIGN_ACTION_INVALID' });

  const startedAt = new Date().toISOString();
  const taskId = 'modelLikes';
  const actionLabel = 'Dar me gusta';
  const designId = String(req.params.id || '');
  const completed = Boolean(req.body?.completed);
  let currentDesign = null;

  try {
    currentDesign = (await readDesigns()).find((design) => design.id === designId);
    if (!currentDesign) throw manualActionError('DESIGN_NOT_FOUND', 'No se encontró el diseño.', 404);

    const design = await setDesignActionCompleted(designId, actionKey, completed);
    await appendManualDesignActionRun({
      taskId,
      actionLabel,
      actionKey,
      design,
      completed,
      startedAt
    });
    res.json({ ok: true, design });
  } catch (error) {
    const wrapped = error.code
      ? error
      : manualActionError(
        'DESIGN_UPDATE_FAILED',
        error.message || 'No se pudo actualizar el diseño.',
        error.status || 500,
        {
          upstreamStatus: error.status || 0,
          endpoint: error.endpoint || '',
          response: error.response || null
        }
      );
    await appendManualDesignActionRun({
      taskId,
      actionLabel,
      actionKey,
      design: currentDesign,
      completed,
      startedAt,
      error: wrapped
    });
    res.status(wrapped.httpStatus || wrapped.status || 500).json({
      ok: false,
      error: wrapped.code || 'DESIGN_UPDATE_FAILED',
      message: wrapped.message || 'No se pudo actualizar el diseño.'
    });
  }
});

function manualActionError(code, message, httpStatus = 500, technical = {}) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  error.technical = technical;
  return error;
}

async function appendManualDesignActionRun({
  taskId,
  actionLabel,
  actionKey,
  design,
  completed,
  startedAt,
  error = null
}) {
  const finishedAt = new Date().toISOString();
  if (error) {
    const technical = {
      ...(error.technical || {}),
      upstreamStatus: error.status || error.technical?.upstreamStatus || 0,
      endpoint: error.endpoint || error.technical?.endpoint || '',
      response: error.response || error.technical?.response || null
    };
    const diagnostic = {
      code: error.code || 'DESIGN_UPDATE_FAILED',
      category: 'action',
      systemic: false,
      message: error.message || 'No se pudo actualizar el diseño.',
      url: design?.url || '',
      technical
    };
    await appendRun({
      taskId,
      source: 'manual',
      status: 'failed',
      message: `${actionLabel}: no se pudo ${completed ? 'marcar como completada' : 'marcar como pendiente'}.`,
      startedAt,
      finishedAt,
      screenshots: [],
      details: {
        acted: [],
        failures: [{
          title: design?.title || 'Diseño desconocido',
          url: design?.url || '',
          code: diagnostic.code,
          category: diagnostic.category,
          error: diagnostic.message,
          diagnostic
        }],
        diagnostics: [diagnostic],
        manualAction: { actionKey, completed }
      }
    });
    return;
  }

  await appendRun({
    taskId,
    source: 'manual',
    status: 'success',
    message: `${actionLabel}: tarea ${completed ? 'marcada como completada' : 'marcada como pendiente'}.`,
    startedAt,
    finishedAt,
    screenshots: [],
    details: {
      acted: design ? [design] : [],
      failures: [],
      diagnostics: [],
      manualAction: { actionKey, completed }
    }
  });
}

app.post('/api/tasks/creality/login/open', async (req, res) => {
  try {
    const result = await openLoginBrowser();
    res.json({
      ok: true,
      result,
      url: '/novnc/vnc.html?autoconnect=1&reconnect=1&reconnect_delay=1000&resize=remote&path=novnc%2Fwebsockify'
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/tasks/creality/login/close', async (req, res) => {
  try {
    const result = await closeLoginBrowser();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.use('/screenshots', express.static(screenshotsDir()));
app.use('/novnc', createProxyMiddleware({
  target: 'http://127.0.0.1:6081',
  changeOrigin: true,
  ws: true,
  pathRewrite: { '^/novnc': '' }
}));
app.use('/', express.static(publicDir, { index: 'index.html' }));

const startupConfig = await readConfig();
await reconcileDownloadRewardHistory();
await reconcileDownloadedDesignHistory();
await reconcileDesignActionHistory();
await reconcileFinishPrintUsageHistory();
await recoverStalePendingFinishPrint();
startScheduler();
startFinishPrintMonitor();
startFavoriteModelIndex();
startDesignMetadataRepair();

const server = app.listen(port, host, () => {
  console.log(`CC Tools escuchando en http://${host}:${port}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    console.log(`[shutdown] ${signal}: cerrando Chromium y el servidor.`);
    stopFinishPrintMonitor();
    stopFavoriteModelIndex();
    stopDesignMetadataRepair();
    await shutdownBrowser();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}

function sanitizeConfig(config) {
  return {
    ...config,
    telegram: {
      ...config.telegram,
      botToken: mask(config.telegram.botToken)
    }
  };
}

async function homeAssistantState() {
  const config = await readConfig();
  const runs = await readRuns();
  return buildHomeAssistantState({
    config,
    runs,
    scheduler: schedulerState(),
    browser: browserManagerState(),
    dailyCounters: buildDailyCounters(config, runs),
    nextExecutions: buildNextExecutions(config, runs),
    health: buildHealthMetrics(config, runs)
  });
}

async function setIntegrationTaskEnabled(config, taskId, enabled) {
  const task = config.tasks?.[taskId];
  if (!task) {
    throw Object.assign(new Error('No se encontró la herramienta.'), { code: 'INTEGRATION_TASK_NOT_FOUND' });
  }
  if (taskId === 'modelLikes' && enabled && config.tasks.modelDownloads.enabled !== true) {
    throw Object.assign(new Error('Activa primero Descubrir diseños.'), { code: 'MODEL_DOWNLOADS_REQUIRED' });
  }
  if (taskId === 'finishPrint' && enabled && !normalizeFinishPrintProfiles(task).length) {
    throw Object.assign(new Error('Configura al menos una impresora en CC Tools.'), {
      code: 'FINISH_PRINT_PROFILE_REQUIRED'
    });
  }

  task.enabled = enabled;
  if (!enabled) {
    task.nextRunAt = '';
    if (taskId === 'modelDownloads') {
      task.downloadPlan = [];
      task.downloadPlanCursor = 0;
      config.tasks.modelLikes.enabled = false;
      config.tasks.modelLikes.nextRunAt = '';
    }
    if (taskId === 'comments') {
      task.commentPlan = [];
      task.commentKindPlan = [];
      task.commentPlanCursor = 0;
    }
    if (taskId === 'finishPrint') {
      task.printerProfiles = normalizeFinishPrintProfiles(task).map((profile) => ({
        ...profile,
        printPlan: [],
        printPlanCursor: 0,
        nextRunAt: ''
      }));
      activateNextFinishPrintProfile(task, { sync: false });
    }
    return;
  }
  await rebuildSchedulesForTimezone(config);
}

async function appendShippedOrderRuns(orders, source) {
  for (const order of orders) {
    const finishedAt = new Date().toISOString();
    await appendRun({
      taskId: 'shopOrders',
      source,
      status: 'success',
      message: `Pedido disponible: ${order.title}`,
      startedAt: finishedAt,
      finishedAt,
      screenshots: [],
      details: { order }
    });
  }
}

async function reconcileFinishPrintUsageHistory() {
  const config = await readConfig();
  const finishPrint = config.tasks.finishPrint;
  if (finishPrint.usageHistoryImportedAt) return;
  const historicalCounts = buildPrintUsageHistory(await readRuns());
  finishPrint.fileUsageCounts = {
    ...historicalCounts,
    ...(finishPrint.fileUsageCounts || {})
  };
  finishPrint.usageHistoryImportedAt = new Date().toISOString();
  await writeConfig(config);
}

function buildDailyCounters(config, runs) {
  return {
    creality: countTodayRuns(runs, 'creality', config.tasks.creality, countCheckinRun),
    finishPrint: countTodayRuns(runs, 'finishPrint', config.tasks.finishPrint, countCreditedFinishPrintRun),
    modelDownloads: countTodayRuns(runs, 'modelDownloads', config.tasks.modelDownloads, countDownloadedDesigns),
    comments: countTodayRuns(runs, 'comments', config.tasks.comments, countCreditedComments),
    modelBoosts: countTodayRuns(runs, 'modelBoosts', config.tasks.modelBoosts, countConsumedBoosts),
    modelLikes: countTodayRuns(runs, 'modelLikes', config.tasks.modelLikes, countActedDesigns)
  };
}

function buildSchedulePreview(config, runs = []) {
  const items = [];
  addSingleScheduleItem(items, config.tasks.creality, 'creality', 'Check-in diario', runs, countCheckinRun);

  normalizeFinishPrintProfiles(config.tasks.finishPrint).forEach((profile, index) => {
    profile.timezone = config.tasks.finishPrint.timezone;
    addPlannedTaskItems({
      items,
      taskConfig: { ...profile, enabled: config.tasks.finishPrint.enabled },
      taskId: 'finishPrint',
      label: profile.printerName ? `Enviar una impresión · ${profile.printerName}` : 'Enviar una impresión',
      itemLabel: 'Impresión',
      planKey: 'printPlan',
      cursorKey: 'printPlanCursor',
      events: todayFinishPrintEvents(runs, profile, index === 0),
      maxDailyLimit: 10
    });
  });

  const downloads = config.tasks.modelDownloads;
  const today = dayKey(downloads.timezone || 'Europe/Madrid');
  const plan = Array.isArray(downloads.downloadPlan) ? downloads.downloadPlan : [];
  const downloadEvents = todayDownloadEvents(runs, downloads);
  const dailyLimit = Math.max(0, Math.min(30, Number(downloads.dailyLimit) || 0));

  if (downloads.enabled) {
    downloadEvents.forEach((event, index) => {
      items.push({
        taskId: 'modelDownloads',
        label: 'Descarga de diseños',
        detail: `Diseño ${index + 1} de ${dailyLimit}`,
        runAt: event.finishedAt,
        status: event.status === 'success' ? 'done' : 'failed'
      });
    });

    const cursor = Math.max(0, Number(downloads.downloadPlanCursor) || 0);
    effectivePendingPlan(downloads, plan, cursor).filter((runAt) => dayKey(downloads.timezone || 'Europe/Madrid', new Date(runAt)) === today).forEach((runAt, index) => {
      items.push({
        taskId: 'modelDownloads',
        label: 'Descarga de diseños',
        detail: `Diseño ${downloadEvents.length + index + 1} de ${dailyLimit}`,
        runAt,
        status: 'pending'
      });
    });
  }

  addPlannedTaskItems({
    items,
    taskConfig: config.tasks.comments,
    taskId: 'comments',
    label: 'Comentarios',
    itemLabel: 'Comentario',
    planKey: 'commentPlan',
    cursorKey: 'commentPlanCursor',
    events: todayCommentEvents(runs, config.tasks.comments),
    maxDailyLimit: 6,
    eventLabel: (event) => commentScheduleLabel(event.commentKind),
    pendingLabel: (_runAt, index, cursor) => commentScheduleLabel(config.tasks.comments.commentKindPlan?.[cursor + index])
  });

  addSingleScheduleItem(items, config.tasks.modelBoosts, 'modelBoosts', 'Impulsar diseños', runs, countConsumedBoosts);

  addSingleScheduleItem(items, config.tasks.modelLikes, 'modelLikes', 'Dar me gusta', runs, countActedDesigns);
  return applyPreviewAutomationGap(items
    .filter((item) => item.runAt)
    .sort((left, right) => new Date(left.runAt).getTime() - new Date(right.runAt).getTime()));
}

function addSingleScheduleItem(items, taskConfig, taskId, label, runs = [], counter = () => 0) {
  if (!taskConfig?.enabled) return;
  const timezone = taskConfig.timezone || 'Europe/Madrid';
  const today = dayKey(timezone);
  const lastRun = runs.find((run) => run.taskId === taskId
    && dayKey(timezone, new Date(run.finishedAt || run.createdAt)) === today
    && counter(run) > 0);
  const nextRunAt = taskConfig.nextRunAt || '';
  const nextRunIsToday = nextRunAt && dayKey(timezone, new Date(nextRunAt)) === today;
  if (!lastRun && !nextRunIsToday) return;

  items.push({
    taskId,
    label,
    detail: lastRun ? 'Ejecución de hoy' : 'Próxima ejecución',
    runAt: lastRun ? lastRun.finishedAt || lastRun.createdAt : nextRunAt,
    status: lastRun ? 'done' : 'pending'
  });
}

function countTodayRuns(runs, taskId, taskConfig, counter) {
  const timezone = taskConfig?.timezone || 'Europe/Madrid';
  const today = dayKey(timezone);
  return runs
    .filter((run) => run.taskId === taskId && dayKey(timezone, new Date(run.finishedAt || run.createdAt)) === today)
    .reduce((total, run) => total + counter(run), 0);
}

function countCheckinRun(run) {
  return run.status === 'success' ? 1 : 0;
}

function countDownloadedDesigns(run) {
  return creditedDownloads(run).length;
}

function countActedDesigns(run) {
  return Array.isArray(run.details?.acted) ? run.details.acted.length : 0;
}

function buildNextExecutions(config, runs = []) {
  const next = {};
  for (const item of buildSchedulePreview(config, runs)) {
    if (item.status !== 'pending' || next[item.taskId]) continue;
    next[item.taskId] = item.runAt;
  }
  const checkin = config.tasks.creality;
  const checkinCompletedToday = countTodayRuns(runs, 'creality', checkin, countCheckinRun) > 0;
  if (!next.creality && checkin?.enabled && checkinCompletedToday && checkin.nextRunAt) {
    next.creality = checkin.nextRunAt;
  }
  return next;
}

function countCreditedComments(run) {
  return run.details?.rewardVerification?.status === 'credited' ? 1 : 0;
}

function countConsumedBoosts(run) {
  return run.details?.boostConsumed === true ? 1 : 0;
}

function addPlannedTaskItems({
  items,
  taskConfig,
  taskId,
  label,
  itemLabel,
  planKey,
  cursorKey,
  events,
  maxDailyLimit,
  eventLabel,
  pendingLabel
}) {
  if (!taskConfig?.enabled) return;
  const timezone = taskConfig.timezone || 'Europe/Madrid';
  const today = dayKey(timezone);
  const dailyLimit = Math.max(0, Math.min(maxDailyLimit, Number(taskConfig.dailyLimit) || 0));
  const plan = Array.isArray(taskConfig[planKey]) ? taskConfig[planKey] : [];

  events.forEach((event, index) => {
    items.push({
      taskId,
      label: eventLabel?.(event, index) || label,
      detail: `${itemLabel} ${index + 1} de ${dailyLimit}`,
      runAt: event.finishedAt,
      status: event.status === 'success' ? 'done' : 'failed'
    });
  });

  const cursor = Math.max(0, Number(taskConfig[cursorKey]) || 0);
  effectivePendingPlan(taskConfig, plan, cursor)
    .filter((runAt) => dayKey(timezone, new Date(runAt)) === today)
    .forEach((runAt, index) => {
      items.push({
        taskId,
        label: pendingLabel?.(runAt, index, cursor) || label,
        detail: `${itemLabel} ${events.length + index + 1} de ${dailyLimit}`,
        runAt,
        status: 'pending'
      });
    });
}

function effectivePendingPlan(taskConfig, plan, cursor) {
  const pending = plan.slice(cursor);
  if (!pending.length || !taskConfig.nextRunAt) return pending;
  const planned = new Date(pending[0]);
  const effective = new Date(taskConfig.nextRunAt);
  if (Number.isNaN(planned.getTime()) || Number.isNaN(effective.getTime()) || effective <= planned) return pending;
  const shiftMs = effective.getTime() - planned.getTime();
  return pending.map((runAt) => {
    const date = new Date(runAt);
    return Number.isNaN(date.getTime()) ? runAt : new Date(date.getTime() + shiftMs).toISOString();
  });
}

function countTodayFinishPrintStarts(runs, taskConfig, profileId = '', includeLegacyRuns = true) {
  const timezone = taskConfig?.timezone || 'Europe/Madrid';
  const today = dayKey(timezone);
  return runs.filter((run) => isFinishPrintStartRun(run)
    && (!profileId || run.details?.printerProfileId === profileId || (includeLegacyRuns && !run.details?.printerProfileId))
    && dayKey(timezone, new Date(run.finishedAt || run.createdAt)) === today).length;
}

function todayFinishPrintEvents(runs, taskConfig, includeLegacyRuns = false) {
  const timezone = taskConfig?.timezone || 'Europe/Madrid';
  const today = dayKey(timezone);
  return runs
    .filter((run) => isFinishPrintStartRun(run)
      && (run.details?.printerProfileId === taskConfig.id || (includeLegacyRuns && !run.details?.printerProfileId))
      && dayKey(timezone, new Date(run.finishedAt || run.createdAt)) === today)
    .map((run) => ({
      status: run.status,
      finishedAt: run.finishedAt || run.createdAt
    }));
}

function todayCommentEvents(runs, taskConfig) {
  const timezone = taskConfig?.timezone || 'Europe/Madrid';
  const today = dayKey(timezone);
  return runs
    .filter((run) => run.taskId === 'comments'
      && dayKey(timezone, new Date(run.finishedAt || run.createdAt)) === today)
    .map((run) => ({
      status: run.status,
      finishedAt: run.finishedAt || run.createdAt,
      commentKind: run.details?.commentKind || ''
    }));
}

function commentScheduleLabel(kind) {
  if (kind === 'image') return 'Comentario con imagen';
  if (kind === 'text') return 'Comentario sin imagen';
  return 'Comentarios';
}

function ensureCurrentDownloadPlan(downloads, runs = []) {
  if (!downloads?.enabled) return false;
  const timezone = downloads.timezone || 'Europe/Madrid';
  const today = dayKey(timezone);
  const dailyLimit = Math.max(0, Math.min(30, Number(downloads.dailyLimit) || 0));
  if (downloads.downloadPlanDate === today) return false;

  const attemptsToday = todayDownloadAttempts(runs, downloads).length;
  const remainingCount = Math.max(0, dailyLimit - attemptsToday);
  const generated = generateDownloadPlan(downloads, new Date(), { remainingCount });
  downloads.downloadPlanDate = generated.date;
  downloads.downloadPlan = generated.plan;
  downloads.downloadPlanCursor = generated.cursor;
  downloads.downloadPlanDoneCount = attemptsToday;
  downloads.downloadsToday = attemptsToday;
  downloads.nextRunAt = generated.nextRunAt;
  return true;
}

function applyPreviewAutomationGap(items) {
  const gapMs = 10 * 60 * 1000;
  let previousTime = null;

  return items.map((item) => {
    const currentTime = new Date(item.runAt).getTime();
    if (!Number.isFinite(currentTime)) return item;
    let nextTime = currentTime;

    if (item.status !== 'done' && previousTime !== null) {
      nextTime = Math.max(nextTime, previousTime + gapMs);
    }

    previousTime = nextTime;
    return nextTime === currentTime ? item : { ...item, runAt: new Date(nextTime).toISOString() };
  });
}

function todayDownloadEvents(runs, taskConfig) {
  const timezone = taskConfig?.timezone || 'Europe/Madrid';
  const today = dayKey(timezone);
  const events = [];

  for (const run of runs) {
    if (run.taskId !== 'modelDownloads') continue;
    const finishedAt = run.finishedAt || run.createdAt;
    if (!finishedAt || dayKey(timezone, new Date(finishedAt)) !== today) continue;
    if (run.source !== 'schedule' && creditedDownloads(run).length <= 0) continue;
    events.push({ finishedAt, status: run.status });
  }

  return events.sort((left, right) => new Date(left.finishedAt).getTime() - new Date(right.finishedAt).getTime());
}

function todayDownloadAttempts(runs, taskConfig) {
  return todayDownloadEvents(runs, taskConfig);
}

function creditedDownloads(run) {
  return (Array.isArray(run.details?.downloaded) ? run.details.downloaded : [])
    .filter((design) => design.rewardStatus === 'credited');
}

function dayKey(timezone, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function mask(value) {
  if (!value) return '';
  return value.length <= 8 ? '********' : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function validClock(value, fallback) {
  return /^\d{1,2}:\d{2}$/.test(String(value || '')) ? String(value) : fallback;
}

function isValidTimezone(value) {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

async function rebuildSchedulesForTimezone(config) {
  const runs = await readRuns();
  const checkin = config.tasks.creality;
  checkin.nextRunAt = checkin.enabled ? scheduleNextRun(checkin) : '';

  for (const taskId of ['modelLikes']) {
    const task = config.tasks[taskId];
    task.nextRunAt = task.enabled ? scheduleNextRun(task) : '';
  }

  const boosts = config.tasks.modelBoosts;
  boosts.nextRunAt = boosts.enabled ? scheduleNextRun(boosts) : '';

  const downloads = config.tasks.modelDownloads;
  if (downloads.enabled) {
    const attempts = todayDownloadAttempts(runs, downloads).length;
    const remainingCount = Math.max(0, downloads.dailyLimit - attempts);
    const generated = generateDownloadPlan(downloads, new Date(), { remainingCount });
    downloads.downloadPlanDate = generated.date;
    downloads.downloadPlan = generated.plan;
    downloads.downloadPlanCursor = generated.cursor;
    downloads.downloadPlanDoneCount = attempts;
    downloads.downloadsToday = attempts;
    downloads.nextRunAt = generated.nextRunAt;
  }

  const finishPrint = config.tasks.finishPrint;
  if (finishPrint.enabled) {
    const profiles = normalizeFinishPrintProfiles(finishPrint);
    profiles.forEach((profile, index) => {
      profile.timezone = finishPrint.timezone;
      const attempts = countTodayFinishPrintStarts(runs, profile, profile.id, index === 0);
      const generated = generateDownloadPlan(profile, new Date(), {
        remainingCount: Math.max(0, profile.dailyLimit - attempts),
        minimumSlotMinutes: finishPrintSlotMinutes(profile)
      });
      profile.printPlanDate = generated.date;
      profile.printPlan = generated.plan;
      profile.printPlanCursor = generated.cursor;
      profile.printPlanDoneCount = attempts;
      profile.nextRunAt = generated.nextRunAt;
    });
    finishPrint.printerProfiles = profiles;
    activateNextFinishPrintProfile(finishPrint, { sync: false });
  }

  const comments = config.tasks.comments;
  if (comments.enabled) {
    const counts = countTodayComments(runs, comments.timezone);
    const remainingCount = Math.max(0, comments.imageDailyLimit - counts.image)
      + Math.max(0, comments.textDailyLimit - counts.text);
    const generated = generateDownloadPlan(comments, new Date(), { remainingCount });
    comments.commentPlanDate = generated.date;
    comments.commentPlan = generated.plan;
    comments.commentKindPlan = buildCommentKindPlan(comments, counts);
    comments.commentPlanCursor = generated.cursor;
    comments.commentPlanDoneCount = counts.image + counts.text;
    comments.nextRunAt = generated.nextRunAt;
  }
}

async function applyFinishPrintProfilesConfig(config, input) {
  const task = config.tasks.finishPrint;
  const previous = normalizeFinishPrintProfiles(task);
  const previousById = new Map(previous.map((profile) => [profile.id, profile]));
  const requested = input.printerProfiles.slice(0, 12).map((profile, index) => ({
    ...(previousById.get(String(profile?.id || '')) || {}),
    ...profile,
    id: String(profile?.id || `printer-${index + 1}`)
  }));
  const profiles = normalizeFinishPrintProfiles({ printerProfiles: requested });
  if (profiles.some((profile) => !profile.printerName)) {
    return { error: 'FINISH_PRINT_PRINTER_REQUIRED' };
  }
  const printerNames = profiles.map((profile) => profile.printerName).filter(Boolean);
  if (new Set(printerNames).size !== printerNames.length) {
    return { error: 'FINISH_PRINT_PRINTER_DUPLICATE' };
  }
  const pendingProfileId = String(task.pendingVerification?.printerProfileId || '');
  if (pendingProfileId && !profiles.some((profile) => profile.id === pendingProfileId)) {
    return { error: 'FINISH_PRINT_PROFILE_PENDING' };
  }

  for (const profile of profiles) {
    const previousProfile = previousById.get(profile.id);
    const selectionChanged = !previousProfile
      || previousProfile.printerName !== profile.printerName
      || previousProfile.printMode !== profile.printMode
      || JSON.stringify(previousProfile.cloudFiles || []) !== JSON.stringify(profile.cloudFiles)
      || JSON.stringify(previousProfile.cloudFileRecords || []) !== JSON.stringify(profile.cloudFileRecords);
    if (selectionChanged) {
      profile.shuffleBag = buildPrintShuffleBag(profile);
      profile.shuffleBagCursor = 0;
    }
    profile.timezone = config.timezone || 'Europe/Madrid';
    const requiredMinutes = requiredFinishPrintWindowMinutes(profile);
    if (windowDurationMinutes(profile) < requiredMinutes) {
      return { error: 'WINDOW_TOO_SHORT', requiredMinutes, printerName: profile.printerName };
    }
  }

  task.enabled = Boolean(input.enabled) && profiles.length > 0;
  task.timezone = config.timezone || 'Europe/Madrid';
  task.pointsPerPrint = 5;
  task.printerProfiles = profiles;
  const runs = await readRuns();
  if (task.enabled) {
    profiles.forEach((profile, index) => {
      const attempts = countTodayFinishPrintStarts(runs, profile, profile.id, index === 0);
      const generated = generateDownloadPlan(profile, new Date(), {
        remainingCount: Math.max(0, profile.dailyLimit - attempts),
        minimumSlotMinutes: finishPrintSlotMinutes(profile)
      });
      profile.printPlanDate = generated.date;
      profile.printPlan = generated.plan;
      profile.printPlanCursor = generated.cursor;
      profile.printPlanDoneCount = attempts;
      profile.nextRunAt = generated.nextRunAt;
    });
  } else {
    for (const profile of profiles) {
      profile.printPlan = [];
      profile.printPlanCursor = 0;
      profile.nextRunAt = '';
    }
  }
  activateNextFinishPrintProfile(task, { sync: false });
  task.totalDailyLimit = totalFinishPrintDailyLimit(task);
  return null;
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function requiredModelDownloadWindowMinutes(taskConfig) {
  const dailyLimit = clamp(Number(taskConfig.dailyLimit), 0, 30, 1);
  const minIntervalMinutes = clamp(Number(taskConfig.minIntervalMinutes), 10, 1440, 10);
  return dailyLimit * (minIntervalMinutes + 2);
}

function windowDurationMinutes(taskConfig) {
  const start = parseClock(taskConfig.windowStart || '08:00');
  const end = parseClock(taskConfig.windowEnd || '12:00');
  let minutes = end - start;
  if (minutes <= 0) minutes += 24 * 60;
  return minutes;
}

function parseClock(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Math.min(23, Math.max(0, Number(match[1]))) * 60
    + Math.min(59, Math.max(0, Number(match[2])));
}
