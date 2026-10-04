import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const temporaryDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cctools-storage-'));
const previousDataDir = process.env.CCTOOLS_DATA_DIR;
process.env.CCTOOLS_DATA_DIR = temporaryDataDir;

const storage = await import(`../src/storage.js?storage-test=${Date.now()}`);

after(async () => {
  if (previousDataDir === undefined) delete process.env.CCTOOLS_DATA_DIR;
  else process.env.CCTOOLS_DATA_DIR = previousDataDir;
  await fs.rm(temporaryDataDir, { recursive: true, force: true });
});

test('conserva cambios simultáneos realizados sobre distintas partes de la configuración', async () => {
  const pointsUpdate = await storage.readConfig();
  const schedulerUpdate = await storage.readConfig();

  pointsUpdate.points.total = 1234;
  schedulerUpdate.tasks.creality.lastStatus = 'success';
  schedulerUpdate.tasks.creality.lastMessage = 'Check-in completado';

  await Promise.all([
    storage.writeConfig(pointsUpdate),
    storage.writeConfig(schedulerUpdate)
  ]);

  const saved = await storage.readConfig();
  assert.equal(saved.points.total, 1234);
  assert.equal(saved.tasks.creality.lastStatus, 'success');
  assert.equal(saved.tasks.creality.lastMessage, 'Check-in completado');
});

test('añade la configuración inicial de Enviar una impresión', async () => {
  const config = await storage.readConfig();

  assert.equal(config.timezone, 'Europe/Madrid');
  assert.equal(config.tasks.finishPrint.enabled, false);
  assert.equal(config.tasks.finishPrint.dailyLimit, 10);
  assert.equal(config.tasks.finishPrint.pointsPerPrint, 5);
  assert.equal(config.tasks.finishPrint.windowStart, '08:00');
  assert.equal(config.tasks.finishPrint.windowEnd, '20:00');
  assert.equal(config.tasks.finishPrint.timezone, 'Europe/Madrid');
  assert.equal(config.tasks.finishPrint.minIntervalMinutes, 10);
  assert.equal(config.tasks.finishPrint.printerName, '');
  assert.equal(config.tasks.finishPrint.printerDeviceId, '');
  assert.equal(config.tasks.finishPrint.printerDeviceName, '');
  assert.equal(config.tasks.finishPrint.printerInterName, '');
  assert.equal(config.tasks.finishPrint.printerDeviceType, null);
  assert.deepEqual(config.tasks.finishPrint.cloudFiles, []);
  assert.deepEqual(config.tasks.finishPrint.cloudFileRecords, []);
  assert.deepEqual(config.tasks.finishPrint.fileUsageCounts, {});
  assert.equal(config.tasks.finishPrint.usageHistoryImportedAt, '');
  assert.deepEqual(config.tasks.finishPrint.shuffleBag, []);
  assert.equal(config.tasks.finishPrint.pendingVerification, null);
  assert.deepEqual(config.tasks.finishPrint.printPlan, []);
  assert.equal(config.tasks.finishPrint.printPlanCursor, 0);
  assert.equal(config.tasks.finishPrint.printPlanDoneCount, 0);
  assert.equal(config.telegram.notifyOnFinishPrint, true);
  assert.equal(config.telegram.notifyOnFinishPrintError, true);
});

test('activa por defecto la prioridad de favoritos y todo el catálogo', async () => {
  const config = await storage.readConfig();

  assert.equal(config.tasks.modelDownloads.prioritizeFavorites, true);
  assert.deepEqual(config.tasks.modelDownloads.catalogCategories, []);
  assert.equal(config.tasks.modelDownloads.cleanupAfterHours, 1);
  assert.equal(config.tasks.modelDownloads.dailyLimit, 30);
  assert.equal(config.tasks.modelDownloads.windowStart, '08:00');
  assert.equal(config.tasks.modelDownloads.windowEnd, '14:00');
});

test('conserva el límite de descargas elegido al actualizar', async () => {
  const config = await storage.readConfig();
  config.tasks.modelDownloads.dailyLimit = 7;
  config.tasks.modelDownloads.windowEnd = '18:00';
  await storage.writeConfig(config);
  const saved = await storage.readConfig();
  assert.equal(saved.tasks.modelDownloads.dailyLimit, 7);
  assert.equal(saved.tasks.modelDownloads.windowEnd, '18:00');
});

