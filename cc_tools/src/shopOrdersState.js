const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const SHOP_ORDERS_SCHEMA_VERSION = 2;

export function normalizeShopOrdersState(value = {}) {
  return {
    schemaVersion: Math.max(1, Number(value.schemaVersion) || 1),
    items: (Array.isArray(value.items) ? value.items : []).map(normalizeStoredOrder).filter(Boolean),
    updatedAt: String(value.updatedAt || ''),
    lastAttemptAt: String(value.lastAttemptAt || ''),
    lastStatus: String(value.lastStatus || 'never'),
    lastMessage: String(value.lastMessage || '')
  };
}

export function mergeShopOrdersState(value, orders, now = new Date()) {
  const previous = normalizeShopOrdersState(value);
  const previousById = new Map(previous.items.map((item) => [item.id, item]));
  const items = (Array.isArray(orders) ? orders : []).map(normalizeStoredOrder).filter(Boolean).map((order) => {
    const existing = previousById.get(order.id);
    const keepArchived = existing?.archived === true && existing.statusKey === order.statusKey;
    return {
      ...order,
      useUrl: order.useUrl || (existing?.statusKey === order.statusKey ? existing.useUrl : ''),
      archived: keepArchived,
      archivedAt: keepArchived ? existing.archivedAt : ''
    };
  }).sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''));

  return {
    schemaVersion: SHOP_ORDERS_SCHEMA_VERSION,
    items,
    updatedAt: now.toISOString(),
    lastAttemptAt: now.toISOString(),
    lastStatus: 'success',
    lastMessage: ''
  };
}

export function shippedShopOrderTransitions(previousValue, nextValue) {
  const previous = normalizeShopOrdersState(previousValue);
  const next = normalizeShopOrdersState(nextValue);
  const previousById = new Map(previous.items.map((item) => [item.id, item]));
  return next.items.filter((item) => previousById.get(item.id)?.statusKind === 'pending'
    && ['available', 'shipped'].includes(item.statusKind));
}

export function markShopOrdersRefreshError(value, error, now = new Date()) {
  const state = normalizeShopOrdersState(value);
  state.lastAttemptAt = now.toISOString();
  state.lastStatus = 'error';
  state.lastMessage = error?.message || String(error || 'No se pudieron actualizar los pedidos.');
  return state;
}

export function shopOrdersRefreshDue(value, now = new Date()) {
  const state = normalizeShopOrdersState(value);
  if (state.schemaVersion < SHOP_ORDERS_SCHEMA_VERSION) {
    const attemptedAt = Date.parse(state.lastAttemptAt);
    return !Number.isFinite(attemptedAt) || now.getTime() - attemptedAt >= RETRY_MS;
  }
  const updatedAt = Date.parse(state.updatedAt);
  if (Number.isFinite(updatedAt) && now.getTime() - updatedAt < DAY_MS) return false;
  const attemptedAt = Date.parse(state.lastAttemptAt);
  return !Number.isFinite(attemptedAt) || now.getTime() - attemptedAt >= RETRY_MS;
}

export function archiveShopOrder(value, orderId, now = new Date()) {
  const state = normalizeShopOrdersState(value);
  const order = state.items.find((item) => item.id === String(orderId || ''));
  if (!order || order.statusKind !== 'shipped') return null;
  order.archived = true;
  order.archivedAt = now.toISOString();
  return state;
}

function normalizeStoredOrder(value) {
  const id = String(value?.id || '').trim();
  const title = String(value?.title || '').trim();
  if (!id || !title) return null;
  const statusKind = ['pending', 'available', 'shipped', 'neutral'].includes(value.statusKind)
    ? value.statusKind
    : 'neutral';
  return {
    id,
    orderNumber: String(value.orderNumber || ''),
    title,
    imageUrl: String(value.imageUrl || ''),
    points: Math.max(0, Number(value.points) || 0),
    quantity: Math.max(1, Math.floor(Number(value.quantity) || 1)),
    status: String(value.status || 'Estado desconocido'),
    statusKind,
    statusKey: String(value.statusKey || `${statusKind}:${value.status || ''}`),
    useUrl: normalizeStoredUseUrl(value.useUrl),
    region: String(value.region || ''),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || ''),
    archived: value.archived === true,
    archivedAt: String(value.archivedAt || '')
  };
}

function normalizeStoredUseUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase();
    const trustedHost = hostname === 'creality.com'
      || hostname.endsWith('.creality.com')
      || hostname === 'crealitycloud.com'
      || hostname.endsWith('.crealitycloud.com');
    return url.protocol === 'https:' && trustedHost ? url.toString() : '';
  } catch {
    return '';
  }
}
