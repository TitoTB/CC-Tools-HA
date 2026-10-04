const state = {
  config: null,
  scheduler: { running: false, runningTask: '' },
  nextExecutions: {},
  runtimePaths: {},
  dailyCounters: {},
  healthMetrics: {},
  latestRuns: [],
  activeView: 'home',
  activeSettingsTab: 'session',
  designs: {
    page: 1,
    totalPages: 1,
    total: 0,
    items: [],
    query: '',
    sort: { key: 'date', direction: 'desc' },
    filters: emptyDesignFilters()
  },
  finishPrintDiscovery: {
    printers: [],
    files: []
  },
  finishPrintPrinterPicker: '',
  finishPrintDraftProfiles: [],
  finishPrintStatuses: [],
  finishPrintStatusSelections: {},
  finishPrintStatusFiles: { files: [], loading: false, error: '' },
  favoriteProfilesRefreshRunning: false,
  commentDrafts: [],
  commentEditingId: '',
  schedule: {
    items: [],
    status: 'all',
    taskId: 'all'
  },
  pointsHistory: {
    unit: 'days',
    offset: 0,
    selectedKey: ''
  },
  modelCategories: {
    available: [],
    selected: []
  },
  shopCatalog: [],
  shopRegions: [{ code: 'ES', name: 'España', area: 'Europe', imageUrl: '' }],
  shopRegionsLoaded: false,
  shopCatalogLoading: false,
  shopOrdersLoading: false,
  shopGoalInitialized: false,
  selectedShopProductId: '',
  selectedShopRegion: ''
};

let profileRefreshAttempted = false;
let setupAccountRefreshPromise = null;
let favoriteRefreshPollTimer = null;
let favoriteRefreshPollCount = 0;
const DEFAULT_FAVORITE_USER_ID = '7963944884';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const fields = {
  lastRun: $('#last-run'),
  nextRun: $('#next-run'),
  crealityEnabled: $('#creality-enabled'),
  windowStart: $('#window-start'),
  windowEnd: $('#window-end'),
  sessionTimezone: $('#session-timezone'),
  crealityDailyBadge: $('#creality-daily-badge'),
  finishPrintLastRun: $('#finish-print-last-run'),
  finishPrintNextRun: $('#finish-print-next-run'),
  finishPrintEnabled: $('#finish-print-enabled'),
  finishPrintDailyBadge: $('#finish-print-daily-badge'),
  finishPrintConfigModal: $('#finish-print-config-modal'),
  finishPrintRequirements: $('#finish-print-requirements'),
  finishPrintSetup: $('#finish-print-setup'),
  finishPrinterStatusList: $('#finish-printer-status-list'),
  printerErrorModal: $('#printer-error-modal'),
  printerErrorName: $('#printer-error-name'),
  printerErrorMessage: $('#printer-error-message'),
  printerErrorGuidance: $('#printer-error-guidance'),
  printerErrorState: $('#printer-error-state'),
  printerErrorGcode: $('#printer-error-gcode'),
  printerErrorObserved: $('#printer-error-observed'),
  printerErrorDetails: $('#printer-error-details'),
  finishPrinterSelect: $('#finish-printer-select'),
  finishFilesList: $('#finish-files-list'),
  finishPrintWindowStart: $('#finish-print-window-start'),
  finishPrintWindowEnd: $('#finish-print-window-end'),
  finishPrintDailyLimit: $('#finish-print-daily-limit'),
  finishPrintMinInterval: $('#finish-print-min-interval'),
  modelsLastRun: $('#models-last-run'),
  modelsNextRun: $('#models-next-run'),
  modelsEnabled: $('#models-enabled'),
  modelsDailyBadge: $('#models-daily-badge'),
  modelsWindowStart: $('#models-window-start'),
  modelsWindowEnd: $('#models-window-end'),
  modelsDailyLimit: $('#models-daily-limit'),
  modelsMinInterval: $('#models-min-interval'),
  modelsDownloadsPath: $('#models-downloads-path'),
  modelsCleanupHours: $('#models-cleanup-hours'),
  modelsPrioritizeFavorites: $('#models-prioritize-favorites'),
  modelsCategoryPicker: $('#models-category-picker'),
  modelsCategorySummary: $('#models-category-summary'),
  modelsCategoryOptions: $('#models-category-options'),
  commentsLastRun: $('#comments-last-run'),
  commentsNextRun: $('#comments-next-run'),
  commentsEnabled: $('#comments-enabled'),
  commentsDailyBadge: $('#comments-daily-badge'),
  commentsConfigModal: $('#comments-config-modal'),
  commentsWindowStart: $('#comments-window-start'),
  commentsWindowEnd: $('#comments-window-end'),
  commentsPrioritizeFavorites: $('#comments-prioritize-favorites'),
  commentsImageLimit: $('#comments-image-limit'),
  commentsTextLimit: $('#comments-text-limit'),
  commentsMinInterval: $('#comments-min-interval'),
  commentText: $('#comment-text'),
  commentImage: $('#comment-image'),
  commentImageName: $('#comment-image-name'),
  commentComposer: $('#comment-composer'),
  commentsList: $('#comments-list'),
  boostsLastRun: $('#boosts-last-run'),
  boostsNextRun: $('#boosts-next-run'),
  boostsEnabled: $('#boosts-enabled'),
  boostsDailyBadge: $('#boosts-daily-badge'),
  boostsConfigModal: $('#boosts-config-modal'),
  boostsWindowStart: $('#boosts-window-start'),
  boostsWindowEnd: $('#boosts-window-end'),
  boostsFavoritesOnly: $('#boosts-favorites-only'),
  likesLastRun: $('#likes-last-run'),
  likesNextRun: $('#likes-next-run'),
  likesEnabled: $('#likes-enabled'),
  likesDailyBadge: $('#likes-daily-badge'),
  likesWindowStart: $('#likes-window-start'),
  likesWindowEnd: $('#likes-window-end'),
  likesPrioritizeFavorites: $('#likes-prioritize-favorites'),
  collectionsLastRun: $('#collections-last-run'),
  collectionsNextRun: $('#collections-next-run'),
  collectionsEnabled: $('#collections-enabled'),
  collectionsDailyBadge: $('#collections-daily-badge'),
  collectionsWindowStart: $('#collections-window-start'),
  collectionsWindowEnd: $('#collections-window-end'),
  telegramEnabled: $('#telegram-enabled'),
  telegramToken: $('#telegram-token'),
  telegramChat: $('#telegram-chat'),
  notifyAllSuccess: $('#notify-all-success'),
  notifyAllError: $('#notify-all-error'),
  notifySuccess: $('#notify-success'),
  notifyError: $('#notify-error'),
  notifyDesignDownload: $('#notify-design-download'),
  notifyDesignError: $('#notify-design-error'),
  notifyModelLike: $('#notify-model-like'),
  notifyModelLikeError: $('#notify-model-like-error'),
  notifyFinishPrint: $('#notify-finish-print'),
  notifyFinishPrintError: $('#notify-finish-print-error'),
  notifyComment: $('#notify-comment'),
  notifyCommentError: $('#notify-comment-error'),
  notifyModelBoost: $('#notify-model-boost'),
  notifyModelBoostError: $('#notify-model-boost-error'),
  notifyShopRedemption: $('#notify-shop-redemption'),
  notifyShopRedemptionError: $('#notify-shop-redemption-error'),
  notifyShopOrderShipped: $('#notify-shop-order-shipped'),
  runs: $('#runs'),
  healthSummary: $('#health-summary'),
  pointsCounter: $('#points-counter'),
  pointsTotal: $('#points-total'),
  pointsToday: $('#points-today'),
  pointsHistoryModal: $('#points-history-modal'),
  pointsHistoryChart: $('#points-history-chart'),
  refreshPointsHistoryFull: $('#refresh-points-history-full'),
  pointsSummaryPeriod: $('#points-summary-period'),
  pointsTaskSummary: $('#points-task-summary'),
  pointsGoalProgress: $('#points-goal-progress'),
  pointsShopProduct: $('#points-shop-product'),
  pointsShopRegionPicker: $('#points-shop-region-picker'),
  pointsShopRegionTrigger: $('#points-shop-region-trigger'),
  pointsShopRegionValue: $('#points-shop-region-value'),
  pointsShopRegionMenu: $('#points-shop-region-menu'),
  pointsShopProductPreview: $('#points-shop-product-preview'),
  pointsShopGoalStatus: $('#points-shop-goal-status'),
  pointsShopOrdersList: $('#points-shop-orders-list'),
  programPointsShopGoal: $('#program-points-shop-goal'),
  favoriteProfileUrl: $('#favorite-profile-url'),
  favoriteProfilesList: $('#favorite-profiles-list'),
  designsTableBody: $('#designs-table-body'),
  designsPage: $('#designs-page'),
  designsSearch: $('#designs-search'),
  designsFilterPanel: $('#designs-filter-panel'),
  designsFilterFrom: $('#designs-filter-from'),
  designsFilterTo: $('#designs-filter-to'),
  designsFilterLike: $('#designs-filter-like'),
  designsFilterCollection: $('#designs-filter-collection'),
  designsFilterComment: $('#designs-filter-comment'),
  designsFilterFavoriteAuthor: $('#designs-filter-favorite-author'),
  toolConfigModal: $('#tool-config-modal'),
  modelsConfigModal: $('#models-config-modal'),
  scheduleModal: $('#schedule-modal'),
  scheduleStatusFilter: $('#schedule-status-filter'),
  scheduleTaskFilter: $('#schedule-task-filter'),
  scheduleList: $('#schedule-list'),
  likesConfigModal: $('#likes-config-modal'),
  collectionsConfigModal: $('#collections-config-modal'),
  runProgressModal: $('#run-progress-modal'),
  wizardModal: $('#wizard-modal')
};

fields.crealityUserAvatar = $('#creality-user-avatar');
fields.crealityUserAvatarImage = $('#creality-user-avatar-image');
fields.crealityUserAvatarFallback = $('#creality-user-avatar-fallback');
fields.crealityUserMenu = $('#creality-user-menu');
fields.crealityProfileLink = $('#creality-profile-link');
fields.crealityUserAvatarImage.addEventListener('error', () => {
  fields.crealityUserAvatarImage.hidden = true;
  fields.crealityUserAvatarFallback.hidden = false;
});

fields.crealityUserAvatar.addEventListener('click', (event) => {
  event.stopPropagation();
  setCrealityUserMenu(fields.crealityUserMenu.hidden);
});

fields.crealityUserMenu.addEventListener('click', (event) => {
  if (event.target.closest('[role="menuitem"]')) setCrealityUserMenu(false);
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.creality-user-menu-wrap')) setCrealityUserMenu(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || fields.crealityUserMenu.hidden) return;
  setCrealityUserMenu(false);
  fields.crealityUserAvatar.focus();
});

await refresh();
setInterval(() => {
  refreshLiveCounters().catch(() => {});
}, 60 * 1000);

setInterval(() => {
  if (state.activeView === 'logs') refreshLiveCounters().catch(() => {});
}, 10 * 1000);

$('#brand-home').addEventListener('click', (event) => {
  event.preventDefault();
  showView('home');
});

$('#nav-home').addEventListener('click', () => showView('home'));
$('#nav-designs').addEventListener('click', async () => {
  showView('designs');
  await loadDesigns(1);
});
$('#nav-schedule').addEventListener('click', showSchedulePreview);
$('#creality-menu-settings').addEventListener('click', () => showView('settings'));
$('#creality-menu-logs').addEventListener('click', () => showView('logs'));
fields.pointsCounter.addEventListener('click', () => openPointsHistory());
$('#close-points-history').addEventListener('click', closePointsHistory);
for (const button of $$('.points-unit-button')) {
  button.addEventListener('click', () => {
    state.pointsHistory.unit = button.dataset.pointsUnit || 'days';
    state.pointsHistory.offset = 0;
    state.pointsHistory.selectedKey = '';
    renderPointsHistory(state.config?.points || {});
  });
}
$('#points-history-prev').addEventListener('click', () => {
  state.pointsHistory.offset -= 1;
  state.pointsHistory.selectedKey = '';
  renderPointsHistory(state.config?.points || {});
});
$('#points-history-next').addEventListener('click', () => {
  if (state.pointsHistory.offset >= 0) return;
  state.pointsHistory.offset += 1;
  state.pointsHistory.selectedKey = '';
  renderPointsHistory(state.config?.points || {});
});
fields.pointsHistoryChart.addEventListener('click', (event) => {
  const bar = event.target.closest('[data-period-key]');
  if (!bar) return;
  state.pointsHistory.selectedKey = bar.dataset.periodKey;
  renderPointsHistory(state.config?.points || {});
});
fields.pointsHistoryChart.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const bar = event.target.closest('[data-period-key]');
  if (!bar) return;
  event.preventDefault();
  state.pointsHistory.selectedKey = bar.dataset.periodKey;
  renderPointsHistory(state.config?.points || {});
});
fields.pointsHistoryModal.addEventListener('click', (event) => {
  if (event.target === fields.pointsHistoryModal) closePointsHistory();
});
fields.refreshPointsHistoryFull.addEventListener('click', async () => {
  fields.refreshPointsHistoryFull.disabled = true;
  try {
    await refreshPointsHistory(true, true);
  } finally {
    fields.refreshPointsHistoryFull.disabled = false;
  }
});
fields.pointsShopProduct.addEventListener('pointerdown', () => {
  loadShopCatalog().catch(() => {});
});
fields.pointsShopProduct.addEventListener('change', () => {
  state.selectedShopProductId = fields.pointsShopProduct.value;
  renderShopGoal(state.config?.shopGoal || {});
});
fields.pointsShopRegionTrigger.addEventListener('click', async (event) => {
  event.stopPropagation();
  if (!state.shopRegionsLoaded) {
    const loaded = await loadShopCatalog();
    if (!loaded) return;
  }
  setShopRegionMenu(fields.pointsShopRegionMenu.hidden);
});
fields.pointsShopRegionMenu.addEventListener('click', async (event) => {
  const option = event.target.closest('[data-shop-region]');
  if (!option) return;
  const previousRegion = state.selectedShopRegion;
  const preferredProduct = state.shopCatalog.find((item) => item.id === state.selectedShopProductId) || null;
  state.selectedShopRegion = option.dataset.shopRegion || '';
  setShopRegionMenu(false);
  renderShopGoal(state.config?.shopGoal || {});
  const loaded = await loadShopCatalog({ force: true, preferredProduct });
  if (!loaded) {
    state.selectedShopRegion = previousRegion;
    renderShopGoal(state.config?.shopGoal || {});
  }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.points-shop-region-picker')) setShopRegionMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || fields.pointsShopRegionMenu.hidden) return;
  setShopRegionMenu(false);
  fields.pointsShopRegionTrigger.focus();
});
fields.programPointsShopGoal.addEventListener('click', async () => {
  const product = state.shopCatalog.find((item) => item.id === state.selectedShopProductId);
  if (!product) return toast('Selecciona primero tu objetivo.');
  if (!state.selectedShopRegion) return toast('Selecciona primero tu región.');
  const region = state.shopRegions.find((item) => item.code === state.selectedShopRegion);
  fields.programPointsShopGoal.disabled = true;
  const result = await api('/api/shop/goal', {
    method: 'PUT',
    body: { product: { ...product, region: state.selectedShopRegion, regionName: region?.name || state.selectedShopRegion } }
  });
  if (!result.ok) {
    fields.programPointsShopGoal.disabled = false;
    return toast(errorMessage(result.error, result));
  }
  state.config.shopGoal = result.goal;
  renderShopGoal(result.goal);
  renderPointsCounter(state.config.points || {});
  toast('Canje automático programado.');
});
fields.pointsShopProductPreview.addEventListener('click', async (event) => {
  const cancelButton = event.target.closest('[data-cancel-shop-goal]');
  if (!cancelButton) return;
  cancelButton.disabled = true;
  const result = await api('/api/shop/goal', { method: 'DELETE' });
  if (!result.ok) {
    cancelButton.disabled = false;
    return toast(errorMessage(result.error, result));
  }
  state.config.shopGoal = result.goal;
  renderShopGoal(result.goal);
  renderPointsCounter(state.config.points || {});
  toast('Programación del canje eliminada.');
});
fields.pointsShopOrdersList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-archive-shop-order]');
  if (!button) return;
  button.disabled = true;
  const result = await api(`/api/shop/orders/${encodeURIComponent(button.dataset.archiveShopOrder)}/archive`, {
    method: 'PATCH'
  });
  if (!result.ok) {
    button.disabled = false;
    return toast(errorMessage(result.error, result));
  }
  state.config.shopOrders = result.orders;
  renderShopOrders(result.orders);
  toast('Pedido archivado.');
});

async function openPointsHistory() {
  fields.pointsHistoryModal.hidden = false;
  renderPointsHistory(state.config?.points || {});
  renderShopGoal(state.config?.shopGoal || {});
  renderShopOrders(state.config?.shopOrders || {});
  refreshShopOrders().catch(() => {});
}

async function refreshShopOrders() {
  if (state.shopOrdersLoading) return;
  state.shopOrdersLoading = true;
  try {
    const result = await api('/api/shop/orders/refresh', { method: 'POST' });
    if (result.orders) {
      state.config.shopOrders = result.orders;
      renderShopOrders(result.orders);
    }
  } finally {
    state.shopOrdersLoading = false;
  }
}

async function loadShopCatalog({ force = false, preferredProduct = null } = {}) {
  if (state.shopCatalogLoading) {
    while (state.shopCatalogLoading && !fields.pointsHistoryModal.hidden) await pause(100);
    if (!force || fields.pointsHistoryModal.hidden) return state.shopRegionsLoaded;
    return loadShopCatalog({ force, preferredProduct });
  }
  if (!force && state.shopCatalog.length && state.shopRegionsLoaded) return true;
  state.shopCatalogLoading = true;
  fields.pointsShopProduct.disabled = true;
  const keepVisibleProduct = preferredProduct
    || state.shopCatalog.find((item) => item.id === state.selectedShopProductId)
    || null;
  if (!keepVisibleProduct) fields.pointsShopProduct.innerHTML = '<option value="">Consultando la tienda...</option>';
  try {
    const catalogUrl = `/api/shop/catalog?region=${encodeURIComponent(state.selectedShopRegion || 'ES')}`;
    const browserWaitDeadline = Date.now() + 2 * 60 * 1000;
    let result;
    while (!fields.pointsHistoryModal.hidden) {
      result = await api(catalogUrl);
      if (result.error !== 'BROWSER_BUSY') break;
      if (!keepVisibleProduct) fields.pointsShopProduct.innerHTML = '<option value="">Esperando al navegador...</option>';
      if (Date.now() >= browserWaitDeadline) {
        renderShopGoal(state.config?.shopGoal || {});
        toast('El navegador sigue ocupado. Vuelve a abrir el selector cuando termine la ejecución en curso.');
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (!result || (fields.pointsHistoryModal.hidden && result.error === 'BROWSER_BUSY')) return false;
    if (!result.ok) {
      renderShopGoal(state.config?.shopGoal || {});
      toast(result.message || errorMessage(result.error, result));
      return false;
    }
    const nextCatalog = Array.isArray(result.products) ? result.products : [];
    const equivalentProduct = keepVisibleProduct
      ? findEquivalentShopProduct(nextCatalog, keepVisibleProduct)
      : null;
    state.shopCatalog = nextCatalog;
    if (keepVisibleProduct) state.selectedShopProductId = equivalentProduct?.id || '';
    if (Array.isArray(result.regions) && result.regions.length) {
      state.shopRegions = result.regions;
      state.shopRegionsLoaded = true;
    }
    const storedId = state.config?.shopGoal?.productId || '';
    if (!keepVisibleProduct && !state.selectedShopProductId && storedId) state.selectedShopProductId = storedId;
    renderShopGoal(state.config?.shopGoal || {});
    toast(keepVisibleProduct && !equivalentProduct
      ? 'El objetivo seleccionado no está disponible en esta región.'
      : `${state.shopCatalog.length} objetivos disponibles.`);
    return true;
  } catch (error) {
    renderShopGoal(state.config?.shopGoal || {});
    toast(error?.message || 'No se pudo consultar la tienda de Creality Cloud.');
    return false;
  } finally {
    state.shopCatalogLoading = false;
    fields.pointsShopProduct.disabled = false;
  }
}

function findEquivalentShopProduct(products, target) {
  if (!target) return null;
  return products.find((product) => product.id === target.id)
    || products.find((product) => product.name.localeCompare(target.name, 'es', { sensitivity: 'base' }) === 0
      && Number(product.points) === Number(target.points))
    || products.find((product) => product.name.localeCompare(target.name, 'es', { sensitivity: 'base' }) === 0)
    || null;
}

function closePointsHistory() {
  fields.pointsHistoryModal.hidden = true;
}

async function refreshPointsHistory(showToast = false, fullHistory = false) {
  fields.pointsCounter.disabled = true;
  const result = await api('/api/points/refresh', {
    method: 'POST',
    body: fullHistory ? { fullHistory: true } : undefined
  });
  fields.pointsCounter.disabled = false;
  if (result.points) {
    state.config.points = result.points;
    renderPointsCounter(result.points);
    renderPointsHistory(result.points);
  }
  if (showToast) toast(result.ok ? 'Historial de puntos actualizado.' : `No se pudo actualizar el historial: ${errorMessage(result.error, result)}`);
}

fields.healthSummary.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="resume-automations"]');
  if (!button) return;
  button.disabled = true;
  const result = await api('/api/automation/resume', { method: 'POST' });
  if (!result.ok) {
    button.disabled = false;
    toast(errorMessage(result.error, result));
    return;
  }
  toast(result.message || 'Automatizaciones reactivadas.');
  await refresh();
});

for (const button of $$('.tab-button')) {
  button.addEventListener('click', () => showSettingsTab(button.dataset.tab));
}

$('#add-favorite-profile').addEventListener('click', addFavoriteProfile);
$('#refresh-favorite-profiles').addEventListener('click', refreshFavoriteProfiles);
fields.favoriteProfileUrl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  addFavoriteProfile();
});
fields.favoriteProfilesList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-remove-favorite]');
  if (!button) return;
  if (button.dataset.removeFavorite === DEFAULT_FAVORITE_USER_ID) return;
  button.disabled = true;
  const result = await api(`/api/creality/favorites/${encodeURIComponent(button.dataset.removeFavorite)}`, {
    method: 'DELETE'
  });
  if (!result.ok) {
    button.disabled = false;
    toast(errorMessage(result.error, result));
    return;
  }
  state.config.crealityFavorites = result.favorites;
  renderFavoriteProfiles(result.favorites);
  toast('Perfil eliminado de favoritos.');
});