test('limpia descargas temporales vencidas y conserva las recientes', async () => {
  const expired = path.join(storage.tempDownloadsDir(), 'expired');
  const current = path.join(storage.tempDownloadsDir(), 'current');
  await fs.mkdir(expired, { recursive: true });
  await fs.mkdir(current, { recursive: true });
  const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await fs.utimes(expired, oldDate, oldDate);

  await storage.cleanupTemporaryDownloads(1);

  assert.equal(await fs.stat(expired).then(() => true).catch(() => false), false);
  assert.equal(await fs.stat(current).then(() => true).catch(() => false), true);
});

test('migra la zona horaria anterior a la configuración global', async () => {
  const legacy = await storage.readConfig();
  delete legacy.timezone;
  legacy.tasks.creality.timezone = 'Atlantic/Canary';
  await fs.writeFile(path.join(temporaryDataDir, 'config.json'), JSON.stringify(legacy));

  const migrated = await storage.readConfig();

  assert.equal(migrated.timezone, 'Atlantic/Canary');
  assert.equal(migrated.tasks.creality.timezone, 'Atlantic/Canary');
  assert.equal(migrated.tasks.finishPrint.timezone, 'Atlantic/Canary');
  assert.equal(migrated.tasks.modelDownloads.timezone, 'Atlantic/Canary');
});

test('elimina las credenciales internas heredadas de la configuración', async () => {
  const legacy = await storage.readConfig();
  legacy.auth = { passwordHash: 'hash-antiguo', passwordSalt: 'sal-antigua' };
  await fs.writeFile(path.join(temporaryDataDir, 'config.json'), JSON.stringify(legacy));

  const migrated = await storage.readConfig();
  const stored = JSON.parse(await fs.readFile(path.join(temporaryDataDir, 'config.json'), 'utf8'));

  assert.equal(Object.hasOwn(migrated, 'auth'), false);
  assert.equal(Object.hasOwn(stored, 'auth'), false);
});

test('conserva la programación y las notificaciones de colecciones al actualizar', async () => {
  const legacy = await storage.readConfig();
  legacy.tasks.modelCollections = {
    enabled: true,
    windowStart: '08:00',
    windowEnd: '12:00',
    nextRunAt: '2026-09-29T08:00:00.000Z'
  };
  legacy.telegram.notifyOnModelCollection = true;
  legacy.telegram.notifyOnModelCollectionError = true;
  await fs.writeFile(path.join(temporaryDataDir, 'config.json'), JSON.stringify(legacy));

  const migrated = await storage.readConfig();

  assert.equal(migrated.tasks.modelCollections.enabled, true);
  assert.equal(migrated.tasks.modelCollections.nextRunAt, '2026-09-29T08:00:00.000Z');
  assert.equal(migrated.tasks.modelCollections.dailyLimit, 1);
  assert.equal(migrated.telegram.notifyOnModelCollection, true);
  assert.equal(migrated.telegram.notifyOnModelCollectionError, true);
});

test('recupera automáticamente una configuración vacía desde la copia de respaldo', async () => {
  const config = await storage.readConfig();
  config.telegram.enabled = true;
  await storage.writeConfig(config);

  await fs.writeFile(path.join(temporaryDataDir, 'config.json'), '', 'utf8');
  const recovered = await storage.readConfig();
  const restoredFile = JSON.parse(await fs.readFile(path.join(temporaryDataDir, 'config.json'), 'utf8'));

  assert.equal(recovered.points.total, 1234);
  assert.equal(recovered.telegram.enabled, true);
  assert.equal(restoredFile.points.total, 1234);
  assert.equal(restoredFile.telegram.enabled, true);
});

test('un diseño eliminado queda excluido de futuras descargas', async () => {
  const url = 'https://www.crealitycloud.com/es/model-detail/my-own-model?source=2&profileId=abc123';
  const first = await storage.appendDesign({ title: 'Mi diseño', url });
  assert.equal(first.created, true);

  const removed = await storage.excludeDesign(first.record.id);
  assert.equal(removed.title, 'Mi diseño');
  assert.deepEqual(await storage.readDesigns(), []);

  const repeated = await storage.appendDesign({ title: 'Mi diseño', url });
  assert.equal(repeated.created, false);
  assert.equal(repeated.excluded, true);
  assert.deepEqual(await storage.readDesigns(), []);
  assert.equal((await storage.readExcludedDesigns()).length, 1);
});

test('un modelo comercial queda excluido sin añadirse a diseños descargados', async () => {
  const commercial = {
    title: 'Modelo comercial',
    url: 'https://www.crealitycloud.com/es/model-detail/commercial-model?profileId=commercial'
  };

  const exclusion = await storage.excludeModelCandidate(commercial, 'commercial_model');
  const repeated = await storage.appendDesign(commercial);
  const excluded = await storage.readExcludedDesigns();

  assert.equal(exclusion.created, true);
  assert.equal(repeated.created, false);
  assert.equal(repeated.excluded, true);
  assert.equal(excluded.find((item) => item.modelSlug === 'commercial-model')?.reason, 'commercial_model');
});

test('una acción sin recompensa no marca el diseño como completado', async () => {
  const created = await storage.appendDesign({
    title: 'Diseño sin recompensa',
    url: 'https://www.crealitycloud.com/es/model-detail/no-reward?profileId=no-reward'
  });
  const verification = {
    status: 'not_credited',
    before: { found: true, done: 0, valid: 1 },
    after: { found: true, done: 0, valid: 1 }
  };

  const updated = await storage.updateDesignAction(
    created.record.id,
    'add_to_collection',
    'applied_uncredited',
    verification
  );

  assert.equal(updated.collectionCompleted, false);
  assert.equal(updated.collectionCompletedAt, '');
  assert.equal(updated.collectionActionState, 'applied_uncredited');
  assert.equal(updated.collectionRewardStatus, 'not_credited');
});

test('solo una recompensa acreditada completa la acción del diseño', async () => {
  const designs = await storage.readDesigns();
  const design = designs.find((item) => item.title === 'Diseño sin recompensa');
  const verification = {
    status: 'credited',
    before: { found: true, done: 0, valid: 1 },
    after: { found: true, done: 1, valid: 1 }
  };

  const updated = await storage.updateDesignAction(
    design.id,
    'add_to_collection',
    'credited',
    verification
  );

  assert.equal(updated.collectionCompleted, true);
  assert.equal(updated.collectionActionState, 'credited');
  assert.equal(updated.collectionRewardStatus, 'credited');
  assert.ok(updated.collectionCompletedAt);
});

test('conserva la categoría de un diseño descargado', async () => {
  const created = await storage.appendDesign({
    title: 'Diseño doméstico',
    url: 'https://www.crealitycloud.com/es/model-detail/home-design',
    category: 'Hogar'
  });

  assert.equal(created.record.category, 'Hogar');
  assert.equal((await storage.readDesigns()).find((design) => design.id === created.record.id)?.category, 'Hogar');
});

test('repara la categoría sin alterar la fecha de actividad del diseño', async () => {
  const created = await storage.appendDesign({
    title: 'Diseño antiguo sin categoría',
    url: 'https://www.crealitycloud.com/es/model-detail/old-design',
    updatedAt: '2026-09-20T10:00:00.000Z'
  });

  const repaired = await storage.updateDesignMetadata(created.record.id, { category: 'Arte y diseño' });

  assert.equal(repaired.category, 'Arte y diseño');
  assert.equal(repaired.updatedAt, '2026-09-20T10:00:00.000Z');
});

test('un me gusta aplicado externamente queda registrado y no vuelve a ser candidato', async () => {
  const created = await storage.appendDesign({
    title: 'Diseño marcado fuera de CC Tools',
    url: 'https://www.crealitycloud.com/es/model-detail/external-like?profileId=external-like'
  });
  const verification = { status: 'already_applied' };

  const updated = await storage.updateDesignAction(
    created.record.id,
    'like_model',
    'already_applied',
    verification
  );

  assert.equal(updated.likeCompleted, true);
  assert.equal(updated.likeActionState, 'already_applied');
  assert.equal(updated.likeRewardStatus, 'already_applied');
  assert.ok(updated.likeCompletedAt);
});