fields.crealityEnabled.addEventListener('change', async () => {
  if (await saveConfig({ includeCreality: true })) {
    toast(fields.crealityEnabled.checked ? 'Check-in diario activado.' : 'Check-in diario desactivado.');
  }
});

fields.finishPrintEnabled.addEventListener('change', async () => {
  if (await saveConfig({ includeFinishPrint: true })) {
    toast(fields.finishPrintEnabled.checked ? 'Envío de impresiones activado.' : 'Envío de impresiones desactivado.');
  }
});

fields.modelsEnabled.addEventListener('change', async () => {
  if (!fields.modelsEnabled.checked) {
    fields.likesEnabled.checked = false;
    fields.collectionsEnabled.checked = false;
  }
  if (await saveConfig({ includeModels: true })) {
    toast(fields.modelsEnabled.checked ? 'Descarga de diseños activada.' : 'Descarga de diseños desactivada.');
  }
});

fields.likesEnabled.addEventListener('change', async () => {
  if (fields.likesEnabled.checked && !fields.modelsEnabled.checked) {
    fields.likesEnabled.checked = false;
    toast('Activa primero la descarga de diseños.');
    return;
  }
  if (await saveConfig({ includeLikes: true })) {
    toast(fields.likesEnabled.checked ? 'Me gusta activado.' : 'Me gusta desactivado.');
  }
});

fields.collectionsEnabled.addEventListener('change', async () => {
  if (fields.collectionsEnabled.checked && !fields.modelsEnabled.checked) {
    fields.collectionsEnabled.checked = false;
    toast('Activa primero la descarga de diseños.');
    return;
  }
  if (await saveConfig({ includeCollections: true })) {
    toast(fields.collectionsEnabled.checked ? 'Colección activada.' : 'Colección desactivada.');
  }
});

$('#open-tool-config').addEventListener('click', () => {
  fields.toolConfigModal.hidden = false;
});

$('#close-tool-config').addEventListener('click', () => {
  fields.toolConfigModal.hidden = true;
});

fields.toolConfigModal.addEventListener('click', (event) => {
  if (event.target === fields.toolConfigModal) fields.toolConfigModal.hidden = true;
});

$('#open-finish-print-config').addEventListener('click', async () => {
  collapseFinishPrintSections();
  fields.finishPrintConfigModal.hidden = false;
  try {
    await refresh();
    state.finishPrintDraftProfiles = finishPrintProfilesFromConfig();
    renderFinishPrinterProfiles();
    loadFinishPrinterStatuses();
  } catch (error) {
    toast(`No se pudo preparar la configuración: ${error.message}`);
  }
});

fields.commentsEnabled.addEventListener('change', async () => {
  if (await saveConfig({ includeComments: true })) {
    toast(fields.commentsEnabled.checked ? 'Comentarios activados.' : 'Comentarios desactivados.');
  }
});

fields.boostsEnabled.addEventListener('change', async () => {
  if (await saveConfig({ includeModelBoosts: true })) {
    toast(fields.boostsEnabled.checked ? 'Impulsar diseños activado.' : 'Impulsar diseños desactivado.');
  }
});

$('#close-finish-print-config').addEventListener('click', () => {
  closeFinishPrintConfig();
});

fields.finishPrintConfigModal.addEventListener('click', (event) => {
  if (event.target === fields.finishPrintConfigModal) closeFinishPrintConfig();
});

function closeFinishPrintConfig() {
  closePrinterErrorModal();
  fields.finishPrintConfigModal.hidden = true;
  collapseFinishPrintSections();
}

function collapseFinishPrintSections() {
  fields.finishPrintRequirements.hidden = true;
  fields.finishPrintSetup.hidden = true;
  $('#toggle-finish-print-requirements').setAttribute('aria-expanded', 'false');
  $('#toggle-finish-print-setup').setAttribute('aria-expanded', 'false');
}

$('#toggle-finish-print-requirements').addEventListener('click', () => {
  fields.finishPrintRequirements.hidden = !fields.finishPrintRequirements.hidden;
  $('#toggle-finish-print-requirements').setAttribute('aria-expanded', String(!fields.finishPrintRequirements.hidden));
});

$('#toggle-finish-print-setup').addEventListener('click', () => {
  fields.finishPrintSetup.hidden = !fields.finishPrintSetup.hidden;
  $('#toggle-finish-print-setup').setAttribute('aria-expanded', String(!fields.finishPrintSetup.hidden));
});

fields.finishPrintSetup.addEventListener('click', handleFinishPrintProfileAction);
fields.finishPrintSetup.addEventListener('change', handleFinishPrintProfileChange);
fields.finishPrinterStatusList.addEventListener('click', handleFinishPrinterStatusAction);
fields.finishPrinterStatusList.addEventListener('change', handleFinishPrinterStatusChange);
$('#refresh-finish-printer-status').addEventListener('click', () => loadFinishPrinterStatuses({ notify: true }));
$('#close-printer-error').addEventListener('click', closePrinterErrorModal);
fields.printerErrorModal.addEventListener('click', (event) => {
  if (event.target === fields.printerErrorModal) closePrinterErrorModal();
});
$('#open-models-config').addEventListener('click', async () => {
  fields.modelsConfigModal.hidden = false;
  await loadModelCategories();
});

$('#close-models-config').addEventListener('click', () => {
  fields.modelsConfigModal.hidden = true;
});

for (const link of $$('.favorite-settings-link')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    link.closest('.modal').hidden = true;
    showView('settings');
    showSettingsTab('favorites');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

fields.modelsConfigModal.addEventListener('click', (event) => {
  if (event.target === fields.modelsConfigModal) fields.modelsConfigModal.hidden = true;
});

fields.modelsCategoryOptions.addEventListener('change', () => {
  state.modelCategories.selected = Array.from(
    fields.modelsCategoryOptions.querySelectorAll('input[type="checkbox"]:checked'),
    (input) => input.value
  );
  renderModelCategorySummary();
});

$('#open-likes-config').addEventListener('click', () => {
  fields.likesConfigModal.hidden = false;
});

$('#close-likes-config').addEventListener('click', () => {
  fields.likesConfigModal.hidden = true;
});

fields.likesConfigModal.addEventListener('click', (event) => {
  if (event.target === fields.likesConfigModal) fields.likesConfigModal.hidden = true;
});

$('#open-collections-config').addEventListener('click', () => {
  fields.collectionsConfigModal.hidden = false;
});

$('#close-collections-config').addEventListener('click', () => {
  fields.collectionsConfigModal.hidden = true;
});

fields.collectionsConfigModal.addEventListener('click', (event) => {
  if (event.target === fields.collectionsConfigModal) fields.collectionsConfigModal.hidden = true;
});

$('#save-config').addEventListener('click', async () => {
  if (await programTool(fields.crealityEnabled, () => saveConfig({ includeCreality: true }))) {
    toast('Configuración guardada.');
  }
});

$('#save-models-config').addEventListener('click', async () => {
  if (await programTool(fields.modelsEnabled, () => saveConfig({ includeModels: true }))) {
    toast('Configuración guardada.');
  }
});

$('#save-likes-config').addEventListener('click', async () => {
  if (await programTool(fields.likesEnabled, () => saveConfig({ includeLikes: true }))) {
    toast('Configuración guardada.');
  }
});

$('#save-collections-config').addEventListener('click', async () => {
  if (await saveConfig({ includeCollections: true })) toast('Configuración guardada.');
});

$('#save-telegram').addEventListener('click', async () => {
  if (await saveConfig({ includeTelegram: true })) toast('Ajustes de notificaciones guardados.');
});

$('#test-telegram').addEventListener('click', async () => {
  const result = await api('/api/telegram/test', { method: 'POST' });
  toast(result.ok ? 'Mensaje enviado.' : result.error);
});

fields.notifyAllSuccess.addEventListener('change', () => {
  setNotificationGroup(notificationSuccessFields(), fields.notifyAllSuccess.checked);
  syncNotificationMasters();
});

fields.notifyAllError.addEventListener('change', () => {
  setNotificationGroup(notificationErrorFields(), fields.notifyAllError.checked);
  syncNotificationMasters();
});

for (const field of [...notificationSuccessFields(), ...notificationErrorFields()]) {
  field.addEventListener('change', syncNotificationMasters);
}

$('#run-now').addEventListener('click', runCheckinWithProgress);
$('#run-models-now').addEventListener('click', runModelsWithProgress);
$('#run-likes-now').addEventListener('click', runLikesWithProgress);
$('#run-collections-now').addEventListener('click', runCollectionsWithProgress);

$('#close-run-progress').addEventListener('click', () => {
  fields.runProgressModal.hidden = true;
});

$('#close-schedule').addEventListener('click', () => {
  fields.scheduleModal.hidden = true;
});

fields.scheduleModal.addEventListener('click', (event) => {
  if (event.target === fields.scheduleModal) fields.scheduleModal.hidden = true;
});

fields.scheduleStatusFilter.addEventListener('change', () => {
  state.schedule.status = fields.scheduleStatusFilter.value;
  renderScheduleItems();
});

fields.scheduleTaskFilter.addEventListener('change', () => {
  state.schedule.taskId = fields.scheduleTaskFilter.value;
  renderScheduleItems();
});

$('#designs-prev').addEventListener('click', async () => {
  await loadDesigns(Math.max(1, state.designs.page - 1));
});

$('#designs-next').addEventListener('click', async () => {
  await loadDesigns(Math.min(state.designs.totalPages, state.designs.page + 1));
});

$('#open-comments-config').addEventListener('click', () => {
  state.commentDrafts = structuredClone(state.config.tasks.comments.comments || []);
  renderCommentDrafts();
  collapseCommentComposer();
  fields.commentsConfigModal.hidden = false;
});

$('#close-comments-config').addEventListener('click', () => {
  closeCommentsConfig();
});

fields.commentsConfigModal.addEventListener('click', (event) => {
  if (event.target === fields.commentsConfigModal) closeCommentsConfig();
});

$('#toggle-comment-composer').addEventListener('click', () => {
  if (fields.commentComposer.hidden) openCommentComposer();
  else collapseCommentComposer();
});

function closeCommentsConfig() {
  fields.commentsConfigModal.hidden = true;
  collapseCommentComposer();
}

function collapseCommentComposer() {
  fields.commentComposer.hidden = true;
  state.commentEditingId = '';
  fields.commentText.value = '';
  fields.commentImage.value = '';
  updateCommentImageName();
  $('#comment-composer-title').textContent = 'Añadir comentario';
  $('#add-comment').textContent = 'Añadir';
  $('#toggle-comment-composer').setAttribute('aria-expanded', 'false');
}

function openCommentComposer(comment = null) {
  state.commentEditingId = comment?.id || '';
  fields.commentText.value = comment?.text || '';
  fields.commentImage.value = '';
  updateCommentImageName(comment?.image?.name || '');
  $('#comment-composer-title').textContent = comment ? 'Editar comentario' : 'Añadir comentario';
  $('#add-comment').textContent = comment ? 'Guardar cambios' : 'Añadir';
  fields.commentComposer.hidden = false;
  $('#toggle-comment-composer').setAttribute('aria-expanded', 'true');
  fields.commentText.focus();
}

$('#add-comment').addEventListener('click', addCommentDraft);
fields.commentImage.addEventListener('change', () => {
  const existing = state.commentDrafts.find((comment) => comment.id === state.commentEditingId);
  updateCommentImageName(existing?.image?.name || '');
});
$('#save-comments-config').addEventListener('click', async () => {
  if (fields.commentText.value.trim() && !(await addCommentDraft())) return;
  if (await programTool(fields.commentsEnabled, () => saveConfig({ includeComments: true }))) {
    toast('Configuración guardada.');
  }
});
$('#run-comments-now').addEventListener('click', runCommentsWithProgress);

$('#open-boosts-config').addEventListener('click', () => {
  fields.boostsConfigModal.hidden = false;
});

$('#close-boosts-config').addEventListener('click', () => {
  fields.boostsConfigModal.hidden = true;
});

fields.boostsConfigModal.addEventListener('click', (event) => {
  if (event.target === fields.boostsConfigModal) fields.boostsConfigModal.hidden = true;
});

$('#save-boosts-config').addEventListener('click', async () => {
  if (await programTool(fields.boostsEnabled, () => saveConfig({ includeModelBoosts: true }))) {
    toast('Configuración guardada.');
  }
});

$('#run-boosts-now').addEventListener('click', runBoostsWithProgress);

fields.commentsList.addEventListener('change', (event) => {
  const toggle = event.target.closest('[data-comment-toggle]');
  if (!toggle) return;
  const entry = state.commentDrafts.find((comment) => comment.id === toggle.dataset.commentToggle);
  if (entry) entry.enabled = toggle.checked;
});

fields.commentsList.addEventListener('click', (event) => {
  const editButton = event.target.closest('[data-comment-edit]');
  if (editButton) {
    const comment = state.commentDrafts.find((entry) => entry.id === editButton.dataset.commentEdit);
    if (comment) openCommentComposer(comment);
    return;
  }

  const deleteButton = event.target.closest('[data-comment-delete]');
  if (!deleteButton) return;
  state.commentDrafts = state.commentDrafts.filter((comment) => comment.id !== deleteButton.dataset.commentDelete);
  if (state.commentEditingId === deleteButton.dataset.commentDelete) collapseCommentComposer();
  renderCommentDrafts();
});

let designsSearchTimer = null;
let designsRequestSequence = 0;
fields.designsSearch.addEventListener('input', () => {
  clearTimeout(designsSearchTimer);
  state.designs.query = fields.designsSearch.value.trim();
  designsSearchTimer = setTimeout(() => loadDesigns(1), 180);
});

$('#toggle-design-filters').addEventListener('click', () => {
  const expanded = fields.designsFilterPanel.hidden;
  fields.designsFilterPanel.hidden = !expanded;
  $('#toggle-design-filters').setAttribute('aria-expanded', String(expanded));
});

$('#apply-design-filters').addEventListener('click', async () => {
  state.designs.filters = readDesignFilters();
  updateDesignFilterButton();
  await loadDesigns(1);
});

$('#clear-design-filters').addEventListener('click', async () => {
  setDesignFilterFields(emptyDesignFilters());
  state.designs.filters = emptyDesignFilters();
  updateDesignFilterButton();
  await loadDesigns(1);
});

fields.designsTableBody.addEventListener('click', async (event) => {
  const actionButton = event.target.closest('[data-design-action]');
  if (actionButton) {
    const design = state.designs.items.find((item) => item.id === actionButton.dataset.designId);
    const action = actionButton.dataset.designAction;
    if (!design || !['like', 'collection'].includes(action)) return;

    const completedField = action === 'like' ? 'likeCompleted' : 'collectionCompleted';
    actionButton.disabled = true;
    const result = await api(
      `/api/designs/${encodeURIComponent(design.id)}/actions/${action}`,
      { method: 'PATCH', body: { completed: !design[completedField] } }
    );
    if (!result.ok) {
      actionButton.disabled = false;
      toast(errorMessage(result.error, result));
      return;
    }

    await loadDesigns(1);
    toast(result.design[completedField] ? 'Tarea marcada como completada.' : 'Tarea marcada como pendiente.');
  }
});

$('.designs-table thead').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-design-sort]');
  if (!button) return;
  const key = button.dataset.designSort;
  state.designs.sort = state.designs.sort.key === key
    ? { key, direction: state.designs.sort.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: 'asc' };
  await loadDesigns(1);
});

$('#wizard-open-login').addEventListener('click', async () => {
  await openCrealityViewer();
});

$('#wizard-next').addEventListener('click', advanceWizard);
$('#skip-wizard').addEventListener('click', async (event) => {
  event.preventDefault();
  await completeWizard();
});

$('#wizard-test-telegram').addEventListener('click', async () => {
  const saved = await saveWizardTelegram({ requireCredentials: true });
  if (!saved) return;
  const result = await api('/api/telegram/test', { method: 'POST' });
  toast(result.ok ? 'Mensaje enviado.' : result.error);
});

$('#open-login').addEventListener('click', async () => {
  await openCrealityViewer();
});

$('#close-login').addEventListener('click', async () => {
  const result = await api('/api/tasks/creality/login/close', { method: 'POST' });
  toast(result.ok ? result.result.message : result.error);
  if (result.ok) {
    profileRefreshAttempted = false;
    await refreshCrealityProfile();
  }
});

$('#save-session').addEventListener('click', async () => {
  if (await saveConfig({ includeSession: true })) toast('Ajustes de sesión guardados.');
});

async function programTool(toggle, save) {
  const previous = toggle.checked;
  toggle.checked = true;
  let saved = false;
  try {
    saved = await save();
    return saved;
  } finally {
    if (!saved) toggle.checked = previous;
  }
}

async function saveConfig(options = {}) {
  const body = {};

  if (options.includeSession) {
    body.session = {
      timezone: fields.sessionTimezone.value
    };
  }

  if (options.includeCreality) {
    if (fields.crealityEnabled.checked && fields.windowStart.value === fields.windowEnd.value) {
      toast(errorMessage('WINDOW_START_EQUALS_END'));
      return false;
    }
    body.creality = {
      enabled: fields.crealityEnabled.checked,
      windowStart: fields.windowStart.value,
      windowEnd: fields.windowEnd.value
    };
  }

  if (options.includeFinishPrint) {
    body.finishPrint = {
      enabled: fields.finishPrintEnabled.checked,
      printerProfiles: finishPrintProfilesFromConfig()
    };
  }

  if (options.includeModels) {
    const requiredMinutes = requiredModelWindowMinutes();
    if (modelWindowDurationMinutes() < requiredMinutes) {
      fields.modelsWindowEnd.value = addMinutesToClock(fields.modelsWindowStart.value, requiredMinutes);
      toast(`Necesitas al menos ${requiredMinutes} minutos de ventana. He ajustado la hora de fin.`);
    }

    body.modelDownloads = {
      enabled: fields.modelsEnabled.checked,
      windowStart: fields.modelsWindowStart.value,
      windowEnd: fields.modelsWindowEnd.value,
      dailyLimit: Number(fields.modelsDailyLimit.value),
      minIntervalMinutes: Number(fields.modelsMinInterval.value),
      cleanupAfterHours: Number(fields.modelsCleanupHours.value),
      prioritizeFavorites: fields.modelsPrioritizeFavorites.checked,
      catalogCategories: state.modelCategories.selected
    };
  }

  if (options.includeComments) {
    const imageDailyLimit = Math.min(5, Math.max(0, Number(fields.commentsImageLimit.value) || 0));
    const textDailyLimit = Math.min(1, Math.max(0, Number(fields.commentsTextLimit.value) || 0));
    const minIntervalMinutes = Math.max(10, Number(fields.commentsMinInterval.value) || 10);
    const requiredMinutes = (imageDailyLimit + textDailyLimit) * (minIntervalMinutes + 2);
    if (windowDurationMinutes(fields.commentsWindowStart.value, fields.commentsWindowEnd.value) < requiredMinutes) {
      fields.commentsWindowEnd.value = addMinutesToClock(fields.commentsWindowStart.value, requiredMinutes);
      toast(`Necesitas al menos ${requiredMinutes} minutos de ventana. He ajustado la hora de fin.`);
    }
    body.comments = {
      enabled: fields.commentsEnabled.checked,
      windowStart: fields.commentsWindowStart.value,
      windowEnd: fields.commentsWindowEnd.value,
      prioritizeFavorites: fields.commentsPrioritizeFavorites.checked,
      imageDailyLimit,
      textDailyLimit,
      minIntervalMinutes,
      comments: state.commentDrafts
    };
  }

  if (options.includeModelBoosts) {
    body.modelBoosts = {
      enabled: fields.boostsEnabled.checked,
      windowStart: fields.boostsWindowStart.value,
      windowEnd: fields.boostsWindowEnd.value,
      favoriteOnly: fields.boostsFavoritesOnly.checked
    };
  }

  if (options.includeLikes) {
    if (fields.likesEnabled.checked && !fields.modelsEnabled.checked) {
      fields.likesEnabled.checked = false;
      toast('Activa primero la descarga de diseños.');
      render();
      return false;
    }
    body.modelLikes = {
      enabled: fields.likesEnabled.checked,
      windowStart: fields.likesWindowStart.value,
      windowEnd: fields.likesWindowEnd.value,
      prioritizeFavorites: fields.likesPrioritizeFavorites.checked
    };
  }

  if (options.includeCollections) {
    if (fields.collectionsEnabled.checked && !fields.modelsEnabled.checked) {
      fields.collectionsEnabled.checked = false;
      toast('Activa primero la descarga de diseños.');
      render();
      return false;
    }
    body.modelCollections = {
      enabled: fields.collectionsEnabled.checked,
      windowStart: fields.collectionsWindowStart.value,
      windowEnd: fields.collectionsWindowEnd.value
    };
  }

  if (options.includeTelegram) {
    body.telegram = {
      enabled: fields.telegramEnabled.checked,
      botToken: fields.telegramToken.value,
      chatId: fields.telegramChat.value,
      notifyOnSuccess: fields.notifySuccess.checked,
      notifyOnError: fields.notifyError.checked,
      notifyOnDesignDownload: fields.notifyDesignDownload.checked,
      notifyOnDesignError: fields.notifyDesignError.checked,
      notifyOnModelLike: fields.notifyModelLike.checked,
      notifyOnModelLikeError: fields.notifyModelLikeError.checked,
      notifyOnFinishPrint: fields.notifyFinishPrint.checked,
      notifyOnFinishPrintError: fields.notifyFinishPrintError.checked,
      notifyOnComment: fields.notifyComment.checked,
      notifyOnCommentError: fields.notifyCommentError.checked,
      notifyOnModelBoost: fields.notifyModelBoost.checked,
      notifyOnModelBoostError: fields.notifyModelBoostError.checked,
      notifyOnShopRedemption: fields.notifyShopRedemption.checked,
      notifyOnShopRedemptionError: fields.notifyShopRedemptionError.checked,
      notifyOnShopOrderShipped: fields.notifyShopOrderShipped.checked
    };
  }

  const result = await api('/api/config', { method: 'PATCH', body });
  if (!result.ok) {
    toast(errorMessage(result.error, result));
    render();
    return false;
  }
  state.config = result.config;
  state.nextExecutions = result.nextExecutions || {};
  render();
  maybeShowWizard();
  return true;
}

async function refresh() {
  const result = await api('/api/status');
  if (!result.ok) throw new Error(errorMessage(result.error, result));
  state.config = result.config;
  state.scheduler = result.scheduler || { running: false, runningTask: '' };
  state.nextExecutions = result.nextExecutions || {};
  state.runtimePaths = result.runtimePaths || {};
  state.favoriteProfilesRefreshRunning = result.favoriteProfilesRefreshRunning === true;
  state.commentDrafts = structuredClone(result.config.tasks.comments?.comments || []);
  state.dailyCounters = result.dailyCounters || {};
  state.healthMetrics = result.healthMetrics || {};
  state.latestRuns = result.latestRuns || [];
  render();
  setFavoriteRefreshButtonLoading(state.favoriteProfilesRefreshRunning);
  if (state.favoriteProfilesRefreshRunning && !favoriteRefreshPollTimer) startFavoriteRefreshPolling();
  maybeShowWizard();
  refreshCrealityProfile(result.browser).catch(() => {});
}

async function refreshCrealityProfile(browser = { mode: 'idle' }, { force = false } = {}) {
  if (!force && !state.config?.setup?.assistantCompleted) return;

  const profile = state.config?.crealityProfile || {};
  const updatedAt = Date.parse(profile.updatedAt || '');
  const stale = !Number.isFinite(updatedAt) || Date.now() - updatedAt >= 24 * 60 * 60 * 1000;
  if (profileRefreshAttempted || (!force && !stale) || browser?.mode !== 'idle') return;

  profileRefreshAttempted = true;
  const result = await api('/api/creality/profile/refresh', { method: 'POST' });
  if (!result.ok || !result.profile) {
    profileRefreshAttempted = false;
    return;
  }
  state.config.crealityProfile = result.profile;
  renderCrealityProfile(result.profile);
}

function refreshSetupAccountData() {
  if (setupAccountRefreshPromise) return setupAccountRefreshPromise;

  setupAccountRefreshPromise = (async () => {
    await refreshCrealityProfile({ mode: 'idle' }, { force: true });
    await refreshPointsHistory(false, true);
    await refreshShopOrders();
  })().catch(() => {
    profileRefreshAttempted = false;
  }).finally(() => {
    setupAccountRefreshPromise = null;
  });

  return setupAccountRefreshPromise;
}

async function refreshLiveCounters() {
  const result = await api('/api/status');
  if (!result.ok) return;

  state.dailyCounters = result.dailyCounters || {};
  state.scheduler = result.scheduler || { running: false, runningTask: '' };
  state.nextExecutions = result.nextExecutions || {};
  state.healthMetrics = result.healthMetrics || {};
  state.latestRuns = result.latestRuns || [];
  state.config.crealityFavorites = result.config?.crealityFavorites || state.config.crealityFavorites || [];
  renderNextExecutions();
  renderDailyCounters();
  renderFavoriteProfiles(state.config.crealityFavorites);
  renderRuns();
  renderHealthSummary();
}

async function addCommentDraft() {
  const text = fields.commentText.value.trim();
  if (!text) {
    toast('Escribe el texto del comentario.');
    return false;
  }

  const button = $('#add-comment');
  button.disabled = true;
  try {
    const file = fields.commentImage.files?.[0];
    const existingIndex = state.commentDrafts.findIndex((comment) => comment.id === state.commentEditingId);
    const existing = existingIndex >= 0 ? state.commentDrafts[existingIndex] : null;
    let image = existing?.image || null;
    if (file) {
      const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowed.includes(file.type)) throw new Error('Solo se admiten imágenes JPG, PNG, GIF o WebP.');
      const response = await fetch('/api/tasks/comments/images', {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
        body: file
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(errorMessage(payload.error, payload));
      image = payload.image;
    }
    if (existing) {
      state.commentDrafts[existingIndex] = { ...existing, text, image };
    } else {
      state.commentDrafts.push({
        id: createClientId('comment'),
        text,
        enabled: true,
        usageCount: 0,
        image
      });
    }
    fields.commentText.value = '';
    fields.commentImage.value = '';
    updateCommentImageName();
    renderCommentDrafts();
    if (existing) collapseCommentComposer();
    return true;
  } catch (error) {
    toast(error.message || 'No se pudo añadir el comentario.');
    return false;
  } finally {
    button.disabled = false;
  }
}

function updateCommentImageName(existingName = '') {
  const name = fields.commentImage.files?.[0]?.name || existingName || 'Sin archivo seleccionado';
  fields.commentImageName.textContent = name;
  fields.commentImageName.title = name;
}

function createClientId(prefix = 'item') {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    return `${prefix}-${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function renderCommentDrafts() {
  fields.commentsList.innerHTML = '';
  if (!state.commentDrafts.length) {
    fields.commentsList.innerHTML = '<p class="muted">Añade al menos un comentario.</p>';
    return;
  }
  for (const comment of state.commentDrafts) {
    const row = document.createElement('div');
    row.className = 'comment-library-item';
    row.innerHTML = `
      <label class="comment-library-toggle" title="Activar o desactivar comentario">
        <input type="checkbox" data-comment-toggle="${escapeHtml(comment.id)}" aria-label="Activar o desactivar comentario" ${comment.enabled !== false ? 'checked' : ''}>
      </label>
      <div class="comment-library-copy">
        <strong title="${escapeHtml(comment.text)}">${escapeHtml(comment.text)}</strong>
        ${comment.image ? `<small title="${escapeHtml(comment.image.name || 'Imagen')}">Imagen: ${escapeHtml(comment.image.name || 'adjunta')}</small>` : '<small>Sin imagen asociada</small>'}
      </div>
      <span class="comment-usage-badge">x${Math.max(0, Number(comment.usageCount) || 0)}</span>
      <button class="comment-edit-button" type="button" data-comment-edit="${escapeHtml(comment.id)}" title="Editar comentario" aria-label="Editar comentario"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M410.3 231l11.3-11.3-33.9-33.9-62.1-62.1-33.9-33.9-11.3 11.3-22.6 22.6L58.6 322.9c-10.4 10.4-18 23.3-22.2 37.4L1 480.7c-2.5 8.4-.2 17.5 6.1 23.7s15.3 8.5 23.7 6.1l120.3-35.4c14.1-4.2 27-11.8 37.4-22.2L387.7 253.7 410.3 231zM160 399.4l-9.1 22.7c-4 3.1-8.5 5.4-13.3 6.9L59.4 452l23-78.1c1.4-4.9 3.8-9.4 6.9-13.3l22.7-9.1V384c0 8.8 7.2 16 16 16h32zM485.4 46.1L465.9 26.6C430.5-8.8 373.2-8.8 337.8 26.6l-9.7 9.7-11.3 11.3 33.9 33.9 62.1 62.1 33.9 33.9 11.3-11.3 9.7-9.7c35.4-35.4 35.4-92.7 0-128.1z"></path></svg></button>
      <button class="comment-delete-button" type="button" data-comment-delete="${escapeHtml(comment.id)}" title="Eliminar comentario" aria-label="Eliminar comentario">×</button>
    `;
    fields.commentsList.append(row);
  }
}

function finishPrintProfilesFromConfig() {
  const task = state.config.tasks.finishPrint;
  if (Array.isArray(task.printerProfiles) && task.printerProfiles.length) {
    return structuredClone(task.printerProfiles).filter((profile) => profile.printerName);
  }
  const legacyProfile = {
    id: 'printer-1',
    windowStart: task.windowStart || '08:00',
    windowEnd: task.windowEnd || '20:00',
    dailyLimit: Math.min(10, Math.max(0, Number(task.dailyLimit) || 0)),
    minIntervalMinutes: Math.max(10, Number(task.minIntervalMinutes) || 10),
    printMode: task.printMode || 'random',
    printerName: task.printerName || '',
    printerDeviceId: task.printerDeviceId || '',
    printerDeviceName: task.printerDeviceName || '',
    printerTelemetryId: task.printerTelemetryId || '',
    printerInterName: task.printerInterName || '',
    printerDeviceType: task.printerDeviceType,
    printerImageUrl: task.printerImageUrl || '',
    cloudFiles: task.cloudFiles || [],
    cloudFileRecords: task.cloudFileRecords || [],
    fileUsageCounts: task.fileUsageCounts || {}
  };
  return legacyProfile.printerName ? [legacyProfile] : [];
}

function knownFinishPrinters() {
  const printers = new Map(finishPrintProfilesFromConfig().map((profile) => [profile.printerName, {
    name: profile.printerName,
    deviceId: profile.printerDeviceId || '',
    deviceName: profile.printerDeviceName || '',
    telemetryId: profile.printerTelemetryId || '',
    printerInterName: profile.printerInterName || '',
    deviceType: profile.printerDeviceType ?? null,
    imageUrl: profile.printerImageUrl || ''
  }]));
  for (const printer of state.finishPrintDiscovery.printers) {
    if (printer?.name) printers.set(printer.name, printer);
  }
  return [...printers.values()];
}

async function loadFinishPrinterStatuses({ notify = false } = {}) {
  const button = $('#refresh-finish-printer-status');
  const section = $('#finish-printer-status-section');
  if (!fields.finishPrinterStatusList || section?.hidden || button?.disabled) return;
  if (button) button.disabled = true;
  fields.finishPrinterStatusList.innerHTML = '<p class="muted finish-printer-empty">Consultando el estado de las impresoras...</p>';
  try {
    const result = await apiWhenBrowserAvailable('/api/tasks/finish-print/status', { method: 'POST' }, button);
    if (result.cancelled) return;
    if (!result.ok) {
      fields.finishPrinterStatusList.innerHTML = finishPrinterStatusErrorMarkup(result);
      if (notify) toast(result.message || errorMessage(result.error, result));
      return;
    }
    state.finishPrintStatuses = result.printers || [];
    for (const printer of state.finishPrintStatuses) {
      const known = state.finishPrintDiscovery.printers.find((item) => item.name === printer.printerName);
      if (known && printer.telemetryId) known.telemetryId = printer.telemetryId;
      const draft = state.finishPrintDraftProfiles.find((item) => item.printerName === printer.printerName);
      if (draft && printer.telemetryId) draft.printerTelemetryId = printer.telemetryId;
      if (draft && printer.imageUrl) draft.printerImageUrl = printer.imageUrl;
    }
    renderFinishPrinterStatuses();
    await loadFinishPrinterStatusFiles({ force: notify, button });
    if (notify) toast('Estado de impresoras actualizado.');
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadFinishPrinterStatusFiles({ force = false, button } = {}) {
  const hasInactivePrinter = (state.finishPrintStatuses || []).some((printer) =>
    printer.connected !== false
    && Number(printer.state) === 0
    && !printer.pending
  );
  if (!hasInactivePrinter) return;
  const cached = state.finishPrintStatusFiles;
  if (!force && cached.files.length && !cached.error) return;
  state.finishPrintStatusFiles = { files: cached.files || [], loading: true, error: '' };
  renderFinishPrinterStatuses();
  const result = await apiWhenBrowserAvailable('/api/tasks/finish-print/discover-library', { method: 'POST' }, button);
  if (result.cancelled) return;
  state.finishPrintStatusFiles = result.ok
    ? { files: result.files || [], loading: false, error: '' }
    : result.error === 'FINISH_PRINT_GCODES_NOT_FOUND'
      ? { files: [], loading: false, error: '' }
      : { files: [], loading: false, error: result.error || 'FINISH_PRINT_GCODE_DISCOVERY_FAILED' };
  renderFinishPrinterStatuses();
}

function finishPrinterStatusErrorMarkup(result) {
  const message = result.message || errorMessage(result.error, result);
  const diagnostics = result.diagnostics;
  if (!diagnostics || typeof diagnostics !== 'object') {
    return `<p class="muted finish-printer-empty">${escapeHtml(message)}</p>`;
  }
  const requests = Array.isArray(diagnostics.observedRequests) ? diagnostics.observedRequests : [];
  const lines = [
    `Código: ${result.error || 'FINISH_PRINT_STATUS_ERROR'}`,
    `Página final: ${diagnostics.pageUrl || 'desconocida'}`,
    `Peticiones API observadas: ${Number(diagnostics.apiRequestCount) || 0}`,
    `Sesión autenticada detectada: ${diagnostics.authenticatedRequestObserved ? 'sí' : 'no'}`,
    `Impresoras guardadas disponibles: ${Number(diagnostics.knownPrinterCount) || 0}`
  ];
  if (requests.length) {
    lines.push('', 'Endpoints observados:');
    for (const request of requests) {
      const methods = Array.isArray(request.methods) && request.methods.length ? request.methods.join(',') : '-';
      const statuses = Array.isArray(request.statuses) && request.statuses.length ? request.statuses.join(',') : '-';
      lines.push(`${methods} ${request.path || '/'} · HTTP ${statuses} · token ${request.hasToken ? 'sí' : 'no'} · usuario ${request.hasUid ? 'sí' : 'no'}`);
    }
  }
  return `<div class="finish-printer-status-diagnostic">
    <p class="muted finish-printer-empty">${escapeHtml(message)}</p>
    <details><summary>Ver datos de diagnóstico</summary><pre>${escapeHtml(lines.join('\n'))}</pre></details>
  </div>`;
}

function renderFinishPrinterStatuses() {
  const printers = state.finishPrintStatuses || [];
  if (!printers.length) {
    fields.finishPrinterStatusList.innerHTML = '<p class="muted finish-printer-empty">No se encontraron impresoras vinculadas.</p>';
    return;
  }
  fields.finishPrinterStatusList.innerHTML = printers.map((printer) => {
    const progress = Math.min(100, Math.max(0, Number(printer.progress) || 0));
    const idle = Number(printer.state) === 0;
    const hasError = printer.state === 3 || Number(printer.printError) > 0 || Boolean(printer.error);
    const successfullyFinished = Number(printer.state) === 2 && !hasError;
    const canKill = Boolean(printer.pending);
    const disconnected = printer.connected === false;
    const canSelectGcode = !printer.pending && !disconnected && idle;
    const stateClass = disconnected
      ? 'is-offline'
      : hasError
      ? 'is-error'
      : printer.active ? 'is-printing' : successfullyFinished ? 'is-success' : 'is-idle';
    const showProgress = printer.active || successfullyFinished;
    const progressMarkup = showProgress
      ? `<span style="width:${progress}%"></span><strong><small>${printer.active ? `Restante: ${escapeHtml(formatDuration(printer.remainingSeconds))}` : 'Finalizada'}</small><b>${Math.round(progress)}%</b></strong>`
      : '<em>Sin impresión en curso</em>';
    const pauseLabel = printer.paused ? 'Reanudar impresión' : 'Pausar impresión';
    const pauseIcon = printer.paused
      ? '<svg viewBox="0 0 448 512" aria-hidden="true"><path d="M424.4 214.7 72.4 6.6C43.8-10.3 0 6.1 0 47.9V464c0 37.5 40.7 60.6 72.4 41.3l352-208c31.4-18.5 31.5-64.1 0-82.6z"/></svg>'
      : '<svg viewBox="0 0 320 512" aria-hidden="true"><path d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H96c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm176 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48h48c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H224z"/></svg>';
    const imageUrl = safePrinterImageUrl(printer.imageUrl);
    const image = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(printer.printerName)}">`
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/></svg>';
    const fileState = state.finishPrintStatusFiles;
    const files = finishStatusFilesForPrinter(printer.printerName);
    const selectedFileId = files.some((file) => file.id === state.finishPrintStatusSelections[printer.printerName])
      ? state.finishPrintStatusSelections[printer.printerName]
      : '';
    const lockedGcodeLabel = printer.gcodeName
      || (disconnected ? 'Impresora desconectada' : successfullyFinished ? 'Impresión finalizada' : 'Selector no disponible');
    const selectorEmptyLabel = fileState.loading
      ? 'Buscando G-code compatibles...'
      : fileState.error
        ? 'No se pudieron cargar los G-code'
        : 'No hay G-code compatibles';
    const selectorOptions = canSelectGcode
      ? `<option value="">${files.length ? 'Selecciona un G-code' : selectorEmptyLabel}</option>
        ${files.map((file) => `<option value="${escapeHtml(file.id)}" ${file.id === selectedFileId ? 'selected' : ''}>${escapeHtml(file.name)}</option>`).join('')}`
      : `<option value="">${escapeHtml(lockedGcodeLabel)}</option>`;
    const jobMarkup = `<div class="finish-printer-idle-job">
      <select data-printer-gcode aria-label="Selecciona un G-code para ${escapeHtml(printer.printerName)}" ${canSelectGcode && files.length && !fileState.loading ? '' : 'disabled'}>
        ${selectorOptions}
      </select>
    </div>`;
    const canPrint = canSelectGcode && Boolean(selectedFileId);
    return `<article class="finish-printer-status-card ${stateClass}" data-printer-name="${escapeHtml(printer.printerName)}">
      <div class="finish-printer-image">${image}</div>
      <div class="finish-printer-status-content">
        <div class="finish-printer-status-heading">
          <div class="finish-printer-status-title"><h4>${escapeHtml(printer.printerName)}</h4><span class="finish-printer-state">${escapeHtml(`${printer.stateLabel || 'No disponible'}${printer.pending && !printer.active ? ' · verificación pendiente' : ''}`)}</span>${hasError ? '<button class="finish-printer-error-badge" type="button" data-printer-error title="Ver detalle del error">Error</button>' : ''}</div>
          <div class="finish-printer-progress ${showProgress ? '' : 'is-empty'}" ${showProgress ? `role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"` : 'role="status"'}>${progressMarkup}</div>
        </div>
        <div class="finish-printer-operation-row">
          ${jobMarkup}
          <div class="finish-printer-status-actions">
            <button class="icon-action-button finish-printer-print" type="button" data-printer-print title="Imprimir ahora" aria-label="Imprimir ahora" ${canPrint ? '' : 'disabled'}><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M256 0 32 128v256l224 128 224-128V128L256 0zm0 64 160 91-160 91-160-91L256 64zm-160 147 128 73v137L96 348V211zm192 73 128-73v137l-128 73V284z"/></svg></button>
            <button class="secondary icon-action-button finish-printer-pause" type="button" data-printer-control="${printer.paused ? 'resume' : 'pause'}" title="${pauseLabel}" aria-label="${pauseLabel}" ${printer.canPause ? '' : 'disabled'}>${pauseIcon}</button>
            <button class="icon-action-button finish-printer-stop" type="button" data-printer-control="stop" title="Detener impresión" aria-label="Detener impresión" ${printer.canStop ? '' : 'disabled'}><svg viewBox="0 0 448 512" aria-hidden="true"><path d="M0 96C0 43 43 0 96 0H352c53 0 96 43 96 96V416c0 53-43 96-96 96H96c-53 0-96-43-96-96V96z"/></svg></button>
            <button class="icon-action-button finish-printer-kill" type="button" data-printer-control="kill" title="Eliminar proceso bloqueado" aria-label="Eliminar proceso bloqueado" ${canKill ? '' : 'disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a9 9 0 0 0-9 9c0 3.2 1.7 6.1 4.5 7.7V22h3v-2h3v2h3v-3.3A8.9 8.9 0 0 0 21 11a9 9 0 0 0-9-9Zm-3 12a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm6 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm-4.5 3 1.5-2 1.5 2h-3Z"/></svg></button>
          </div>
        </div>
      </div>
    </article>`;
  }).join('');
}

function finishStatusFilesForPrinter(printerName) {
  const sources = state.finishPrintStatusFiles.files || [];
  const files = new Map();
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const id = String(source.id || source.gcodeId || '').trim();
    const name = String(source.name || source.fileName || '').trim();
    if (id && name && !files.has(id)) files.set(id, { ...source, id, name });
  }
  return [...files.values()];
}

function safePrinterImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

async function handleFinishPrinterStatusAction(event) {
  const errorBadge = event.target.closest('[data-printer-error]');
  if (errorBadge) {
    const card = errorBadge.closest('[data-printer-name]');
    const printer = state.finishPrintStatuses.find((item) => item.printerName === card?.dataset.printerName);
    if (printer) openPrinterErrorModal(printer);
    return;
  }
  const printButton = event.target.closest('[data-printer-print]');
  if (printButton) {
    const card = printButton.closest('[data-printer-name]');
    const printerName = card?.dataset.printerName || '';
    const fileId = card?.querySelector('[data-printer-gcode]')?.value || '';
    const printer = knownFinishPrinters().find((item) => item.name === printerName);
    const file = finishStatusFilesForPrinter(printerName).find((item) => item.id === fileId);
    if (!printer || !file) return toast('Selecciona un archivo G-code.');
    await sendSelectedFinishPrint(printer, file, printButton, { refreshStatus: true });
    return;
  }
  const button = event.target.closest('[data-printer-control]');
  if (!button || button.disabled) return;
  const card = button.closest('[data-printer-name]');
  const printerName = card?.dataset.printerName || '';
  const action = button.dataset.printerControl;
  const labels = { pause: 'pausar', resume: 'reanudar', stop: 'detener', kill: 'eliminar el proceso pendiente de' };
  const warning = action === 'kill'
    ? `¿Quieres eliminar el proceso pendiente de ${printerName}? Esto desbloqueará CC Tools, pero no enviará ninguna orden a la impresora.`
    : `¿Quieres ${labels[action]} la impresión de ${printerName}?`;
  if (!confirm(warning)) return;
  button.disabled = true;
  try {
    const result = await api('/api/tasks/finish-print/control', {
      method: 'POST',
      body: { printerName, action }
    });
    toast(result.ok
      ? action === 'kill'
        ? 'Proceso pendiente eliminado y cola de impresiones desbloqueada.'
        : action === 'stop'
        ? `Impresión detenida${result.releasedPending ? ' y bloqueo liberado' : ''}.`
        : `Impresión ${action === 'pause' ? 'pausada' : 'reanudada'}.`
      : result.message || errorMessage(result.error, result));
    if (result.ok) await loadFinishPrinterStatuses();
  } finally {
    button.disabled = false;
  }
}

function handleFinishPrinterStatusChange(event) {
  const select = event.target.closest('[data-printer-gcode]');
  if (!select) return;
  const card = select.closest('[data-printer-name]');
  const printerName = card?.dataset.printerName || '';
  state.finishPrintStatusSelections[printerName] = select.value;
  const button = card?.querySelector('[data-printer-print]');
  if (button) button.disabled = !select.value;
}

function openPrinterErrorModal(printer) {
  const code = Number(printer.printError) > 0 ? String(printer.printError) : String(printer.error || 'No disponible');
  const reportedDetail = String(printer.printErrorDetail || printer.error || '').trim();
  const hasDescription = reportedDetail && !/^Código de error:/i.test(reportedDetail);
  const stateLabel = printer.stateLabel || 'No disponible';
  const summary = hasDescription
    ? reportedDetail
    : Number(printer.state) === 2
      ? 'La impresión figura como finalizada, pero Creality Cloud también ha comunicado una incidencia.'
      : 'La impresora ha comunicado una incidencia durante la impresión.';
  const guidance = hasDescription
    ? 'Revisa la pantalla de la impresora antes de continuar o enviar otro trabajo.'
    : `Creality Cloud solo ha devuelto el código técnico ${code}, sin una descripción de la causa. Revisa la pantalla de la impresora o el Banco de trabajo para identificarla.`;
  const details = [
    `Código técnico: ${code}`,
    `Estado interno: ${stateLabel} (${printer.state ?? '-'})`,
    `G-code: ${printer.gcodeName || 'No disponible'}`,
    `ID de impresión: ${printer.printId || 'No disponible'}`,
    `Última telemetría: ${printer.diagnostics?.lastTelemetryUpdate || 'No disponible'}`
  ];
  fields.printerErrorName.textContent = printer.printerName || 'Impresora';
  fields.printerErrorMessage.textContent = summary;
  fields.printerErrorGuidance.textContent = guidance;
  fields.printerErrorState.textContent = stateLabel;
  fields.printerErrorGcode.textContent = printer.gcodeName || 'No disponible';
  fields.printerErrorObserved.textContent = formatPrinterTelemetryTime(printer.diagnostics?.lastTelemetryUpdate);
  fields.printerErrorDetails.textContent = details.join('\n');
  fields.printerErrorModal.hidden = false;
}

function formatPrinterTelemetryTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'No disponible';
  const milliseconds = numeric < 1e12 ? numeric * 1000 : numeric;
  return formatDate(milliseconds);
}

function closePrinterErrorModal() {
  fields.printerErrorModal.hidden = true;
}

async function sendSelectedFinishPrint(printer, file, button, { refreshStatus = false } = {}) {
  button.disabled = true;
  toast(`Enviando ${file.name} a ${printer.name}...`);
  try {
    const result = await api('/api/tasks/finish-print/run-selected', {
      method: 'POST',
      body: { printer, file }
    });
    toast(result.ok
      ? result.message || 'Trabajo de impresión iniciado.'
      : result.message || errorMessage(result.error, result));
    if (result.ok) {
      await refresh();
      if (refreshStatus) await loadFinishPrinterStatuses();
    }
  } finally {
    button.disabled = false;
  }
}

function addFinishPrinterProfile() {
  state.finishPrintDraftProfiles = collectFinishPrinterProfiles();
  const printerName = fields.finishPrintSetup.querySelector('[data-finish-printer-picker]')?.value || '';
  if (!printerName) {
    toast('Selecciona una impresora para añadir su programación.');
    return;
  }
  if (state.finishPrintDraftProfiles.some((profile) => profile.printerName === printerName)) {
    toast('Esta impresora ya tiene una programación.');
    return;
  }
  const printer = state.finishPrintDiscovery.printers.find((item) => item.name === printerName) || {};
  state.finishPrintDraftProfiles.push({
    id: `printer-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
    windowStart: '08:00',
    windowEnd: '20:00',
    dailyLimit: 1,
    minIntervalMinutes: 10,
    printMode: 'random',
    printerName,
    printerDeviceId: printer.deviceId || '',
    printerDeviceName: printer.deviceName || '',
    printerTelemetryId: printer.telemetryId || '',
    printerInterName: printer.printerInterName || '',
    printerDeviceType: printer.deviceType ?? null,
    printerImageUrl: printer.imageUrl || '',
    cloudFiles: [],
    cloudFileRecords: [],
    fileUsageCounts: {}
  });
  state.finishPrintPrinterPicker = '';
  fields.finishPrintSetup.hidden = false;
  $('#toggle-finish-print-setup').setAttribute('aria-expanded', 'true');
  renderFinishPrinterProfiles();
}