test('permite alternar manualmente las acciones de un diseño sin inventar recompensas', async () => {
  const created = await storage.appendDesign({
    title: 'Diseño ajustado manualmente',
    url: 'https://www.crealitycloud.com/es/model-detail/manual-status?profileId=manual-status'
  });

  const completed = await storage.setDesignActionCompleted(created.record.id, 'like_model', true);
  assert.equal(completed.likeCompleted, true);
  assert.equal(completed.likeActionState, 'manual_completed');
  assert.equal(completed.likeRewardStatus, '');
  assert.ok(completed.likeCompletedAt);
  assert.ok(completed.likeManualOverrideAt);

  const pending = await storage.setDesignActionCompleted(created.record.id, 'like_model', false);
  assert.equal(pending.likeCompleted, false);
  assert.equal(pending.likeActionState, 'pending');
  assert.equal(pending.likeCompletedAt, '');
  assert.ok(pending.likeManualOverrideAt);

  await storage.appendRun({
    taskId: 'modelLikes',
    status: 'success',
    finishedAt: '2026-01-01T12:00:00.000Z',
    details: {
      acted: [{
        id: created.record.id,
        rewardVerification: { status: 'credited' }
      }]
    }
  });
  await storage.reconcileDesignActionHistory();
  const reconciled = (await storage.readDesigns()).find((design) => design.id === created.record.id);
  assert.equal(reconciled.likeCompleted, false);
  assert.equal(reconciled.likeActionState, 'pending');
});

test('marca un diseño como comentado y actualiza su fecha de actividad', async () => {
  const created = await storage.appendDesign({
    title: 'Diseño comentado',
    url: 'https://www.crealitycloud.com/es/model-detail/commented-design?profileId=commented-design'
  });
  const previousUpdatedAt = created.record.updatedAt;

  const updated = await storage.markDesignCommented(created.record.id, { kind: 'image' });

  assert.equal(updated.commentCompleted, true);
  assert.equal(updated.commentKind, 'image');
  assert.equal(updated.commentActionState, 'published');
  assert.ok(updated.commentCompletedAt);
  assert.ok(Date.parse(updated.updatedAt) >= Date.parse(previousUpdatedAt));
});

test('registra como ya aplicado un comentario encontrado en Creality Cloud', async () => {
  const created = await storage.appendDesign({
    title: 'Diseño comentado externamente',
    url: 'https://www.crealitycloud.com/es/model-detail/external-comment'
  });
  const completedAt = '2026-09-26T11:28:11.000Z';

  const updated = await storage.markDesignCommented(created.record.id, {
    kind: 'text',
    actionState: 'already_applied',
    completedAt
  });

  assert.equal(updated.commentCompleted, true);
  assert.equal(updated.commentActionState, 'already_applied');
  assert.equal(updated.commentCompletedAt, completedAt);
});

test('recupera de los logs el estado de comentarios anteriores', async () => {
  const created = await storage.appendDesign({
    title: 'Comentario histórico',
    url: 'https://www.crealitycloud.com/es/model-detail/historical-comment?profileId=historical-comment',
    downloadedAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-09-20T12:00:00.000Z'
  });
  await storage.appendRun({
    taskId: 'comments',
    status: 'success',
    finishedAt: '2026-09-23T12:00:00.000Z',
    details: {
      commentKind: 'text',
      acted: [{ id: created.record.id, commentKind: 'text' }]
    }
  });

  await storage.reconcileDesignActionHistory();
  const reconciled = (await storage.readDesigns()).find((design) => design.id === created.record.id);

  assert.equal(reconciled.commentCompleted, true);
  assert.equal(reconciled.commentKind, 'text');
  assert.equal(reconciled.updatedAt, '2026-09-23T12:00:00.000Z');
});

test('reclasifica como fallidas las descargas históricas sin puntos verificados', async () => {
  await storage.appendRun({
    taskId: 'modelDownloads',
    source: 'schedule',
    status: 'success',
    message: 'Diseños descargados: 1/1.',
    finishedAt: new Date().toISOString(),
    details: {
      downloaded: [{
        title: 'Descarga antigua',
        url: 'https://www.crealitycloud.com/es/model-detail/old-download',
        rewardStatus: 'unverified'
      }]
    }
  });

  assert.equal(await storage.reconcileDownloadRewardHistory(), true);
  const [run] = await storage.readRuns();
  assert.equal(run.status, 'failed');
  assert.equal(run.details.downloaded.length, 0);
  assert.equal(run.details.attemptedDownloads.length, 1);
  assert.equal(run.details.failures[0].code, 'REWARD_HISTORY_UNVERIFIED');
});

test('indexa favoritos sin mostrarlos como descargas y conserva su historial al retirarlos', async () => {
  const profile = {
    userId: '555001',
    name: 'Perfil favorito',
    profileUrl: 'https://www.crealitycloud.com/es/user/555001'
  };
  const first = { title: 'Favorito uno', url: 'https://www.crealitycloud.com/es/model-detail/favorito-uno' };
  const second = { title: 'Favorito dos', url: 'https://www.crealitycloud.com/es/model-detail/favorito-dos' };

  await storage.reconcileFavoriteModels(profile, [first, second], { full: true });
  let designs = await storage.readDesigns();
  const indexed = designs.find((design) => design.title === first.title);
  assert.equal(indexed.indexedOnly, true);
  assert.equal(indexed.downloadedAt, '');
  assert.equal(indexed.favoriteActive, true);

  await storage.reconcileFavoriteModels(profile, [first], { full: true });
  designs = await storage.readDesigns();
  assert.equal(designs.find((design) => design.title === second.title).favoriteAvailability, 'missing');
  await storage.reconcileFavoriteModels(profile, [first], { full: true });
  designs = await storage.readDesigns();
  assert.equal(designs.find((design) => design.title === second.title).favoriteAvailability, 'unavailable');

  const downloaded = await storage.appendDesign({
    ...first,
    source: 'favorite',
    fileName: 'favorito-uno.3mf',
    fileSize: 128,
    downloadVerified: true,
    rewardStatus: 'credited'
  });
  assert.equal(downloaded.record.id, indexed.id);
  assert.equal(downloaded.record.indexedOnly, false);
  assert.ok(downloaded.record.downloadedAt);

  await storage.deactivateFavoriteProfile(profile.userId);
  designs = await storage.readDesigns();
  const retained = designs.find((design) => design.id === indexed.id);
  assert.equal(retained.favoriteActive, false);
  assert.equal(retained.favoriteProfileRemoved, true);
  assert.equal(retained.rewardStatus, 'credited');
});

test('actualiza la identidad de un diseño existente al indexarlo desde un perfil favorito', async () => {
  const profile = {
    userId: '8589082269',
    name: 'La_R3D',
    profileUrl: 'https://www.crealitycloud.com/es/user/8589082269'
  };
  await storage.appendDesign({
    title: 'Modelo existente',
    url: 'https://www.crealitycloud.com/es/model-detail/modelo-existente',
    downloadedAt: new Date().toISOString()
  });

  await storage.reconcileFavoriteModels(profile, [{
    title: 'Modelo existente',
    url: 'https://www.crealitycloud.com/es/model-detail/modelo-existente?profileId=perfil-123'
  }], { full: true });

  const designs = await storage.readDesigns();
  const indexed = designs.find((design) => design.title === 'Modelo existente');
  assert.equal(indexed.favoriteProfileId, profile.userId);
  assert.equal(indexed.favoriteActive, true);
  assert.equal(indexed.modelKey, 'modelo-existente::perfil-123');
  assert.ok(indexed.discoveredAt);
  assert.ok(Number.isFinite(Date.parse(indexed.discoveredAt)));
});

test('conserva la fecha de descubrimiento al volver a indexar un favorito', async () => {
  const profile = {
    userId: '8589082269',
    name: 'La_R3D',
    profileUrl: 'https://www.crealitycloud.com/es/user/8589082269'
  };
  const model = {
    title: 'Modelo con fecha estable',
    url: 'https://www.crealitycloud.com/es/model-detail/modelo-fecha-estable?profileId=perfil-456'
  };
  const initialDate = '2026-09-20T08:00:00.000Z';

  await storage.reconcileFavoriteModels(profile, [{ ...model, discoveredAt: initialDate }], { full: true });
  await storage.reconcileFavoriteModels(profile, [{ ...model, discoveredAt: '2026-09-25T12:00:00.000Z' }], { full: true });

  const designs = await storage.readDesigns();
  const indexed = designs.find((design) => design.title === model.title);
  assert.equal(indexed.discoveredAt, initialDate);
});