function renderFinishPrinterProfiles() {
  const profiles = state.finishPrintDraftProfiles;
  const statusSection = $('#finish-printer-status-section');
  if (statusSection) statusSection.hidden = profiles.length === 0;
  const configuredNames = new Set(profiles.map((profile) => profile.printerName));
  const availablePrinters = state.finishPrintDiscovery.printers.filter((printer) => !configuredNames.has(printer.name));
  if (!availablePrinters.some((printer) => printer.name === state.finishPrintPrinterPicker)) {
    state.finishPrintPrinterPicker = '';
  }
  const options = [
    '<option value="">Selecciona una impresora</option>',
    ...availablePrinters.map((printer) => `<option value="${escapeHtml(printer.name)}" ${printer.name === state.finishPrintPrinterPicker ? 'selected' : ''}>${escapeHtml(printer.name)}</option>`)
  ].join('');
  const schedules = profiles.length
    ? profiles.map((profile) => finishPrinterProfileMarkup(profile)).join('')
    : '<p class="muted finish-printer-empty">Añade una impresora para configurar sus G-code y su programación.</p>';
  fields.finishPrintSetup.innerHTML = `<div class="finish-printer-toolbar">
    <label class="inline-setting-field finish-printer-select-field">
      <span>Listado de impresoras</span>
      <select data-finish-printer-picker>${options}</select>
    </label>
    <div class="finish-printer-toolbar-actions">
      <button class="secondary icon-action-button finish-printer-add" type="button" data-finish-profile-action="add" title="Añadir programación" aria-label="Añadir programación"><svg viewBox="0 0 448 512" aria-hidden="true"><path d="M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32V224H48c-17.7 0-32 14.3-32 32s14.3 32 32 32H192V432c0 17.7 14.3 32 32 32s32-14.3 32-32V288H400c17.7 0 32-14.3 32-32s-14.3-32-32-32H256V80z"/></svg></button>
      <button class="secondary icon-action-button" type="button" data-finish-profile-action="discover-printers" title="Actualizar impresoras" aria-label="Actualizar impresoras"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8c62.5-62.5 163.8-62.5 226.3 0L386.3 160H352c-17.7 0-32 14.3-32 32s14.3 32 32 32H463.5c17.7 0 32-14.3 32-32V80c0-17.7-14.3-32-32-32s-32 14.3-32 32v35.2L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0C73.2 122 55.6 150.7 44.8 181.4c-5.9 16.7 2.9 34.9 19.5 40.8s34.9-2.9 40.8-19.6zM39 289.3c-5 1.5-9.8 4.2-13.7 8.2c-4 4-6.7 8.8-8.1 14c-.8 2.9-1.2 5.9-1.2 8.9V432c0 17.7 14.3 32 32 32s32-14.3 32-32V396.9l17.6 17.5c87.5 87.4 229.3 87.4 316.7 0c24.4-24.4 42.1-53.1 52.9-83.8c5.9-16.7-2.9-34.9-19.5-40.8s-34.9 2.9-40.8 19.5c-7.7 21.8-20.2 42.3-37.8 59.8c-62.5 62.5-163.8 62.5-226.3 0L125.6 352H160c17.7 0 32-14.3 32-32s-14.3-32-32-32H48.4c-3.2 0-6.4 .5-9.4 1.3z"/></svg></button>
      <a class="button-like secondary icon-action-button" href="https://www.crealitycloud.com/es/workbench-beta/?type=1" target="_blank" rel="noopener noreferrer" title="Abrir Banco de trabajo" aria-label="Abrir Banco de trabajo"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M78.6 5C69.1-2.4 55.6-1.5 47 7L7 47c-8.5 8.5-9.4 22-2.1 31.6l80 104c4.5 5.9 11.6 9.4 19 9.4h54.1l109 109c-14.7 29-10 65.4 14.3 89.6l112 112c12.5 12.5 32.8 12.5 45.3 0l64-64c12.5-12.5 12.5-32.8 0-45.3l-112-112c-24.2-24.2-60.6-29-89.6-14.3l-109-109v-54.1c0-7.5-3.5-14.5-9.4-19L78.6 5zM19.9 396.1C7.2 408.8 0 426.1 0 444.1C0 481.6 30.4 512 67.9 512c18 0 35.3-7.2 48-19.9L233.7 374.3c-7.8-20.9-9-43.6-3.6-65.1l-61.7-61.7L19.9 396.1zM512 144c0-10.5-1.1-20.7-3.2-30.5c-2.4-11.2-16.1-14.1-24.2-6l-58.3 58.3-45.2-7.5-7.5-45.2 58.3-58.3c8.1-8.1 5.2-21.8-6-24.2C278.7 1.1 268.5 0 258 0c-54.7 0-102.2 30.4-126.6 75.2l42.3 55c6 7.8 9.3 17.4 9.3 27.2v12.9l65.2 65.2c14.6-8.5 31.5-13.5 49.6-13.5c6.5 0 12.8 .6 19 1.8l10.8-10.8C374.6 232.6 512 199.2 512 144z"/></svg></a>
    </div>
  </div>
  <div class="finish-printer-profiles">${schedules}</div>
  <div class="finish-print-program-footer">
    <button id="save-finish-print-setup" type="button" data-finish-profile-action="save"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM232 120c0-13.3 10.7-24 24-24s24 10.7 24 24V243.2l71.1 47.4c11 7.4 14 22.3 6.7 33.3s-22.3 14-33.3 6.7l-81.8-54.5c-6.7-4.5-10.7-12-10.7-20V120z"/></svg><span>Programar</span></button>
  </div>`;
}

function finishPrinterProfileMarkup(profile) {
  const availableFiles = profile.availableFiles?.length
    ? profile.availableFiles
    : profile.cloudFileRecords?.length ? profile.cloudFileRecords : profile.cloudFiles || [];
  const selectedRecords = profile.cloudFileRecords?.length ? profile.cloudFileRecords : profile.cloudFiles || [];
  const selected = new Set(selectedRecords
    .flatMap((file) => typeof file === 'string' ? [file] : [String(file.id || ''), String(file.name || '')]));
  const quantities = new Map(selectedRecords.flatMap((file) => typeof file === 'string'
    ? [[file, 1]]
    : [[String(file.id || ''), Math.max(1, Number(file.quantity) || 1)], [String(file.name || ''), Math.max(1, Number(file.quantity) || 1)]]));
  const orderedFiles = availableFiles.map((file, index) => ({ file, index })).sort((left, right) => {
    const leftRecord = typeof left.file === 'string' ? { id: '', name: left.file } : left.file;
    const rightRecord = typeof right.file === 'string' ? { id: '', name: right.file } : right.file;
    const leftSelected = selected.has(String(leftRecord.id || '')) || selected.has(String(leftRecord.name || ''));
    const rightSelected = selected.has(String(rightRecord.id || '')) || selected.has(String(rightRecord.name || ''));
    return Number(rightSelected) - Number(leftSelected) || left.index - right.index;
  }).map(({ file }) => file);
  const files = orderedFiles.length
    ? orderedFiles.map((file) => finishFileOptionMarkup(file, selected, quantities, profile)).join('')
    : '<p class="muted">No hay archivos sincronizados.</p>';
  const printMode = ['quantities', 'ordered', 'random'].includes(profile.printMode) ? profile.printMode : 'random';
  return `<article class="finish-printer-profile" data-printer-profile-id="${escapeHtml(profile.id)}" data-printer-name="${escapeHtml(profile.printerName)}">
    <div class="finish-printer-profile-heading">
      <h4>${escapeHtml(profile.printerName)}</h4>
      <div class="finish-printer-profile-actions">
        <button class="finish-gcode-search" type="button" data-finish-profile-action="discover-files"><span>Buscar GCODE</span></button>
        <label class="finish-print-mode-field"><span>Modo</span><select data-finish-profile-field="printMode"><option value="quantities" ${printMode === 'quantities' ? 'selected' : ''}>Cantidades</option><option value="ordered" ${printMode === 'ordered' ? 'selected' : ''}>En orden</option><option value="random" ${printMode === 'random' ? 'selected' : ''}>Aleatorio</option></select></label>
        <a class="button-like secondary icon-action-button" href="https://www.crealitycloud.com/es/flowslicer/project?tab=gcode" target="_blank" rel="noopener noreferrer" title="Abrir archivos G-code" aria-label="Abrir archivos G-code"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M64 0C28.7 0 0 28.7 0 64V448c0 35.3 28.7 64 64 64H448c35.3 0 64-28.7 64-64V160H384c-17.7 0-32-14.3-32-32V0H64zM384 0V128H512L384 0z"/></svg></a>
        <button class="icon-action-button finish-printer-remove" type="button" data-finish-profile-action="remove" title="Eliminar programación" aria-label="Eliminar programación"><svg viewBox="0 0 448 512" aria-hidden="true"><path d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32S433.7 32 416 32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 48 45H346.8c25.4 0 46.5-19.7 48-45L416 128z"/></svg></button>
      </div>
    </div>
    <div class="setup-control-row">
      <div class="finish-files-list">${files}</div>
    </div>
    <div class="finish-print-schedule-config">
      <div class="form-grid finish-print-schedule-grid">
        <label class="inline-setting-field time-control-field"><span>Desde las</span><input data-finish-profile-field="windowStart" type="time" value="${escapeHtml(profile.windowStart || '08:00')}"></label>
        <label class="inline-setting-field time-control-field"><span>Hasta las</span><input data-finish-profile-field="windowEnd" type="time" value="${escapeHtml(profile.windowEnd || '20:00')}"></label>
      </div>
      <div class="form-grid finish-print-schedule-grid finish-print-schedule-values">
        <label class="inline-setting-field time-control-field"><span>Impresiones por día</span><input data-finish-profile-field="dailyLimit" type="number" min="0" max="10" value="${Math.min(10, Math.max(0, Number(profile.dailyLimit) || 0))}"></label>
        <label class="inline-setting-field time-control-field"><span>Intervalo mínimo (min)</span><input data-finish-profile-field="minIntervalMinutes" type="number" min="10" value="${Math.max(10, Number(profile.minIntervalMinutes) || 10)}"></label>
      </div>
    </div>
  </article>`;
}

function finishFileOptionMarkup(file, selected, quantities, profile) {
  const record = typeof file === 'string' ? { id: '', name: file, printTime: 0 } : file;
  const name = String(record?.name || '').trim();
  if (!name) return '';
  const usageCount = Math.max(0, Number(profile.fileUsageCounts?.[record.id] ?? profile.fileUsageCounts?.[name]) || 0);
  const printTime = Math.max(0, Number(record.printTime) || 0);
  const quantity = Math.min(99, Math.max(1, Number(quantities.get(String(record.id || '')) ?? quantities.get(name)) || 1));
  const quantityControl = profile.printMode === 'quantities'
    ? `<div class="finish-file-quantity" aria-label="Cantidad de impresiones"><button type="button" data-finish-profile-action="quantity-decrement" aria-label="Reducir cantidad">−</button><strong data-file-quantity>${quantity}</strong><button type="button" data-finish-profile-action="quantity-increment" aria-label="Aumentar cantidad">+</button></div>`
    : '';
  return `<label class="finish-file-option"><input type="checkbox" data-file-id="${escapeHtml(record.id || '')}" data-file-name="${escapeHtml(name)}" data-print-time="${printTime}" ${selected.has(String(record.id || '')) || selected.has(name) ? 'checked' : ''}><span title="${escapeHtml(name)}">${escapeHtml(name)}</span>${quantityControl}<strong class="finish-file-time">${printTime ? formatGcodeDuration(printTime) : '--'}</strong><strong class="finish-file-usage ${usageCount < 50 ? 'is-low' : usageCount <= 100 ? 'is-medium' : 'is-high'}">x${usageCount}</strong></label>`;
}

function collectFinishPrinterProfiles() {
  return $$('.finish-printer-profile').map((card) => {
    const previous = state.finishPrintDraftProfiles.find((profile) => profile.id === card.dataset.printerProfileId) || {};
    const printerName = card.dataset.printerName || previous.printerName || '';
    const printer = state.finishPrintDiscovery.printers.find((item) => item.name === printerName) || previous;
    const cloudFileRecords = Array.from(card.querySelectorAll('.finish-files-list input:checked')).map((input) => ({
      id: input.dataset.fileId || '',
      name: input.dataset.fileName || '',
      printTime: Math.max(0, Number(input.dataset.printTime) || 0),
      quantity: Math.min(99, Math.max(1, Number(input.closest('.finish-file-option')?.querySelector('[data-file-quantity]')?.textContent) || 1))
    })).filter((file) => file.id && file.name);
    return {
      ...previous,
      id: card.dataset.printerProfileId,
      printerName,
      printerDeviceId: printer.deviceId || printer.printerDeviceId || '',
      printerDeviceName: printer.deviceName || printer.printerDeviceName || '',
      printerTelemetryId: printer.telemetryId || printer.printerTelemetryId || '',
      printerInterName: printer.printerInterName || '',
      printerDeviceType: printer.deviceType ?? printer.printerDeviceType ?? null,
      printerImageUrl: printer.imageUrl || printer.printerImageUrl || '',
      windowStart: card.querySelector('[data-finish-profile-field="windowStart"]').value,
      windowEnd: card.querySelector('[data-finish-profile-field="windowEnd"]').value,
      dailyLimit: Number(card.querySelector('[data-finish-profile-field="dailyLimit"]').value),
      minIntervalMinutes: Number(card.querySelector('[data-finish-profile-field="minIntervalMinutes"]').value),
      printMode: card.querySelector('[data-finish-profile-field="printMode"]')?.value || previous.printMode || 'random',
      cloudFiles: cloudFileRecords.map((file) => file.name),
      cloudFileRecords,
      discoveryUpdatedAt: previous.discoveryUpdatedAt || ''
    };
  });
}

async function handleFinishPrintProfileAction(event) {
  const button = event.target.closest('[data-finish-profile-action]');
  if (!button) return;
  const action = button.dataset.finishProfileAction;
  if (action === 'add') {
    addFinishPrinterProfile();
    return;
  }
  if (action === 'save') {
    await programTool(fields.finishPrintEnabled, saveFinishPrinterProfiles);
    return;
  }
  if (action === 'discover-printers') {
    state.finishPrintDraftProfiles = collectFinishPrinterProfiles();
    button.disabled = true;
    const result = await apiWhenBrowserAvailable('/api/tasks/finish-print/discover-printers', { method: 'POST' }, button);
    button.disabled = false;
    if (result.cancelled) return;
    if (!result.ok) return toast(result.message || errorMessage(result.error, result));
    state.finishPrintDiscovery.printers = result.printers || [];
    renderFinishPrinterProfiles();
    return toast(`${result.printers.length} impresora(s) encontrada(s).`);
  }
  const card = button.closest('.finish-printer-profile');
  const id = card?.dataset.printerProfileId;
  state.finishPrintDraftProfiles = collectFinishPrinterProfiles();
  const profile = state.finishPrintDraftProfiles.find((item) => item.id === id);
  if (action === 'remove') {
    state.finishPrintDraftProfiles = state.finishPrintDraftProfiles.filter((item) => item.id !== id);
    renderFinishPrinterProfiles();
    return;
  }
  if (action === 'quantity-decrement' || action === 'quantity-increment') {
    event.preventDefault();
    event.stopPropagation();
    const quantityNode = button.closest('.finish-file-quantity')?.querySelector('[data-file-quantity]');
    if (!quantityNode) return;
    const delta = action === 'quantity-increment' ? 1 : -1;
    quantityNode.textContent = String(Math.min(99, Math.max(1, Number(quantityNode.textContent) + delta)));
    state.finishPrintDraftProfiles = collectFinishPrinterProfiles();
    return;
  }
  button.disabled = true;
  if (action === 'discover-files') {
    if (!profile?.printerName) {
      button.disabled = false;
      return toast('Selecciona primero una impresora.');
    }
    const result = await apiWhenBrowserAvailable('/api/tasks/finish-print/discover-files', {
      method: 'POST',
      body: { printerName: profile.printerName, printerInterName: profile.printerInterName || '', deviceType: profile.printerDeviceType }
    }, button);
    button.disabled = false;
    if (result.cancelled) return;
    if (!result.ok) return toast(result.message || errorMessage(result.error, result));
    profile.availableFiles = result.files || [];
    profile.discoveryUpdatedAt = new Date().toISOString();
    renderFinishPrinterProfiles();
    return toast(`${result.files.length} archivo(s) G-code encontrado(s).`);
  }
}

function handleFinishPrintProfileChange(event) {
  const picker = event.target.closest('[data-finish-printer-picker]');
  if (picker) {
    state.finishPrintPrinterPicker = picker.value;
    return;
  }
  if (event.target.matches('[data-finish-profile-field="printMode"], .finish-file-option input[type="checkbox"]')) {
    state.finishPrintDraftProfiles = collectFinishPrinterProfiles();
    renderFinishPrinterProfiles();
  }
}

async function saveFinishPrinterProfiles() {
  const profiles = collectFinishPrinterProfiles();
  if (profiles.some((profile) => !profile.printerName)) {
    toast('Selecciona una impresora en todos los bloques.');
    return false;
  }
  if (new Set(profiles.map((profile) => profile.printerName)).size !== profiles.length) {
    toast('Cada impresora solo puede aparecer en un bloque.');
    return false;
  }
  for (const profile of profiles) {
    const records = profile.cloudFileRecords || [];
    const durations = records.map((file) => Math.ceil(Math.max(0, Number(file.printTime) || 0) / 60)).filter(Boolean);
    const required = profile.dailyLimit * ((durations.length ? Math.max(...durations) : 10) + profile.minIntervalMinutes + 5);
    if (required > 1440) {
      toast(`La programación de ${profile.printerName} no cabe en una ventana diaria.`);
      return false;
    }
    if (windowDurationMinutes(profile.windowStart, profile.windowEnd) < required) {
      profile.windowEnd = addMinutesToClock(profile.windowStart, required);
      toast(`He ampliado la ventana de ${profile.printerName} al mínimo necesario.`);
    }
  }
  const button = $('#save-finish-print-setup');
  button.disabled = true;
  const result = await api('/api/config', { method: 'PATCH', body: { finishPrint: { enabled: fields.finishPrintEnabled.checked, printerProfiles: profiles } } });
  button.disabled = false;
  if (!result.ok) {
    toast(errorMessage(result.error, result));
    return false;
  }
  state.config = result.config;
  state.finishPrintDraftProfiles = finishPrintProfilesFromConfig();
  render();
  renderFinishPrinterProfiles();
  toast('Cambios guardados correctamente.');
  return true;
}

function renderFinishPrintSetup() {
  const config = state.config.tasks.finishPrint;
  fields.finishPrintWindowStart.value = config.windowStart || '08:00';
  fields.finishPrintWindowEnd.value = config.windowEnd || '20:00';
  fields.finishPrintDailyLimit.value = Math.min(10, Math.max(0, Number(config.dailyLimit) || 0));
  fields.finishPrintMinInterval.value = Math.max(10, Number(config.minIntervalMinutes) || 10);
  const printers = state.finishPrintDiscovery.printers.length
    ? state.finishPrintDiscovery.printers
    : config.printerName ? [{
        name: config.printerName,
        deviceId: config.printerDeviceId || '',
        deviceName: config.printerDeviceName || '',
        printerInterName: config.printerInterName || '',
        deviceType: config.printerDeviceType
      }] : [];
  renderFinishPrinterOptions(printers, config.printerName || '');
  const files = state.finishPrintDiscovery.files.length
    ? state.finishPrintDiscovery.files
    : config.cloudFileRecords?.length ? config.cloudFileRecords : config.cloudFiles || [];
  renderFinishFiles(files, config.cloudFileRecords?.length ? config.cloudFileRecords : config.cloudFiles || []);
}

async function discoverFinishPrinters() {
  const button = $('#discover-finish-printers');
  button.disabled = true;
  toast('Consultando el Banco de trabajo...');
  const result = await api('/api/tasks/finish-print/discover-printers', { method: 'POST' });
  button.disabled = false;
  if (!result.ok) {
    toast(result.message || errorMessage(result.error, result));
    return;
  }

  state.finishPrintDiscovery.printers = result.printers || [];
  const savedName = state.config.tasks.finishPrint.printerName || '';
  const selected = result.printers.some((printer) => printer.name === savedName)
    ? savedName
    : result.printers[0]?.name || '';
  renderFinishPrinterOptions(result.printers, selected);
  state.finishPrintDiscovery.files = selected === savedName
    ? state.config.tasks.finishPrint.cloudFileRecords?.length
      ? state.config.tasks.finishPrint.cloudFileRecords
      : state.config.tasks.finishPrint.cloudFiles || []
    : [];
  renderFinishFiles(state.finishPrintDiscovery.files, state.finishPrintDiscovery.files);
  toast(`${result.printers.length} impresora(s) encontrada(s).`);
}

async function discoverFinishFiles() {
  const printerName = fields.finishPrinterSelect.value;
  if (!printerName) {
    toast('Selecciona primero una impresora.');
    return;
  }

  const button = $('#discover-finish-files');
  const printer = selectedFinishPrinter();
  button.disabled = true;
  toast('Consultando los archivos de la impresora...');
  const result = await api('/api/tasks/finish-print/discover-files', {
    method: 'POST',
    body: {
      printerName,
      printerInterName: printer?.printerInterName || '',
      deviceType: printer?.deviceType
    }
  });
  button.disabled = false;
  if (!result.ok) {
    toast(result.message || errorMessage(result.error, result));
    return;
  }

  state.finishPrintDiscovery.files = result.files || [];
  const saved = state.config.tasks.finishPrint;
  const selected = printerName === saved.printerName
    ? saved.cloudFileRecords?.length ? saved.cloudFileRecords : saved.cloudFiles || []
    : [];
  renderFinishFiles(result.files, selected);
  toast(`${result.files.length} archivo(s) G-code encontrado(s).`);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  return [
    hours ? `${hours} h` : '',
    minutes ? `${minutes} min` : '',
    remainingSeconds || (!hours && !minutes) ? `${remainingSeconds} s` : ''
  ].filter(Boolean).join(' ');
}

function formatGcodeDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  return `${String(minutes).padStart(2, '0')}' ${String(remainingSeconds).padStart(2, '0')}"`;
}

async function saveFinishPrintSetup() {
  const printerName = fields.finishPrinterSelect.value;
  const printer = selectedFinishPrinter();
  const cloudFileRecords = selectedFinishFileRecords();
  const cloudFiles = cloudFileRecords.map((file) => file.name);
  if (!printerName) {
    toast('Selecciona una impresora.');
    return false;
  }

  if (!adjustFinishPrintWindow(cloudFileRecords)) return false;

  const button = $('#save-finish-print-setup');
  button.disabled = true;
  const result = await api('/api/config', {
    method: 'PATCH',
    body: {
      finishPrint: {
        enabled: fields.finishPrintEnabled.checked,
        windowStart: fields.finishPrintWindowStart.value,
        windowEnd: fields.finishPrintWindowEnd.value,
        dailyLimit: Number(fields.finishPrintDailyLimit.value),
        minIntervalMinutes: Number(fields.finishPrintMinInterval.value),
        printerName,
        printerDeviceId: printer?.deviceId || '',
        printerDeviceName: printer?.deviceName || '',
        printerInterName: printer?.printerInterName || '',
        printerDeviceType: printer?.deviceType,
        cloudFiles,
        cloudFileRecords,
        discoveryUpdatedAt: new Date().toISOString()
      }
    }
  });
  button.disabled = false;
  if (!result.ok) {
    toast(errorMessage(result.error, result));
    return false;
  }

  state.config = result.config;
  state.finishPrintDiscovery.files = cloudFileRecords;
  render();
  renderFinishPrintSetup();
  toast('Cambios guardados correctamente.');
  return true;
}

function selectedFinishFileRecords() {
  const knownByName = new Map([
    ...(state.config.tasks.finishPrint.cloudFileRecords || []),
    ...state.finishPrintDiscovery.files
  ].filter((file) => file && typeof file === 'object' && file.id && file.name)
    .map((file) => [String(file.name), {
      id: String(file.id),
      name: String(file.name),
      printTime: Math.max(0, Number(file.printTime) || 0)
    }]));

  return $$('#finish-files-list input[type="checkbox"]:checked').map((input) => {
    const name = input.dataset.fileName || input.value;
    const id = input.dataset.fileId || knownByName.get(name)?.id || '';
    return {
      id,
      name,
      printTime: Math.max(
        0,
        Number(input.dataset.printTime) || Number(knownByName.get(name)?.printTime) || 0
      )
    };
  }).filter((file) => file.id && file.name);
}

function selectedFinishPrinter() {
  const printerName = fields.finishPrinterSelect.value;
  const discovered = state.finishPrintDiscovery.printers.find((printer) => printer.name === printerName);
  if (discovered) return discovered;
  const saved = state.config.tasks.finishPrint;
  if (saved.printerName !== printerName) return null;
  return {
    name: saved.printerName,
    deviceId: saved.printerDeviceId || '',
    deviceName: saved.printerDeviceName || '',
    printerInterName: saved.printerInterName || '',
    deviceType: saved.printerDeviceType
  };
}

function renderFinishPrinterOptions(printers, selected) {
  fields.finishPrinterSelect.innerHTML = '<option value="">Sin seleccionar</option>';
  for (const printer of printers) {
    const option = document.createElement('option');
    option.value = printer.name;
    option.textContent = printer.name;
    option.selected = printer.name === selected;
    fields.finishPrinterSelect.append(option);
  }
}

function renderFinishFiles(files, selectedFiles = []) {
  fields.finishFilesList.innerHTML = '';
  if (!files.length) {
    fields.finishFilesList.innerHTML = '<p class="muted">No hay archivos sincronizados.</p>';
    return;
  }
  const selected = new Set(selectedFiles.flatMap((file) => typeof file === 'string'
    ? [file]
    : [String(file?.id || ''), String(file?.name || '')]));
  for (const file of files) {
    const record = finishPrintRecordWithKnownDuration(file);
    const name = String(record?.name || '').trim();
    if (!name) continue;
    const label = document.createElement('label');
    label.className = 'finish-file-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = name;
    input.dataset.fileId = String(record?.id || '');
    input.dataset.fileName = name;
    input.dataset.printTime = String(Math.max(0, Number(record?.printTime) || 0));
    input.checked = selected.has(input.dataset.fileId) || selected.has(name);
    const text = document.createElement('span');
    text.textContent = name;
    text.title = name;
    const printTime = Math.max(0, Number(record?.printTime) || 0);
    const duration = document.createElement('strong');
    duration.className = 'finish-file-time';
    duration.textContent = printTime ? formatGcodeDuration(printTime) : '--';
    duration.title = printTime ? `Tiempo de impresión: ${formatGcodeDuration(printTime)}` : 'Tiempo de impresión no disponible';
    duration.setAttribute('aria-label', duration.title);
    const usageCount = finishPrintUsageCount(record);
    const usage = document.createElement('strong');
    usage.className = `finish-file-usage ${usageCount < 50 ? 'is-low' : usageCount <= 100 ? 'is-medium' : 'is-high'}`;
    usage.textContent = `x${usageCount}`;
    usage.title = usageCount === 1 ? '1 impresión virtual' : `${usageCount} impresiones virtuales`;
    usage.setAttribute('aria-label', usage.title);
    label.append(input, text, duration, usage);
    fields.finishFilesList.append(label);
  }
}

function finishPrintRecordWithKnownDuration(file) {
  const record = typeof file === 'string' ? { id: '', name: file, printTime: 0 } : { ...file };
  const id = String(record?.id || '').trim();
  const name = String(record?.name || '').trim();
  const saved = (state.config?.tasks?.finishPrint?.cloudFileRecords || []).find((item) =>
    (id && String(item?.id || '').trim() === id)
      || (name && String(item?.name || '').trim() === name));
  if (!(Number(record.printTime) > 0) && Number(saved?.printTime) > 0) {
    record.printTime = Number(saved.printTime);
  }
  return record;
}

function finishPrintUsageCount(file) {
  const counts = state.config?.tasks?.finishPrint?.fileUsageCounts || {};
  const id = String(file?.id || '').trim();
  const name = String(file?.name || '').trim();
  return Math.max(0, Number(counts[id] ?? counts[name]) || 0);
}

async function loadDesigns(page = state.designs.page) {
  const sequence = ++designsRequestSequence;
  const query = state.designs.query || '';
  const filters = state.designs.filters || emptyDesignFilters();
  const sort = state.designs.sort || { key: 'date', direction: 'desc' };
  const params = new URLSearchParams({ page: String(page), q: query, ...filters, sort: sort.key, direction: sort.direction });
  const result = await api(`/api/designs?${params.toString()}`);
  if (sequence !== designsRequestSequence) return;
  if (!result.ok) {
    toast(result.error || 'No se pudieron cargar los diseños.');
    return;
  }
  state.designs = {
    page: result.page,
    totalPages: result.totalPages,
    total: result.total,
    items: result.designs,
    query,
    sort: {
      key: result.sort || sort.key,
      direction: result.direction || sort.direction
    },
    filters
  };
  renderDesigns();
}

function emptyDesignFilters() {
  return { from: '', to: '', like: 'all', collection: 'all', comment: 'all', favoriteAuthor: 'all' };
}

function readDesignFilters() {
  return {
    from: fields.designsFilterFrom.value,
    to: fields.designsFilterTo.value,
    like: fields.designsFilterLike.value,
    collection: fields.designsFilterCollection.value,
    comment: fields.designsFilterComment.value,
    favoriteAuthor: fields.designsFilterFavoriteAuthor.value
  };
}

function setDesignFilterFields(filters) {
  fields.designsFilterFrom.value = filters.from || '';
  fields.designsFilterTo.value = filters.to || '';
  fields.designsFilterLike.value = filters.like || 'all';
  fields.designsFilterCollection.value = filters.collection || 'all';
  fields.designsFilterComment.value = filters.comment || 'all';
  fields.designsFilterFavoriteAuthor.value = filters.favoriteAuthor || 'all';
}

function designFiltersAreActive(filters = state.designs.filters) {
  return Boolean(filters?.from || filters?.to
    || filters?.like !== 'all'
    || filters?.collection !== 'all'
    || filters?.comment !== 'all'
    || filters?.favoriteAuthor !== 'all');
}

function updateDesignFilterButton() {
  $('#toggle-design-filters').classList.toggle('is-active', designFiltersAreActive());
}

async function showSchedulePreview() {
  const result = await api('/api/schedule/preview');
  if (!result.ok) {
    toast(errorMessage(result.error, result));
    return;
  }

  state.schedule.items = [...(result.items || [])]
    .sort((left, right) => new Date(left.runAt).getTime() - new Date(right.runAt).getTime());
  renderScheduleTaskOptions();
  renderScheduleItems();

  fields.scheduleModal.hidden = false;
}

function renderScheduleTaskOptions() {
  const taskTypes = new Map();
  for (const item of state.schedule.items) {
    const taskId = item.taskId || 'task';
    if (!taskTypes.has(taskId)) taskTypes.set(taskId, scheduleTaskTypeText(taskId, item.label));
  }

  if (state.schedule.taskId !== 'all' && !taskTypes.has(state.schedule.taskId)) {
    state.schedule.taskId = 'all';
  }

  fields.scheduleTaskFilter.replaceChildren(new Option('Todas', 'all'));
  for (const [taskId, label] of [...taskTypes.entries()].sort((left, right) => left[1].localeCompare(right[1], 'es'))) {
    fields.scheduleTaskFilter.add(new Option(label, taskId));
  }
  fields.scheduleTaskFilter.value = state.schedule.taskId;
  fields.scheduleStatusFilter.value = state.schedule.status;
}

function renderScheduleItems() {
  fields.scheduleList.innerHTML = '';
  const visibleItems = state.schedule.items.filter((item) => (
    (state.schedule.status === 'all' || scheduleFilterStatus(item.status) === state.schedule.status)
    && (state.schedule.taskId === 'all' || (item.taskId || 'task') === state.schedule.taskId)
  ));

  if (!visibleItems.length) {
    fields.scheduleList.innerHTML = `<p class="muted">${state.schedule.items.length
      ? 'No hay ejecuciones que coincidan con los filtros.'
      : 'No hay ejecuciones programadas.'}</p>`;
    return;
  }

  for (const item of visibleItems) {
    const row = document.createElement('div');
    row.className = `schedule-item schedule-${item.taskId || 'task'} schedule-${item.status || 'pending'}`;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(item.label || 'Tarea')}</strong>
        <span>${escapeHtml(item.detail || '')}</span>
      </div>
      <div class="schedule-time">
        <strong>${formatTime(item.runAt)}</strong>
        <span class="schedule-badge schedule-badge-${item.status || 'pending'}">${scheduleStatusText(item.status)}</span>
      </div>
    `;
    fields.scheduleList.append(row);
  }
}

function scheduleFilterStatus(status) {
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function scheduleTaskTypeText(taskId, fallback = 'Tarea') {
  return ({
    creality: 'Check-in diario',
    finishPrint: 'Enviar una impresión',
    modelDownloads: 'Descarga de diseños',
    comments: 'Comentarios',
    modelBoosts: 'Impulsar diseños',
    modelLikes: 'Dar me gusta',
    modelCollections: 'Añadir a la colección'
  })[taskId] || fallback || 'Tarea';
}

async function runCheckinWithProgress() {
  await runWithProgress({
    title: 'Check-in diario',
    steps: ['Abriendo el navegador...', 'Haciendo check-in', 'Resultado'],
    activeMessage: 'Accediendo al perfil y realizando el check-in...',
    endpoint: '/api/tasks/creality/run'
  });
}

async function loadModelCategories() {
  if (state.modelCategories.available.length) {
    renderModelCategoryOptions();
    return;
  }

  const result = await api('/api/tasks/model-downloads/categories');
  if (!result.ok) {
    toast(result.message || result.error || 'No se pudieron cargar las categorías del catálogo.');
    return;
  }
  state.modelCategories.available = Array.isArray(result.categories) ? result.categories : [];
  const availableNames = new Set(state.modelCategories.available.map((category) => category.name));
  state.modelCategories.selected = state.modelCategories.selected.filter((name) => availableNames.has(name));
  renderModelCategoryOptions();
}

function renderModelCategoryOptions() {
  if (!fields.modelsCategoryOptions || !fields.modelsCategorySummary) return;
  fields.modelsCategoryOptions.innerHTML = state.modelCategories.available.map((category, index) => {
    const checked = state.modelCategories.selected.includes(category.name) ? ' checked' : '';
    return `
      <label class="models-category-option" for="models-category-${index}">
        <input id="models-category-${index}" type="checkbox" value="${escapeHtml(category.name)}"${checked}>
        <span>${escapeHtml(category.name)}</span>
      </label>
    `;
  }).join('');
  renderModelCategorySummary();
}

function renderModelCategorySummary() {
  const count = state.modelCategories.selected.length;
  fields.modelsCategorySummary.textContent = count === 0
    ? 'Todas las categorías'
    : count === 1
      ? state.modelCategories.selected[0]
      : `${count} categorías seleccionadas`;
}

async function runModelsWithProgress() {
  if (!(await saveConfig({ includeModels: true }))) return;
  fields.modelsConfigModal.hidden = true;
  await runWithProgress({
    title: 'Descubrir diseños',
    steps: ['Abriendo el catálogo...', 'Descargando diseños', 'Resultado'],
    activeMessage: 'Buscando modelos nuevos y descargando archivos...',
    endpoint: '/api/tasks/model-downloads/run',
    body: { test: true },
    after: async () => loadDesigns(1)
  });
}

async function runLikesWithProgress() {
  const button = $('#run-likes-now');
  if (button.disabled) return;
  if (!(await saveConfig({ includeLikes: true }))) return;
  button.disabled = true;
  fields.likesConfigModal.hidden = true;
  try {
    await runWithProgress({
      title: 'Dar me gusta',
      steps: ['Abriendo el diseño...', 'Marcando me gusta', 'Resultado'],
      activeMessage: 'Buscando un diseño y marcándolo con me gusta...',
      endpoint: '/api/tasks/model-likes/run',
      body: { test: true },
      after: async () => loadDesigns(state.designs.page)
    });
  } finally {
    button.disabled = state.scheduler?.running === true;
  }
}

async function runCollectionsWithProgress() {
  fields.collectionsConfigModal.hidden = true;
  await runWithProgress({
    title: 'Añadir a la colección',
    steps: ['Abriendo el diseño...', 'Añadiendo a la colección', 'Resultado'],
    activeMessage: 'Buscando un diseño pendiente y añadiéndolo a la colección...',
    endpoint: '/api/tasks/model-collections/run',
    body: { test: true },
    after: async () => loadDesigns(state.designs.page)
  });
}

async function runWithProgress({ title, steps, activeMessage, endpoint, body, after }) {
  fields.runProgressModal.hidden = false;
  $('#run-progress-title').textContent = title;
  $('#progress-open').textContent = steps[0];
  $('#progress-checkin').textContent = steps[1];
  $('#progress-result').textContent = steps[2];
  setProgress('open', 'active');
  setProgress('checkin', 'pending');
  setProgress('result', 'pending');
  $('#progress-message').textContent = 'Preparando ejecución manual...';

  await pause(500);
  setProgress('open', 'done');
  setProgress('checkin', 'active');
  $('#progress-message').textContent = activeMessage;

  const result = await api(endpoint, { method: 'POST', body });

  setProgress('checkin', result.ok ? 'done' : 'error');
  setProgress('result', result.ok ? 'done' : 'error');
  $('#progress-message').textContent = result.ok
    ? result.message || result.result?.message || 'Ejecución terminada correctamente.'
    : result.message || result.error || 'La ejecución ha fallado.';
  await refresh();
  if (result.ok && after) await after();
}

async function openCrealityViewer() {
  const viewer = window.open('about:blank', '_blank');
  if (!viewer) {
    toast('El navegador ha bloqueado la ventana emergente. Permite popups para abrir el visor remoto.');
    return;
  }

  viewer.document.write('<!doctype html><title>CC Tools</title><body style="margin:0;background:#0b0d10;color:#f4f7f6;font-family:system-ui;display:grid;place-items:center;height:100vh">Preparando Creality Cloud...</body>');

  const viewerWarmup = fetch(`/novnc/vnc.html?preflight=${Date.now()}`, {
    cache: 'no-store',
    credentials: 'same-origin'
  }).catch(() => null);
  const result = await api('/api/tasks/creality/login/open', { method: 'POST' });
  if (result.ok) {
    await viewerWarmup;
    viewer.location.href = result.url;
    retryViewerConnection(viewer, result.url);
    toast('Creality Cloud abierto en el visor remoto.');
  } else {
    viewer.close();
    toast(result.error);
  }
}

function showView(view) {
  state.activeView = view;
  for (const section of $$('.view')) {
    section.classList.toggle('is-visible', section.id === `view-${view}`);
  }
  for (const button of ['home', 'designs', 'settings', 'logs']) {
    $(`#nav-${button}`)?.classList.toggle('is-active', button === view);
  }
  if (view === 'logs') refreshLiveCounters().catch(() => {});
}

function retryViewerConnection(viewer, url) {
  let checks = 0;
  let reloads = 0;
  let lastReloadAt = 0;

  const checkConnection = () => {
    if (viewer.closed) return;
    checks += 1;
    try {
      const status = viewer.document.querySelector('#noVNC_status')?.textContent?.trim() || '';
      const stalled = /conectando|connecting|desconectado|disconnected|fall[oó]|failed|error/i.test(status);
      if (!stalled) return;

      const now = Date.now();
      if (reloads < 2 && now - lastReloadAt >= 5000) {
        const retryUrl = new URL(url, window.location.href);
        retryUrl.searchParams.set('retry', String(now));
        reloads += 1;
        lastReloadAt = now;
        viewer.location.replace(retryUrl.href);
      }
    } catch {
      // The viewer may still be navigating; keep checking until its document is available.
    }

    if (checks < 10) window.setTimeout(checkConnection, 2500);
  };

  window.setTimeout(checkConnection, 4000);
}

function showSettingsTab(tab) {
  state.activeSettingsTab = tab;
  for (const button of $$('.tab-button')) {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  }
  for (const panel of $$('.tab-panel')) {
    panel.classList.toggle('is-visible', panel.id === `tab-${tab}`);
  }
}

function render() {
  const checkin = state.config.tasks.creality;
  const finishPrint = state.config.tasks.finishPrint;
  const models = state.config.tasks.modelDownloads;
  const comments = state.config.tasks.comments;
  const boosts = state.config.tasks.modelBoosts;
  const likes = state.config.tasks.modelLikes;
  const collections = state.config.tasks.modelCollections;
  renderPointsCounter(state.config.points || {});
  renderShopGoal(state.config.shopGoal || {});
  renderShopOrders(state.config.shopOrders || {});
  renderCrealityProfile(state.config.crealityProfile || {});
  renderFavoriteProfiles(state.config.crealityFavorites || []);
  renderDesignFavoriteAuthorFilter(state.config.crealityFavorites || []);

  renderLastExecution(fields.lastRun, checkin);
  fields.crealityEnabled.checked = checkin.enabled;
  fields.windowStart.value = checkin.windowStart;
  fields.windowEnd.value = checkin.windowEnd;
  renderTimezoneOptions(state.config.timezone || checkin.timezone || 'Europe/Madrid');
  renderDailyCounters();

  renderLastExecution(fields.finishPrintLastRun, finishPrint);
  fields.finishPrintEnabled.checked = finishPrint.enabled;
  fields.finishPrintEnabled.disabled = false;
  fields.finishPrintEnabled.closest('label').title = 'Activar envío de impresiones';
  renderLastExecution(fields.modelsLastRun, models);
  fields.modelsEnabled.checked = models.enabled;
  fields.modelsWindowStart.value = models.windowStart;
  fields.modelsWindowEnd.value = models.windowEnd;
  fields.modelsDailyLimit.value = models.dailyLimit;
  fields.modelsMinInterval.value = Math.max(10, Number(models.minIntervalMinutes) || 10);
  fields.modelsDownloadsPath.value = state.runtimePaths.downloads || 'data/temp-downloads';
  fields.modelsCleanupHours.value = Math.min(168, Math.max(1, Number(models.cleanupAfterHours) || 1));
  fields.modelsPrioritizeFavorites.checked = models.prioritizeFavorites !== false;
  state.modelCategories.selected = Array.isArray(models.catalogCategories)
    ? [...models.catalogCategories]
    : [];
  renderModelCategoryOptions();
  renderLastExecution(fields.commentsLastRun, comments);
  fields.commentsEnabled.checked = comments.enabled;
  fields.commentsWindowStart.value = comments.windowStart || '08:00';
  fields.commentsWindowEnd.value = comments.windowEnd || '20:00';
  fields.commentsPrioritizeFavorites.checked = comments.prioritizeFavorites !== false;
  fields.commentsImageLimit.value = Math.min(5, Math.max(0, Number(comments.imageDailyLimit) || 0));
  fields.commentsTextLimit.value = Math.min(1, Math.max(0, Number(comments.textDailyLimit) || 0));
  fields.commentsMinInterval.value = Math.max(10, Number(comments.minIntervalMinutes) || 10);
  renderLastExecution(fields.boostsLastRun, boosts);
  fields.boostsEnabled.checked = boosts.enabled;
  fields.boostsWindowStart.value = boosts.windowStart || '08:00';
  fields.boostsWindowEnd.value = boosts.windowEnd || '12:00';
  fields.boostsFavoritesOnly.checked = boosts.favoriteOnly !== false;
  $('#run-boosts-now').disabled = Math.max(0, Number(boosts.availableBoosts) || 0) <= 0
    || Math.max(0, Number(state.dailyCounters.modelBoosts) || 0) >= 1;
  renderLastExecution(fields.likesLastRun, likes);
  fields.likesEnabled.checked = likes.enabled;
  fields.likesWindowStart.value = likes.windowStart;
  fields.likesWindowEnd.value = likes.windowEnd;
  fields.likesPrioritizeFavorites.checked = likes.prioritizeFavorites !== false;
  $('#run-likes-now').disabled = state.scheduler?.running === true;
  renderLastExecution(fields.collectionsLastRun, collections);
  fields.collectionsEnabled.checked = collections.enabled;
  fields.collectionsWindowStart.value = collections.windowStart;
  fields.collectionsWindowEnd.value = collections.windowEnd;
  renderDailyCounters();
  renderNextExecutions();

  fields.telegramEnabled.checked = state.config.telegram.enabled;
  fields.telegramChat.value = state.config.telegram.chatId || '';
  fields.telegramToken.placeholder = state.config.telegram.botToken ? state.config.telegram.botToken : '';
  fields.notifySuccess.checked = state.config.telegram.notifyOnSuccess !== false;
  fields.notifyError.checked = state.config.telegram.notifyOnError !== false;
  fields.notifyDesignDownload.checked = state.config.telegram.notifyOnDesignDownload !== false;
  fields.notifyDesignError.checked = state.config.telegram.notifyOnDesignError !== false;
  fields.notifyModelLike.checked = state.config.telegram.notifyOnModelLike !== false;
  fields.notifyModelLikeError.checked = state.config.telegram.notifyOnModelLikeError !== false;
  fields.notifyFinishPrint.checked = state.config.telegram.notifyOnFinishPrint !== false;
  fields.notifyFinishPrintError.checked = state.config.telegram.notifyOnFinishPrintError !== false;
  fields.notifyComment.checked = state.config.telegram.notifyOnComment !== false;
  fields.notifyCommentError.checked = state.config.telegram.notifyOnCommentError !== false;
  fields.notifyModelBoost.checked = state.config.telegram.notifyOnModelBoost !== false;
  fields.notifyModelBoostError.checked = state.config.telegram.notifyOnModelBoostError !== false;
  fields.notifyShopRedemption.checked = state.config.telegram.notifyOnShopRedemption !== false;
  fields.notifyShopRedemptionError.checked = state.config.telegram.notifyOnShopRedemptionError !== false;
  fields.notifyShopOrderShipped.checked = state.config.telegram.notifyOnShopOrderShipped !== false;
  syncNotificationMasters();

  renderRuns();
  renderHealthSummary();
}

function renderNextExecutions() {
  const next = state.nextExecutions || {};
  const checkinCompletedToday = (Number(state.dailyCounters?.creality) || 0) > 0;
  fields.nextRun.textContent = checkinCompletedToday
    ? formatDateOnly(next.creality)
    : formatDate(next.creality);
  fields.finishPrintNextRun.textContent = formatDate(next.finishPrint);
  fields.modelsNextRun.textContent = formatDate(next.modelDownloads);
  fields.commentsNextRun.textContent = formatDate(next.comments);
  fields.boostsNextRun.textContent = formatDate(next.modelBoosts);
  fields.likesNextRun.textContent = formatDate(next.modelLikes);
  fields.collectionsNextRun.textContent = formatDate(next.modelCollections);
}

function renderLastExecution(node, task = {}) {
  node.textContent = formatDate(task.lastRunAt);
  node.classList.toggle('is-success', task.lastStatus === 'success');
  node.classList.toggle('is-error', ['failed', 'error'].includes(task.lastStatus));
}

function renderTimezoneOptions(selectedTimezone = 'Europe/Madrid') {
  const preferred = ['Europe/Madrid', 'Atlantic/Canary', 'UTC'];
  let supported = [];
  try {
    supported = typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [];
  } catch {
    supported = [];
  }

  const selected = String(selectedTimezone || 'Europe/Madrid');
  const preferredSet = new Set(preferred);
  const allZones = [...new Set([...preferred, selected, ...supported])];
  const remaining = allZones
    .filter((timezone) => !preferredSet.has(timezone))
    .sort((left, right) => left.localeCompare(right));
  fields.sessionTimezone.innerHTML = [
    `<optgroup label="Zonas habituales">${preferred.map(timezoneOption).join('')}</optgroup>`,
    `<optgroup label="Todas las zonas">${remaining.map(timezoneOption).join('')}</optgroup>`
  ].join('');
  fields.sessionTimezone.value = selected;
}

function timezoneOption(timezone) {
  return `<option value="${escapeHtml(timezone)}">${escapeHtml(timezone)}</option>`;
}

function notificationSuccessFields() {
  return [
    fields.notifySuccess,
    fields.notifyDesignDownload,
    fields.notifyModelLike,
    fields.notifyFinishPrint,
    fields.notifyComment,
    fields.notifyModelBoost,
    fields.notifyShopRedemption,
    fields.notifyShopOrderShipped
  ];
}

function notificationErrorFields() {
  return [
    fields.notifyError,
    fields.notifyDesignError,
    fields.notifyModelLikeError,
    fields.notifyFinishPrintError,
    fields.notifyCommentError,
    fields.notifyModelBoostError,
    fields.notifyShopRedemptionError
  ];
}

function setNotificationGroup(group, checked) {
  for (const field of group) field.checked = checked;
}

function syncNotificationMasters() {
  syncNotificationMaster(fields.notifyAllSuccess, notificationSuccessFields());
  syncNotificationMaster(fields.notifyAllError, notificationErrorFields());
}

function syncNotificationMaster(master, group) {
  const checkedCount = group.filter((field) => field.checked).length;
  master.checked = checkedCount === group.length;
  master.indeterminate = checkedCount > 0 && checkedCount < group.length;
}

function renderPointsCounter(points) {
  const total = typeof points.total === 'number' ? points.total : Number.NaN;
  const hasTotal = Number.isFinite(total);
  const timezone = state.config.timezone || state.config.tasks.creality.timezone || 'Europe/Madrid';
  const today = localDateKey(new Date(), timezone);
  const earnedToday = (Array.isArray(points.transactions) ? points.transactions : [])
    .filter((transaction) => transaction?.date === today && Number(transaction?.amount) > 0)
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  fields.pointsTotal.textContent = hasTotal ? new Intl.NumberFormat('es-ES').format(total) : '-';
  fields.pointsToday.textContent = `+${new Intl.NumberFormat('es-ES').format(earnedToday)}`;
  fields.pointsCounter.classList.toggle('is-stale', points.status === 'stale');
  const goal = state.config?.shopGoal || {};
  const goalPoints = Number(goal.points);
  const goalProgress = goal.productId && Number.isFinite(total) && goalPoints > 0
    ? Math.min(100, Math.max(0, total / goalPoints * 100))
    : 0;
  fields.pointsCounter.classList.toggle('has-goal', Boolean(goal.productId && goalPoints > 0));
  fields.pointsGoalProgress.style.width = `${goalProgress}%`;
  const updated = points.updatedAt ? formatDate(points.updatedAt) : 'pendiente de la primera comprobación';
  fields.pointsCounter.title = `Puntos de Creality Cloud · actualizado ${updated}`;
  fields.pointsCounter.setAttribute(
    'aria-label',
    hasTotal ? `${total} puntos totales, ${earnedToday} sumados hoy` : 'Puntos pendientes de comprobación'
  );
}

function renderShopGoal(goal = {}) {
  if (!state.shopGoalInitialized) {
    state.selectedShopRegion = goal.productId ? (goal.region || 'ES') : '';
    state.selectedShopProductId = goal.productId || '';
    state.shopGoalInitialized = true;
  }
  const catalog = state.shopCatalog;
  const storedProduct = goal.productId ? {
    id: goal.productId,
    name: goal.name,
    imageUrl: goal.imageUrl,
    points: goal.points,
    available: goal.available !== false
  } : null;
  const options = [...catalog];
  if (storedProduct
    && state.selectedShopProductId === storedProduct.id
    && !options.some((item) => item.id === storedProduct.id)) options.push(storedProduct);
  fields.pointsShopProduct.innerHTML = [
    '<option value="">Selecciona tu objetivo</option>',
    ...options.map((product) => `<option value="${escapeHtml(product.id)}" ${product.id === state.selectedShopProductId ? 'selected' : ''}>${escapeHtml(product.name)} · ${formatPoints(product.points)} puntos${product.available === false ? ' · No disponible' : ''}</option>`)
  ].join('');
  const selectedRegion = state.shopRegions.find((region) => region.code === state.selectedShopRegion);
  fields.pointsShopRegionValue.innerHTML = selectedRegion ? `
    ${selectedRegion.imageUrl ? `<span class="points-shop-region-flag"><img src="${escapeHtml(selectedRegion.imageUrl)}" alt=""></span>` : ''}
    <span>${escapeHtml(selectedRegion.code)}</span>
  ` : '<span>Región</span>';
  fields.pointsShopRegionMenu.innerHTML = state.shopRegions.map((region) => `
    <button class="points-shop-region-option" type="button" role="option" data-shop-region="${escapeHtml(region.code)}" aria-selected="${region.code === state.selectedShopRegion}">
      ${region.imageUrl ? `<span class="points-shop-region-flag"><img src="${escapeHtml(region.imageUrl)}" alt=""></span>` : '<span class="points-shop-region-image-placeholder"></span>'}
      <span>${escapeHtml(region.code)}</span>
    </button>
  `).join('');
  const selected = options.find((item) => item.id === state.selectedShopProductId)
    || (state.selectedShopProductId === storedProduct?.id ? storedProduct : null);
  const scheduledForSelected = Boolean(goal.enabled
    && selected
    && goal.productId === selected.id
    && (goal.region || 'ES') === (state.selectedShopRegion || 'ES'));
  const currentPoints = Number(state.config?.points?.total);
  const requiredPoints = Number(selected?.points);
  const goalProgress = scheduledForSelected && Number.isFinite(currentPoints) && requiredPoints > 0
    ? Math.min(100, Math.max(0, currentPoints / requiredPoints * 100))
    : 0;
  const goalProgressLabel = `${Math.round(goalProgress)}%`;
  fields.programPointsShopGoal.disabled = !selected || selected.available === false || !state.selectedShopRegion;
  fields.pointsShopProductPreview.hidden = !selected;
  fields.pointsShopProductPreview.innerHTML = selected ? `
    ${selected.imageUrl ? `<img src="${escapeHtml(selected.imageUrl)}" alt="">` : '<span class="points-shop-product-placeholder"></span>'}
    <div class="points-shop-product-preview-details">
      <strong>${escapeHtml(selected.name)}</strong>
      ${scheduledForSelected ? `
        <div class="points-shop-goal-progress" role="progressbar" aria-label="Progreso del objetivo" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(goalProgress)}">
          <span class="points-shop-goal-progress-fill" style="width: ${goalProgress}%"></span>
          <span class="points-shop-goal-progress-label">${goalProgressLabel}</span>
          <span class="points-shop-goal-progress-points ${goalProgress > 50 ? 'is-over-half' : ''}">${formatPoints(selected.points)} puntos</span>
        </div>
      ` : ''}
      ${scheduledForSelected ? '' : `<span class="points-shop-product-points">${formatPoints(selected.points)} puntos</span>`}
    </div>
    ${scheduledForSelected ? `
      <div class="points-shop-schedule-actions">
        <span class="points-shop-scheduled-icon" title="Canje programado" aria-label="Canje programado"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM232 120c0-13.3 10.7-24 24-24s24 10.7 24 24V243.2l71.1 47.4c11 7.4 14 22.3 6.7 33.3s-22.3 14-33.3 6.7l-81.8-54.5c-6.7-4.5-10.7-12-10.7-20V120z"/></svg></span>
        <button class="points-shop-cancel-goal" type="button" data-cancel-shop-goal title="Eliminar programación" aria-label="Eliminar programación del canje"><svg viewBox="0 0 448 512" aria-hidden="true"><path d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32S433.7 32 416 32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 48 45H346.8c25.4 0 46.5-19.7 48-45L416 128z"/></svg></button>
      </div>
    ` : ''}
  ` : '';
  const status = goal.productId ? shopGoalStatusText(goal) : '';
  fields.pointsShopGoalStatus.hidden = !status;
  fields.pointsShopGoalStatus.textContent = status;
}

function renderShopOrders(value = {}) {
  const orders = (Array.isArray(value.items) ? value.items : []).filter((order) => !order.archived);
  if (!orders.length) {
    const message = value.lastStatus === 'error'
      ? 'No se pudieron actualizar los pedidos. Se conservará la última información disponible.'
      : 'No hay pedidos pendientes de seguimiento.';
    fields.pointsShopOrdersList.innerHTML = `<p class="points-shop-orders-empty">${escapeHtml(message)}</p>`;
    return;
  }

  fields.pointsShopOrdersList.innerHTML = orders.map((order) => `
    <article class="points-shop-order is-${escapeHtml(order.statusKind || 'neutral')}">
      ${order.imageUrl
        ? `<img class="points-shop-order-image" src="${escapeHtml(order.imageUrl)}" alt="">`
        : '<span class="points-shop-order-image points-shop-order-image-placeholder"></span>'}
      <div class="points-shop-order-details">
        <strong>${escapeHtml(order.title)}</strong>
        <span class="points-shop-order-price"><img src="/assets/points.png" alt="">${formatPoints(order.points)} puntos</span>
        ${order.statusKind === 'available' && order.useUrl
          ? `<a class="points-shop-order-status points-shop-order-status-link" href="${escapeHtml(order.useUrl)}" target="_blank" rel="noopener noreferrer" title="Usar ahora">
              <span>${escapeHtml(order.status)}</span>
              <svg viewBox="0 0 512 512" aria-hidden="true"><path d="M320 0c-17.7 0-32 14.3-32 32s14.3 32 32 32H402.7L201.4 265.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L448 109.3V192c0 17.7 14.3 32 32 32s32-14.3 32-32V32c0-17.7-14.3-32-32-32H320zM80 32C35.8 32 0 67.8 0 112V432c0 44.2 35.8 80 80 80H400c44.2 0 80-35.8 80-80V320c0-17.7-14.3-32-32-32s-32 14.3-32 32V432c0 8.8-7.2 16-16 16H80c-8.8 0-16-7.2-16-16V112c0-8.8 7.2-16 16-16H192c17.7 0 32-14.3 32-32s-14.3-32-32-32H80z"/></svg>
            </a>`
          : `<span class="points-shop-order-status">${escapeHtml(order.status)}</span>`}
      </div>
      ${order.statusKind === 'shipped' ? `
        <button class="points-shop-order-archive" type="button" data-archive-shop-order="${escapeHtml(order.id)}" title="Archivar pedido" aria-label="Archivar ${escapeHtml(order.title)}">
          <svg viewBox="0 0 448 512" aria-hidden="true"><path d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"/></svg>
        </button>
      ` : ''}
    </article>
  `).join('');
}

function setShopRegionMenu(open) {
  const shouldOpen = Boolean(open);
  fields.pointsShopRegionMenu.hidden = !shouldOpen;
  fields.pointsShopRegionTrigger.setAttribute('aria-expanded', String(shouldOpen));
}

function shopGoalStatusText(goal) {
  if (goal.lastStatus === 'success') return `Canje completado el ${formatDate(goal.redeemedAt)}.`;
  if (goal.lastStatus === 'unavailable') return 'Objetivo no disponible temporalmente. Se volverá a comprobar.';
  if (goal.lastStatus === 'error') return `Último intento: ${goal.lastMessage || 'no se pudo completar el canje'}`;
  if (goal.enabled) return '';
  return '';
}

function renderCrealityProfile(profile = {}) {
  const name = String(profile.name || '').trim();
  const avatarUrl = String(profile.avatarUrl || '').trim();
  const userId = String(profile.userId || '').trim();
  fields.crealityUserAvatar.title = name || 'Usuario de Creality Cloud';
  fields.crealityUserAvatar.setAttribute('aria-label', name
    ? `Usuario de Creality Cloud: ${name}`
    : 'Usuario de Creality Cloud');
  if (userId) {
    fields.crealityProfileLink.href = `https://www.crealitycloud.com/es/user/${encodeURIComponent(userId)}`;
    fields.crealityProfileLink.removeAttribute('aria-disabled');
  } else {
    fields.crealityProfileLink.removeAttribute('href');
    fields.crealityProfileLink.setAttribute('aria-disabled', 'true');
  }
  if (!avatarUrl) {
    fields.crealityUserAvatarImage.hidden = true;
    fields.crealityUserAvatarImage.removeAttribute('src');
    fields.crealityUserAvatarFallback.hidden = false;
    return;
  }
  if (fields.crealityUserAvatarImage.src !== avatarUrl) {
    fields.crealityUserAvatarImage.src = avatarUrl;
  }
  fields.crealityUserAvatarImage.hidden = false;
  fields.crealityUserAvatarFallback.hidden = true;
}

function renderFavoriteProfiles(profiles = []) {
  fields.favoriteProfilesList.innerHTML = profiles.map((profile) => {
    const name = String(profile.name || 'Perfil de Creality Cloud').trim();
    const initial = name.charAt(0).toLocaleUpperCase('es-ES') || '?';
    const avatar = profile.avatarUrl
      ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="" loading="lazy">`
      : '';
    const isDefault = profile.isDefault || String(profile.userId || '') === DEFAULT_FAVORITE_USER_ID;
    const remove = isDefault
      ? '<button class="favorite-profile-default" type="button" title="Perfil favorito predeterminado" aria-label="Perfil favorito predeterminado"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M241 87.1l15 20.7 15-20.7C296 52.5 336.2 32 378.9 32 452.4 32 512 91.6 512 165.1l0 2.6c0 112.2-139.9 242.5-212.9 298.2-12.4 9.4-27.6 14.1-43.1 14.1s-30.8-4.6-43.1-14.1C139.9 410.2 0 279.9 0 167.7l0-2.6C0 91.6 59.6 32 133.1 32 175.8 32 216 52.5 241 87.1z"/></svg></button>'
      : `<button class="favorite-profile-remove" type="button" data-remove-favorite="${escapeHtml(profile.userId)}" title="Eliminar de favoritos" aria-label="Eliminar ${escapeHtml(name)} de favoritos"><svg viewBox="0 0 448 512" aria-hidden="true"><path d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 48 45H346.8c25.4 0 46.5-19.7 48-45L416 128z"/></svg></button>`;
    const status = favoriteIndexStatus(profile.indexStatus);
    const indexedCount = Math.max(0, Number(profile.indexedModelCount) || 0);
    const lastIndexed = profile.lastModelIndexedAt ? formatShortDate(profile.lastModelIndexedAt) : '-';
    return `<article class="favorite-profile-card">
      <a class="favorite-profile-link" href="${escapeHtml(profile.profileUrl)}" target="_blank" rel="noreferrer">
        <span class="favorite-profile-avatar"><span>${escapeHtml(initial)}</span>${avatar}</span>
        <span class="favorite-profile-identity"><strong>${escapeHtml(name)}</strong><small>ID ${escapeHtml(profile.userId)}</small></span>
      </a>
      <div class="favorite-profile-metrics" aria-label="Estado del índice">
        <span class="favorite-profile-metric"><small>Estado</small><strong class="favorite-index-status is-${escapeHtml(status.key)}">${escapeHtml(status.label)}</strong></span>
        <span class="favorite-profile-metric"><small>Diseños</small><strong>${indexedCount}</strong></span>
        <span class="favorite-profile-metric"><small>Último diseño</small><strong>${escapeHtml(lastIndexed)}</strong></span>
      </div>
      ${remove}
    </article>`;
  }).join('');

  for (const image of fields.favoriteProfilesList.querySelectorAll('img')) {
    image.addEventListener('error', () => { image.hidden = true; });
  }
}

function favoriteIndexStatus(value) {
  return ({
    pending: { key: 'pending', label: 'Pendiente' },
    syncing: { key: 'syncing', label: 'Indexando' },
    ready: { key: 'ready', label: 'Actualizado' },
    error: { key: 'error', label: 'Error' }
  })[value] || { key: 'pending', label: 'Pendiente' };
}

async function addFavoriteProfile() {
  const url = fields.favoriteProfileUrl.value.trim();
  if (!url) {
    toast('Introduce la URL del perfil de Creality Cloud.');
    return;
  }

  const button = $('#add-favorite-profile');
  button.disabled = true;
  try {
    const result = await api('/api/creality/favorites', { method: 'POST', body: { url } });
    if (!result.ok) {
      toast(errorMessage(result.error, result));
      return;
    }
    state.config.crealityFavorites = result.favorites;
    fields.favoriteProfileUrl.value = '';
    renderFavoriteProfiles(result.favorites);
    toast('Perfil añadido a favoritos.');
  } finally {
    button.disabled = false;
  }
}

async function refreshFavoriteProfiles() {
  const button = $('#refresh-favorite-profiles');
  setFavoriteRefreshButtonLoading(true, 'Iniciando...');
  let started = false;
  try {
    const result = await api('/api/creality/favorites/refresh', { method: 'POST' });
    if (!result.ok) {
      toast(errorMessage(result.error, result));
      return;
    }
    state.config.crealityFavorites = result.favorites || [];
    state.favoriteProfilesRefreshRunning = true;
    renderFavoriteProfiles(state.config.crealityFavorites);
    started = true;
    setFavoriteRefreshButtonLoading(true);
    startFavoriteRefreshPolling();
    toast(result.alreadyRunning
      ? 'La actualización de perfiles continúa en segundo plano.'
      : 'Actualización de perfiles iniciada en segundo plano.');
  } finally {
    if (!started) setFavoriteRefreshButtonLoading(false);
  }
}

function startFavoriteRefreshPolling() {
  if (favoriteRefreshPollTimer) clearInterval(favoriteRefreshPollTimer);
  favoriteRefreshPollCount = 0;

  const poll = async () => {
    favoriteRefreshPollCount += 1;
    const result = await api('/api/status');
    if (!result.ok) return;

    const profiles = result.config?.crealityFavorites || [];
    state.config.crealityFavorites = profiles;
    renderFavoriteProfiles(profiles);
    const active = result.favoriteProfilesRefreshRunning === true;
    state.favoriteProfilesRefreshRunning = active;
    setFavoriteRefreshButtonLoading(active);
    if (!active || favoriteRefreshPollCount >= 600) {
      clearInterval(favoriteRefreshPollTimer);
      favoriteRefreshPollTimer = null;
      setFavoriteRefreshButtonLoading(false);
    }
  };

  favoriteRefreshPollTimer = setInterval(poll, 3000);
  poll().catch(() => {});
}

function setFavoriteRefreshButtonLoading(loading, label = 'Actualizando...') {
  const button = $('#refresh-favorite-profiles');
  button.disabled = loading;
  button.textContent = loading ? label : 'Actualizar';
  button.setAttribute('aria-busy', String(loading));
}

function setCrealityUserMenu(open) {
  fields.crealityUserMenu.hidden = !open;
  fields.crealityUserAvatar.setAttribute('aria-expanded', String(open));
  if (open) {
    fields.crealityUserMenu.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }
}

function renderPointsHistory(points = {}) {
  const timezone = state.config?.timezone || state.config?.tasks?.creality?.timezone || 'Europe/Madrid';
  const transactions = Array.isArray(points.transactions) ? points.transactions : [];
  const { periods, currentKey } = buildPointPeriods(state.pointsHistory.unit, state.pointsHistory.offset, timezone);
  const availableKeys = new Set(periods.map((period) => period.key));
  const selectedKey = availableKeys.has(state.pointsHistory.selectedKey)
    ? state.pointsHistory.selectedKey
    : currentKey;
  state.pointsHistory.selectedKey = selectedKey;
  const totals = Object.fromEntries(periods.map((period) => [period.key, 0]));
  const byTask = new Map();
  const legacyDoubleCheckins = legacyDoubleCheckinKeys(transactions);
  for (const transaction of transactions) {
    const amount = Number(transaction?.amount) || 0;
    const period = periods.find((candidate) => candidate.key === pointPeriodKey(transaction?.date, state.pointsHistory.unit));
    if (amount <= 0 || !period) continue;
    totals[period.key] += amount;
    if (period.key !== selectedKey) continue;
    const occurrenceKey = pointTransactionOccurrenceKey(transaction);
    const storedTask = legacyDoubleCheckins.has(occurrenceKey)
      && !transaction.sourceType
      && pointsTaskLabel(transaction.type) === 'Descargas realizadas'
      ? 'Check-in diario'
      : transaction.type || transaction.sourceType || 'Otros';
    const task = pointsTaskLabel(storedTask, amount);
    byTask.set(task, (byTask.get(task) || 0) + amount);
  }

  const max = Math.max(1, ...Object.values(totals));
  fields.pointsHistoryChart.innerHTML = periods.map((period) => {
    const amount = totals[period.key];
    const height = Math.max(4, Math.round((amount / max) * 100));
    return `<div class="points-history-bar ${period.key === currentKey ? 'is-current' : ''} ${period.key === selectedKey ? 'is-selected' : ''}" data-period-key="${escapeHtml(period.key)}" role="button" tabindex="0" title="${escapeHtml(period.title)}: ${formatPoints(amount)} puntos" aria-label="${escapeHtml(period.title)}: ${formatPoints(amount)} puntos">
      <div class="points-history-bar-value">${formatPoints(amount)}</div>
      <span style="height:${height}%"></span>
      <small>${escapeHtml(period.label)}</small>
    </div>`;
  }).join('');

  const rows = limitPointSummaryRows([...byTask.entries()].sort((left, right) => right[1] - left[1]));
  const selectedPeriod = periods.find((period) => period.key === selectedKey) || periods[periods.length - 1];
  fields.pointsSummaryPeriod.innerHTML = `<span>${escapeHtml(selectedPeriod.label)}</span><strong>+${formatPoints(totals[selectedKey])} pts</strong>`;
  fields.pointsTaskSummary.innerHTML = rows.length
    ? `<table class="points-summary-table"><tbody>${rows.map(([task, amount]) => `<tr><th scope="row">${escapeHtml(task)}</th><td>+${formatPoints(amount)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Todavía no hay movimientos de puntos disponibles.</p>';
  for (const button of $$('.points-unit-button')) {
    button.classList.toggle('is-active', button.dataset.pointsUnit === state.pointsHistory.unit);
  }
  $('#points-history-next').disabled = state.pointsHistory.offset >= 0;
}

function legacyDoubleCheckinKeys(transactions) {
  const groups = new Map();
  for (const transaction of transactions) {
    if (transaction?.sourceType || Number(transaction?.amount) <= 1) continue;
    const task = pointsTaskLabel(transaction?.type || 'Otros');
    if (task !== 'Check-in diario' && task !== 'Descargas realizadas') continue;
    const key = pointTransactionOccurrenceKey(transaction);
    const tasks = groups.get(key) || new Set();
    tasks.add(task);
    groups.set(key, tasks);
  }
  return new Set([...groups.entries()]
    .filter(([, tasks]) => tasks.has('Check-in diario') && tasks.has('Descargas realizadas'))
    .map(([key]) => key));
}

function pointTransactionOccurrenceKey(transaction = {}) {
  return `${transaction.date || ''}|${transaction.time || ''}|${Number(transaction.amount) || 0}`;
}

function limitPointSummaryRows(rows, maximum = 7) {
  if (rows.length <= maximum) return rows;
  const namedRows = rows.filter(([task]) => task !== 'Otros');
  const visibleRows = namedRows.slice(0, maximum - 1);
  const visibleTasks = new Set(visibleRows.map(([task]) => task));
  const otherAmount = rows.reduce((total, [task, amount]) => (
    visibleTasks.has(task) ? total : total + amount
  ), 0);
  return [...visibleRows, ['Otros', otherAmount]];
}

function pointsTaskLabel(value, amount = 0) {
  const task = String(value || '').replace(/\s+/g, ' ').trim();
  const normalized = task.toLowerCase();
  if (normalized === 'convert') return 'Conversión';
  if (normalized === 'add a device') return 'Añadir dispositivo';
  if (normalized === 'edit profile') return 'Completar perfil';
  if (normalized === 'upload models') return 'Subida de diseños';
  if (/lucky draw|lottery|loter[ií]a|raffle/.test(normalized)) return 'Lotería';
  if (/model has received the support of|ha recibido el apoyo de|support of/.test(normalized) || /^(?:impulsos|impulsos recibidos)$/.test(normalized)) return 'Impulsos recibidos';
  if (/model has reached \d+ usage|ha alcanzado \d+ usos|reached \d+ usage|^descargas(?: de tus diseños| recibidas)?$/.test(normalized)) return 'Descargas recibidas';
  if (/^download models$|^descargas realizadas$/.test(normalized)) return 'Descargas realizadas';
  if (normalized === 'descarga de diseños') return Number(amount) > 1 ? 'Descargas recibidas' : 'Descargas realizadas';
  if (/download|descarga/.test(normalized)) return 'Descargas realizadas';
  if (/like|me gusta|favorite|favorito/.test(normalized)) return 'Dar me gusta';
  if (/comment|comentario/.test(normalized)) return 'Comentarios';
  if (/finish|print|impres|imprimir/.test(normalized)) return 'Enviar una impresión';
  if (/^model boost$|^impulsos dados$/.test(normalized)) return 'Impulsos dados';
  if (normalized === 'impulsar diseños') return Number(amount) > 1 ? 'Impulsos recibidos' : 'Impulsos dados';
  if (/boost|impuls/.test(normalized)) return 'Impulsos dados';
  if (/check.?in|checkin|registro diario/.test(normalized)) return 'Check-in diario';
  if (/collection|colecci/.test(normalized)) return 'Añadir a la colección';
  return task || 'Otros';
}

function buildPointPeriods(unit, offset, timezone) {
  const today = dateFromKey(localDateKey(new Date(), timezone));
  const currentStart = pointStart(today, unit);
  shiftPointPeriod(currentStart, unit, offset);
  const periods = Array.from({ length: 7 }, (_, index) => {
    const start = new Date(currentStart);
    shiftPointPeriod(start, unit, -(6 - index));
    const key = pointPeriodKey(localDateKey(start, timezone), unit);
    const end = new Date(start);
    shiftPointPeriod(end, unit, 1);
    end.setDate(end.getDate() - 1);
    return {
      key,
      label: pointPeriodLabel(start, unit, timezone),
      title: pointPeriodTitle(start, end, unit, timezone)
    };
  });
  return { periods, currentKey: pointPeriodKey(localDateKey(currentStart, timezone), unit) };
}

function pointPeriodKey(dateValue, unit) {
  if (!dateValue) return '';
  const date = dateFromKey(dateValue);
  return localDateKey(pointStart(date, unit), 'UTC');
}

function pointStart(date, unit) {
  const start = new Date(date);
  if (unit === 'weeks') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  } else if (unit === 'months') {
    start.setDate(1);
  } else if (unit === 'years') {
    start.setMonth(0, 1);
  }
  start.setHours(12, 0, 0, 0);
  return start;
}

function shiftPointPeriod(date, unit, amount) {
  if (unit === 'weeks') date.setDate(date.getDate() + amount * 7);
  else if (unit === 'months') date.setMonth(date.getMonth() + amount);
  else if (unit === 'years') date.setFullYear(date.getFullYear() + amount);
  else date.setDate(date.getDate() + amount);
}

function dateFromKey(value) {
  return new Date(`${value}T12:00:00`);
}

function pointPeriodLabel(start, unit, timezone) {
  let label;
  if (unit === 'years') label = new Intl.DateTimeFormat('es-ES', { timeZone: timezone, year: 'numeric' }).format(start);
  else if (unit === 'months') label = new Intl.DateTimeFormat('es-ES', { timeZone: timezone, month: 'short', year: '2-digit' }).format(start).replace('.', '');
  else if (unit === 'weeks') label = new Intl.DateTimeFormat('es-ES', { timeZone: timezone, day: '2-digit', month: 'short' }).format(start).replace('.', '');
  else label = new Intl.DateTimeFormat('es-ES', { timeZone: timezone, weekday: 'short', day: 'numeric' }).format(start).replace('.', '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function pointPeriodTitle(start, end, unit, timezone) {
  if (unit === 'years') return new Intl.DateTimeFormat('es-ES', { timeZone: timezone, year: 'numeric' }).format(start);
  if (unit === 'months') return new Intl.DateTimeFormat('es-ES', { timeZone: timezone, month: 'long', year: 'numeric' }).format(start);
  return `${formatPointsDate(localDateKey(start, timezone), timezone)} - ${formatPointsDate(localDateKey(end, timezone), timezone)}`;
}

function formatPoints(value) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value);
}

function formatPointsDate(date, timezone) {
  return new Intl.DateTimeFormat('es-ES', { timeZone: timezone, day: '2-digit', month: '2-digit' }).format(new Date(`${date}T12:00:00`));
}

function formatPointsChartDate(date, timezone) {
  return new Intl.DateTimeFormat('es-ES', { timeZone: timezone, weekday: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`)).replace('.', '');
}

function localDateKey(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function renderHealthSummary() {
  const health = state.healthMetrics || {};
  const paused = health.state === 'paused';
  const degraded = health.state === 'degraded';
  const status = paused ? 'Detenido' : degraded ? 'Intermitente' : 'Activo';
  const pauseDetail = paused && health.pausedUntil
    ? `Hasta ${formatDate(health.pausedUntil)}${health.pauseSource === 'retry-after' ? ' · indicado por Retry-After' : ''}`
    : paused ? (health.reason || '')
      : degraded ? 'Tasa de éxito inferior al 80%' : 'Automatizaciones disponibles';
  const attempts = Math.max(0, Number(health.attempts) || 0);
  const successes = Math.max(0, Number(health.successes) || 0);
  const incidents = Math.max(0, Number(health.failures) || 0);
  const uncredited = Math.max(0, Number(health.rewardNotCredited) || 0);

  fields.healthSummary.innerHTML = `
    <div class="health-cell health-state ${paused ? 'is-paused' : degraded ? 'is-degraded' : 'is-active'}">
      <span>Estado</span><strong>${escapeHtml(status)}</strong><small>${escapeHtml(pauseDetail)}</small>
      ${paused ? '<button class="health-resume-button" type="button" data-action="resume-automations">Reactivar</button>' : ''}
    </div>
    <div class="health-cell"><span>Éxito · 24 h</span><strong>${successes}/${attempts}</strong><small>${Math.max(0, Number(health.successRate) || 0)}%</small></div>
    <div class="health-cell"><span>Fallos · 24 h</span><strong>${incidents}</strong><small>Ejecuciones no completadas</small></div>
    <div class="health-cell"><span>Sin recompensa</span><strong>${uncredited}</strong><small>Acciones no acreditadas</small></div>
  `;
}

function renderRuns() {
  fields.runs.innerHTML = '';
  for (const run of state.latestRuns) {
    const item = document.createElement('article');
    item.className = `run run-${run.status}`;
    item.innerHTML = `
      <div>
        <strong>${taskLabel(run.taskId)} · ${labelStatus(run.status)}</strong>
        <span>${formatDate(run.finishedAt || run.createdAt)} · ${escapeHtml(run.source || '')}</span>
      </div>
      <p>${escapeHtml(run.message || '')}</p>
      ${renderRunDetails(run)}
      ${renderScreenshots(run.screenshots || [])}
    `;
    fields.runs.append(item);
  }

  if (!state.latestRuns.length) {
    fields.runs.innerHTML = '<p class="muted">Todavía no hay ejecuciones registradas.</p>';
  }
}

function renderDailyCounters() {
  if (!state.config) return;
  const tasks = state.config.tasks;
  renderDailyBadge(fields.crealityDailyBadge, state.dailyCounters.creality, 1);
  renderDailyBadge(fields.finishPrintDailyBadge, state.dailyCounters.finishPrint, tasks.finishPrint.totalDailyLimit || tasks.finishPrint.dailyLimit || 10);
  renderDailyBadge(fields.modelsDailyBadge, state.dailyCounters.modelDownloads, tasks.modelDownloads.dailyLimit);
  renderDailyBadge(fields.commentsDailyBadge, state.dailyCounters.comments, tasks.comments.dailyLimit || 0);
  renderDailyBadge(fields.boostsDailyBadge, state.dailyCounters.modelBoosts, tasks.modelBoosts.availableBoosts || 0);
  renderDailyBadge(fields.likesDailyBadge, state.dailyCounters.modelLikes, tasks.modelLikes.dailyLimit || 1);
  renderDailyBadge(fields.collectionsDailyBadge, state.dailyCounters.modelCollections, tasks.modelCollections.dailyLimit || 1);
}

function renderDailyBadge(node, count, max) {
  const safeCount = Math.max(0, Number(count) || 0);
  const safeMax = Math.max(0, Number(max) || 0);
  node.textContent = `${safeCount}/${safeMax}`;
  node.classList.toggle('is-complete', safeMax > 0 && safeCount >= safeMax);
}

function requiredModelWindowMinutes() {
  const dailyLimit = Math.max(0, Math.min(30, Number(fields.modelsDailyLimit.value) || 0));
  const minIntervalMinutes = Math.max(10, Number(fields.modelsMinInterval.value) || 10);
  return dailyLimit * (minIntervalMinutes + 2);
}

async function runCommentsWithProgress() {
  if (!(await saveConfig({ includeComments: true }))) return;
  fields.commentsConfigModal.hidden = true;
  await runWithProgress({
    title: 'Comentarios',
    steps: ['Abriendo el diseño...', 'Publicando comentario', 'Resultado'],
    activeMessage: 'Verificando su recompensa diaria...',
    endpoint: '/api/tasks/comments/run',
    after: async () => loadDesigns(1)
  });
}

async function runBoostsWithProgress() {
  if (!(await saveConfig({ includeModelBoosts: true }))) return;
  fields.boostsConfigModal.hidden = true;
  await runWithProgress({
    title: 'Impulsar diseños',
    steps: ['Consultando boletos...', 'Aplicando boost', 'Verificando recompensa y lotería'],
    activeMessage: 'Buscando diseños...',
    endpoint: '/api/tasks/model-boosts/run',
    after: async () => loadDesigns(1)
  });
}

function requiredFinishPrintWindowMinutes(records = []) {
  const dailyLimit = Math.max(0, Math.min(10, Number(fields.finishPrintDailyLimit.value) || 0));
  const minIntervalMinutes = Math.max(10, Number(fields.finishPrintMinInterval.value) || 10);
  const knownDurations = records
    .map((file) => Math.ceil(Math.max(0, Number(file?.printTime) || 0) / 60))
    .filter((minutes) => minutes > 0);
  const durationMinutes = knownDurations.length ? Math.max(...knownDurations) : 10;
  return dailyLimit * (durationMinutes + minIntervalMinutes + 5);
}

function adjustFinishPrintWindow(records = []) {
  const requiredMinutes = requiredFinishPrintWindowMinutes(records);
  if (requiredMinutes > 24 * 60) {
    toast(`La programación necesita ${requiredMinutes} minutos y no cabe en una ventana diaria. Reduce las impresiones, el intervalo o la duración de los archivos.`);
    return false;
  }
  if (finishPrintWindowDurationMinutes() >= requiredMinutes) return true;
  fields.finishPrintWindowEnd.value = addMinutesToClock(fields.finishPrintWindowStart.value, requiredMinutes);
  toast(`Necesitas al menos ${requiredMinutes} minutos de ventana. He ajustado la hora de fin.`);
  return true;
}

function finishPrintWindowDurationMinutes() {
  return windowDurationMinutes(fields.finishPrintWindowStart.value, fields.finishPrintWindowEnd.value);
}

function modelWindowDurationMinutes() {
  return windowDurationMinutes(fields.modelsWindowStart.value, fields.modelsWindowEnd.value);
}

function windowDurationMinutes(startValue, endValue) {
  const start = clockToMinutes(startValue);
  const end = clockToMinutes(endValue);
  let minutes = end - start;
  if (minutes <= 0) minutes += 24 * 60;
  return minutes;
}

function clockToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Math.min(23, Math.max(0, Number(match[1]))) * 60
    + Math.min(59, Math.max(0, Number(match[2])));
}

function addMinutesToClock(value, minutesToAdd) {
  const total = (clockToMinutes(value) + Math.max(0, Number(minutesToAdd) || 0)) % (24 * 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function renderDesigns() {
  fields.designsTableBody.innerHTML = '';
  for (const heading of $$('.designs-table th[data-design-sort-column]')) {
    const active = heading.dataset.designSortColumn === state.designs.sort.key;
    const direction = active ? state.designs.sort.direction : '';
    heading.setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
    const indicator = heading.querySelector('.design-sort-indicator');
    if (indicator) indicator.textContent = active ? (direction === 'asc' ? '↑' : '↓') : '↕';
    heading.querySelector('.design-sort-button')?.classList.toggle('is-active', active);
  }

  for (const design of state.designs.items) {
    const row = document.createElement('tr');
    row.classList.toggle('is-favorite-author', designBelongsToFavoriteAuthor(design));
    row.innerHTML = `
      <td>${formatShortDate(design.updatedAt || design.downloadedAt)}</td>
      <td><a href="${escapeHtml(design.url)}" target="_blank" rel="noreferrer">${escapeHtml(design.title || 'Diseño sin título')}</a></td>
      <td>${designAuthorCell(design)}</td>
      <td>${designCategoryCell(design)}</td>
      <td>${statusIcon('heart', design.likeCompleted, design.likeActionState, design.id, 'like')}</td>
      <td>${statusIcon('bookmark', design.collectionCompleted, design.collectionActionState, design.id, 'collection')}</td>
      <td>${commentStatusIcon(design.commentCompleted)}</td>
      <td>${boostStatusIcon(design.boostCount)}</td>
    `;
    fields.designsTableBody.append(row);
  }

  if (!state.designs.items.length) {
    const message = state.designs.query || designFiltersAreActive()
      ? 'No se encontraron diseños que coincidan con la búsqueda o los filtros.'
      : 'Todavía no hay diseños descargados.';
    fields.designsTableBody.innerHTML = `<tr><td colspan="8">${message}</td></tr>`;
  }

  fields.designsPage.textContent = `Página ${state.designs.page} de ${state.designs.totalPages}`;
  $('#designs-prev').disabled = state.designs.page <= 1;
  $('#designs-next').disabled = state.designs.page >= state.designs.totalPages;
}

function designBelongsToFavoriteAuthor(design = {}) {
  const authorId = String(design.ownerUserId || design.favoriteProfileId || '').trim();
  if (!authorId) return false;
  return (state.config?.crealityFavorites || [])
    .some((profile) => String(profile?.userId || '').trim() === authorId);
}

function renderDesignFavoriteAuthorFilter(profiles = []) {
  const selected = fields.designsFilterFavoriteAuthor.value
    || state.designs.filters?.favoriteAuthor
    || 'all';
  fields.designsFilterFavoriteAuthor.innerHTML = [
    '<option value="all">Todos</option>',
    ...profiles.map((profile) => `<option value="${escapeHtml(profile.userId)}">${escapeHtml(profile.name || `Perfil ${profile.userId}`)}</option>`)
  ].join('');
  fields.designsFilterFavoriteAuthor.value = profiles.some((profile) => profile.userId === selected) ? selected : 'all';
}

async function advanceWizard() {
  const active = $('.wizard-step.is-visible');
  const step = Number(active.dataset.wizardStep);

  if (step === 1) {
    const result = await api('/api/tasks/creality/login/close', { method: 'POST' });
    if (!result.ok) {
      toast(result.error);
      return;
    }
    profileRefreshAttempted = false;
    refreshSetupAccountData();
  }

  if (step === 2) {
    const saved = await saveWizardTelegram();
    if (!saved) return;
  }

  if (step === 3) {
    await completeWizard();
    return;
  }

  showWizardStep(step + 1);
}

async function saveWizardTelegram({ requireCredentials = false } = {}) {
  const token = $('#wizard-telegram-token').value.trim();
  const chatId = $('#wizard-telegram-chat').value.trim();
  const hasSavedToken = Boolean(state.config.telegram.botToken);

  if (!token && !chatId && !state.config.telegram.enabled && !requireCredentials) {
    return true;
  }

  if ((!token && !hasSavedToken) || !chatId) {
    toast('Introduce el Bot token y el Chat ID para configurar Telegram.');
    return false;
  }

  fields.telegramEnabled.checked = true;
  fields.telegramToken.value = token;
  fields.telegramChat.value = chatId;
  fields.notifySuccess.checked = true;
  fields.notifyError.checked = true;
  fields.notifyDesignDownload.checked = true;
  fields.notifyDesignError.checked = true;
  fields.notifyModelLike.checked = true;
  fields.notifyModelLikeError.checked = true;
  return saveConfig({ includeTelegram: true });
}

function maybeShowWizard() {
  if (!state.config.setup?.assistantCompleted) {
    $('#wizard-telegram-chat').value = fields.telegramChat.value;
    showWizardStep(1);
    fields.wizardModal.hidden = false;
  }
}

function showWizardStep(step) {
  for (const panel of $$('.wizard-step')) {
    panel.classList.toggle('is-visible', Number(panel.dataset.wizardStep) === step);
  }
  $('#wizard-next').textContent = step === 3 ? 'Finalizar' : 'Siguiente paso';
  if (step === 3) {
    launchWizardConfetti();
  }
}

function launchWizardConfetti() {
  const container = $('#wizard-confetti');
  if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  container.replaceChildren();
  const colors = ['#20bf55', '#72d572', '#f5b942', '#ffffff', '#31d47d'];
  for (let index = 0; index < 54; index += 1) {
    const piece = document.createElement('span');
    piece.style.setProperty('--confetti-x', `${Math.random() * 100}%`);
    piece.style.setProperty('--confetti-delay', `${Math.random() * 0.65}s`);
    piece.style.setProperty('--confetti-duration', `${1.8 + Math.random() * 1.5}s`);
    piece.style.setProperty('--confetti-drift', `${-70 + Math.random() * 140}px`);
    piece.style.setProperty('--confetti-rotation', `${180 + Math.random() * 540}deg`);
    piece.style.backgroundColor = colors[index % colors.length];
    container.append(piece);
  }
}

async function completeWizard() {
  const result = await api('/api/config', {
    method: 'PATCH',
    body: { setup: { assistantCompleted: true } }
  });
  if (result.ok) {
    state.config = result.config;
    if ((!state.config.crealityProfile?.userId || state.config.points?.historyComplete !== true)
      && !setupAccountRefreshPromise) {
      refreshSetupAccountData();
    }
  }
  fields.wizardModal.hidden = true;
}

function setProgress(step, status) {
  const node = $(`#progress-${step}`);
  node.classList.remove('is-active', 'is-done', 'is-error');
  if (status === 'active') node.classList.add('is-active');
  if (status === 'done') node.classList.add('is-done');
  if (status === 'error') node.classList.add('is-error');
}

function renderScreenshots(screenshots) {
  if (!screenshots.length) return '';
  return `<div class="screenshots">${screenshots.map((src) => `<a href="${src}" target="_blank" rel="noreferrer">Captura</a>`).join('')}</div>`;
}

function renderRunDetails(run) {
  const failures = run.details?.failures || [];
  const downloaded = run.details?.downloaded || [];
  const acted = run.details?.acted || [];
  const alreadyApplied = run.details?.alreadyApplied || [];
  const diagnostics = uniqueDiagnostics([
    ...(run.details?.diagnostics || []),
    ...(run.details?.incident ? [run.details.incident] : []),
    ...failures.map((failure) => failure.diagnostic).filter(Boolean)
  ]);
  const items = [];

  for (const failure of failures) {
    const title = escapeHtml(failure.title || 'Diseño desconocido');
    const error = escapeHtml(failure.error || 'Error desconocido');
    const linkLabel = run.taskId === 'favoriteProfiles' ? 'Abrir perfil' : 'Abrir modelo';
    const url = failure.url ? ` · <a href="${escapeHtml(failure.url)}" target="_blank" rel="noreferrer">${linkLabel}</a>` : '';
    items.push(`<li><strong>${title}</strong>: ${error}${url}</li>`);
  }

  for (const design of downloaded) {
    const title = escapeHtml(design.title || 'Diseño sin título');
    const url = design.url ? ` · <a href="${escapeHtml(design.url)}" target="_blank" rel="noreferrer">Abrir modelo</a>` : '';
    const meta = [];
    if (design.downloadMethod === '3mf-direct') meta.push('3MF directo');
    if (design.rewardStatus === 'unverified') meta.push('puntos no verificados');
    const suffix = meta.length ? ` <span class="muted">(${meta.map(escapeHtml).join(' · ')})</span>` : '';
    items.push(`<li><strong>${title}</strong>: descarga realizada${suffix}${url}</li>`);
  }

  for (const design of acted) {
    const title = escapeHtml(design.title || 'Diseño sin título');
    const url = design.url ? ` · <a href="${escapeHtml(design.url)}" target="_blank" rel="noreferrer">Abrir modelo</a>` : '';
    const reward = actionRewardText(design.rewardVerification);
    const rewardSuffix = reward ? ` <span class="muted">(${escapeHtml(reward)})</span>` : '';
    items.push(`<li><strong>${title}</strong>: ${actionDoneText(run.taskId)}${rewardSuffix}${url}</li>`);
  }

  for (const design of alreadyApplied) {
    const title = escapeHtml(design.title || 'Diseño sin título');
    const url = design.url ? ` · <a href="${escapeHtml(design.url)}" target="_blank" rel="noreferrer">Abrir modelo</a>` : '';
    items.push(`<li><strong>${title}</strong>: ya tenía el me gusta aplicado; se omitió${url}</li>`);
  }

  if (run.taskId === 'modelBoosts' && run.details?.raffle) {
    const prizes = Array.isArray(run.details.raffle.prizes) ? run.details.raffle.prizes.filter(Boolean) : [];
    const result = prizes.length ? prizes.join(', ') : run.details.raffle.status === 'no_tickets' ? 'Sin boletos disponibles' : 'Procesada';
    items.push(`<li><strong>Lotería</strong>: ${escapeHtml(result)}</li>`);
  }

  const resultDetails = items.length ? `<ul class="run-details">${items.join('')}</ul>` : '';
  return `${resultDetails}${renderDiagnostics(diagnostics)}`;
}

function renderDiagnostics(diagnostics) {
  if (!diagnostics.length) return '';
  return `<div class="diagnostic-list">${diagnostics.map((diagnostic) => {
    const responses = Array.isArray(diagnostic.responses) ? diagnostic.responses : [];
    const responseSummary = responses.length
      ? responses.map((response) => {
        const headers = Object.entries(response.headers || {})
          .map(([name, value]) => `${name}: ${value}`)
          .join(' · ');
        const timing = [response.startedAt, Number.isFinite(response.durationMs) ? `${response.durationMs} ms` : '']
          .filter(Boolean)
          .join(' · ');
        const requestBody = response.requestBody ? `\n  Envío: ${response.requestBody}` : '';
        const body = response.body ? `\n  Respuesta: ${response.body}` : '';
        return `${response.method || 'GET'} ${response.status} ${response.resourceType || 'request'} · ${response.url || ''}${timing ? `\n  ${timing}` : ''}${headers ? `\n  ${headers}` : ''}${requestBody}${body}`;
      }).join('\n')
      : '';
    const failedRequests = Array.isArray(diagnostic.failedRequests) ? diagnostic.failedRequests : [];
    const failedSummary = failedRequests.map((request) => {
      const requestBody = request.requestBody ? `\n  Envío: ${request.requestBody}` : '';
      return `${request.method || 'GET'} FALLÓ ${request.resourceType || 'request'} · ${request.url || ''}\n  ${request.error || 'Error de red'}${requestBody}`;
    }).join('\n');
    const progress = diagnostic.before?.found || diagnostic.after?.found
      ? `Incentivo: ${diagnostic.before?.found ? `${diagnostic.before.done}/${diagnostic.before.valid}` : 'no disponible'} → ${diagnostic.after?.found ? `${diagnostic.after.done}/${diagnostic.after.valid}` : 'no disponible'}`
      : '';
    const network = diagnostic.network
      ? `Red: ${diagnostic.network.code || 'SIN_CLASIFICAR'} · ${diagnostic.network.message || ''}\nCooldown confirmado: ${diagnostic.network.cooldownConfirmed ? 'sí' : 'no'}${diagnostic.network.retryAfter ? `\nRetry-After: ${diagnostic.network.retryAfter}` : ''}`
      : '';
    const actionEvidence = diagnostic.actionEvidence
      ? `Estado de la acción: ${JSON.stringify(diagnostic.actionEvidence)}`
      : '';
    const taskCompletion = diagnostic.taskCompletion
      ? `Confirmación de tarea: ${JSON.stringify(diagnostic.taskCompletion)}`
      : '';
    const technical = [
      formatTechnicalDetails(diagnostic.technical),
      progress,
      network,
      responseSummary,
      failedSummary,
      actionEvidence,
      taskCompletion,
      diagnostic.retryAfter ? `Retry-After: ${diagnostic.retryAfter}` : '',
      diagnostic.recovery ? `Recuperación: ${JSON.stringify(diagnostic.recovery)}` : ''
    ].filter(Boolean).join('\n');
    return `
      <section class="diagnostic-entry">
        <div><strong>Diagnóstico:</strong> ${escapeHtml(diagnostic.message || 'Error no identificado')}</div>
        <div class="diagnostic-meta">
          <code>${escapeHtml(diagnostic.code || 'UNKNOWN')}</code>
          <span>${escapeHtml(diagnostic.category || 'technical')}</span>
          ${diagnostic.systemic ? '<span>incidencia general</span>' : ''}
        </div>
        ${diagnostic.url ? `<a href="${escapeHtml(diagnostic.url)}" target="_blank" rel="noreferrer">Abrir página detectada</a>` : ''}
        ${technical ? `<details><summary>Datos técnicos</summary><pre>${escapeHtml(technical)}</pre></details>` : ''}
      </section>
    `;
  }).join('')}</div>`;
}

function uniqueDiagnostics(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value) return false;
    const key = `${value.code || ''}|${value.detectedAt || ''}|${value.url || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function api(url, options = {}) {
  const method = options.method || 'GET';
  const requestUrl = method === 'GET'
    ? `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`
    : url;
  const response = await fetch(requestUrl, {
    method,
    cache: 'no-store',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json().catch(() => ({ ok: false, error: 'Respuesta no válida.' }));
  return body;
}

function formatTechnicalDetails(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function apiWhenBrowserAvailable(url, options, button) {
  const text = button?.querySelector('span');
  const originalText = text?.textContent || '';
  const originalTitle = button?.title || '';
  while (!fields.finishPrintConfigModal.hidden && button?.isConnected) {
    const result = await api(url, options);
    if (result.error !== 'BROWSER_BUSY') {
      if (text) text.textContent = originalText;
      button.title = originalTitle;
      button.classList.remove('is-browser-waiting');
      return result;
    }
    if (text) text.textContent = 'Esperando...';
    button.title = 'Esperando a que termine la operación en curso';
    button.classList.add('is-browser-waiting');
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  button?.classList.remove('is-browser-waiting');
  return { ok: false, cancelled: true };
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(node.timer);
  node.timer = setTimeout(() => { node.hidden = true; }, 3500);
}

function errorMessage(error, payload = {}) {
  if (error === 'INVALID_TIMEZONE') {
    return 'La zona horaria no es válida. Usa un identificador como Europe/Madrid.';
  }
  if (error === 'WINDOW_TOO_SHORT') {
    return `Necesitas al menos ${payload.requiredMinutes || 0} minutos de ventana.`;
  }
  if (error === 'WINDOW_START_EQUALS_END') {
    return 'La hora de inicio y la hora de fin deben ser diferentes para programar el check-in.';
  }
  return ({
    FAVORITE_PROFILE_URL_INVALID: 'Introduce una URL válida de un perfil de Creality Cloud.',
    FAVORITE_PROFILE_IS_OWN: 'No puedes añadir tu propio perfil a favoritos.',
    FAVORITE_PROFILE_DUPLICATE: 'Este perfil ya está en favoritos.',
    SHOP_ORDER_NOT_ARCHIVABLE: 'Este pedido no se puede archivar todavía.',
    FAVORITE_PROFILE_NOT_FOUND: 'No se pudo encontrar ese perfil en Creality Cloud.',
    FAVORITE_PROFILE_DEFAULT: 'El perfil predeterminado no se puede eliminar.',
    FAVORITE_PROFILE_UNAVAILABLE: 'No se pudieron obtener los datos del perfil.',
    FINISH_PRINT_PRINTER_DUPLICATE: 'Cada impresora solo puede aparecer en un bloque.',
    FINISH_PRINT_PRINTER_REQUIRED: 'Selecciona una impresora en cada bloque.',
    FINISH_PRINT_PROFILE_PENDING: 'No puedes eliminar la impresora que tiene una impresión pendiente de verificar.',
    BROWSER_BUSY: 'Hay otra operación utilizando el navegador. Inténtalo de nuevo cuando termine.'
  })[error] || error || 'No se pudo completar la acción.';
}

function labelStatus(status) {
  return ({
    never: 'Sin ejecutar',
    success: 'Correcto',
    failed: 'Fallido',
    error: 'Error',
    skipped: 'Sin trabajo pendiente',
    started: 'Iniciado'
  })[status] || status || '-';
}

function taskLabel(taskId) {
  return ({
    creality: 'Check-in diario',
    finishPrint: 'Enviar una impresión',
    modelDownloads: 'Descarga de diseños',
    comments: 'Comentarios',
    modelBoosts: 'Impulsar diseños',
    modelLikes: 'Dar me gusta',
    modelCollections: 'Añadir a la colección',
    favoriteProfiles: 'Perfiles favoritos',
    shopRedemption: 'Canje de objetivo'
  })[taskId] || taskId || '-';
}

function actionDoneText(taskId) {
  return ({
    modelLikes: 'me gusta completado',
    modelCollections: 'añadido a la colección',
    comments: 'comentario publicado',
    modelBoosts: 'boost aplicado'
  })[taskId] || 'acción completada';
}

function statusIcon(type, completed, actionState = 'pending', designId = '', action = '') {
  const paths = {
    heart: 'M241 87.1l15 20.7 15-20.7C296 52.5 336.2 32 378.9 32 452.4 32 512 91.6 512 165.1l0 2.6c0 112.2-139.9 242.5-212.9 298.2-12.4 9.4-27.6 14.1-43.1 14.1s-30.8-4.6-43.1-14.1C139.9 410.2 0 279.9 0 167.7l0-2.6C0 91.6 59.6 32 133.1 32 175.8 32 216 52.5 241 87.1z',
    bookmark: 'M0 48C0 21.5 21.5 0 48 0h288c26.5 0 48 21.5 48 48v440c0 9-5 17.2-13 21.3s-17.6 3.4-24.9-1.8L192 400 37.9 507.5c-7.4 5.2-17 5.9-24.9 1.8S0 497 0 488V48z'
  };
  const warning = ['applied_uncredited', 'ambiguous'].includes(actionState);
  const className = completed ? 'is-done' : warning ? 'is-warning' : '';
  const title = actionState === 'manual_completed'
    ? 'Marcado manualmente como completado. Pulsa para dejarlo pendiente'
    : actionState === 'already_applied'
    ? 'Ya completado fuera de CC Tools'
    : completed
    ? 'Completado con recompensa. Pulsa para dejarlo pendiente'
    : warning ? 'Acción enviada sin recompensa; pulsa para cambiar el estado' : 'Pendiente. Pulsa para marcar como completado';
  return `<button class="design-status ${className}" type="button" data-design-id="${escapeHtml(designId)}" data-design-action="${action}" aria-pressed="${completed}" title="${title}" aria-label="${title}"><svg viewBox="0 0 ${type === 'bookmark' ? '384 512' : '512 512'}" aria-hidden="true"><path d="${paths[type]}"></path></svg></button>`;
}

function designAuthorCell(design = {}) {
  const author = String(design.author || '').trim();
  if (!author) return '<span class="design-author-missing">Desconocido</span>';
  const authorUrl = safeCrealityProfileUrl(design.authorUrl);
  return authorUrl
    ? `<a href="${escapeHtml(authorUrl)}" target="_blank" rel="noreferrer">${escapeHtml(author)}</a>`
    : escapeHtml(author);
}

function designCategoryCell(design = {}) {
  const category = String(design.category || '').trim();
  return category
    ? `<span class="design-category" title="${escapeHtml(category)}">${escapeHtml(category)}</span>`
    : '<span class="design-category-missing">-</span>';
}

function safeCrealityProfileUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const allowedHost = url.hostname === 'crealitycloud.com' || url.hostname.endsWith('.crealitycloud.com');
    return url.protocol === 'https:' && allowedHost && /^\/(?:[a-z]{2}\/)?user\/[^/]+\/?$/i.test(url.pathname)
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

function commentStatusIcon(completed) {
  const title = completed ? 'El diseño ha recibido un comentario' : 'El diseño no ha recibido ningún comentario';
  return `<span class="design-status is-static ${completed ? 'is-done' : ''}" title="${title}" aria-label="${title}"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M512 240c0 114.9-114.6 208-256 208c-37.1 0-72.3-6.4-104.1-17.9L34.8 510.7c-5.8 4-13.6 4.5-19.8 1.2S5.5 501.5 7.3 494.7l32.7-121.4C14.8 337.8 0 296.1 0 251.3V240C0 125.1 114.6 32 256 32s256 93.1 256 208z"></path></svg></span>`;
}

function boostStatusIcon(count) {
  const total = Math.max(0, Number(count) || 0);
  const title = total ? `Este diseño ha recibido ${total} boost${total === 1 ? '' : 's'}` : 'Este diseño todavía no ha recibido ningún boost';
  return `<span class="design-status boost-status-icon is-static ${total ? 'is-done' : ''}" title="${title}" aria-label="${title}"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M256 32C174 78 128 166 128 272v72l-56 56 40 40 64-40v56l48-32 32 56 32-56 48 32v-56l64 40 40-40-56-56v-72C384 166 338 78 256 32Zm0 112a48 48 0 1 1 0 96 48 48 0 0 1 0-96Z"></path></svg></span>`;
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatDateOnly(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short'
  }).format(new Date(value));
}

function formatShortDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function actionRewardText(verification = {}) {
  const label = ({
    credited: 'punto acreditado',
    not_credited: 'punto no acreditado',
    already_completed: 'recompensa diaria ya completada',
    unverified: 'recompensa no verificada',
    lottery_completed: 'lotería ejecutada',
    lottery_unverified: 'lotería no confirmada'
  })[verification.status] || '';
  const before = verification.before;
  const after = verification.after;
  const progress = before?.found && after?.found
    ? `${before.done}/${before.valid} → ${after.done}/${after.valid}`
    : '';
  return label && progress ? `${label}: ${progress}` : label;
}

function formatTime(value) {
  if (!value) return 'Sin programar';
  return new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function scheduleStatusText(status) {
  return ({
    done: 'Ejecutada',
    failed: 'Fallida',
    pending: 'Programada',
    waiting: 'Pendiente',
    disabled: 'Desactivada'
  })[status] || 'Programada';
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}
