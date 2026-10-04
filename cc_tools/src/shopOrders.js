import { withParallelSessionBrowser } from './browserManager.js';

export const CREALITY_SHOP_ORDERS_URL = 'https://www.crealitycloud.com/es/shop-center/orders';
const SHOP_ORDERS_ENDPOINT = '/api/rest/lottery/goodsCxy/clientOrders';
const SHOP_ORDER_USE_ENDPOINT = '/api/rest/lottery/eshop/dtc/order';
const PAGE_SIZE = 10;
const MAX_PAGES = 50;

export async function readShopOrders() {
  return withParallelSessionBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    const session = await openOrdersSession(page);
    const orders = [];
    let pageNumber = 1;
    let totalCount = Number(session.firstPage?.totalCount) || 0;

    while (pageNumber <= MAX_PAGES && (pageNumber === 1 || orders.length < totalCount)) {
      const result = pageNumber === 1
        ? session.firstPage
        : await ordersRequest(page, { page: pageNumber, pageSize: PAGE_SIZE }, session.headers);
      const list = Array.isArray(result?.list) ? result.list : [];
      totalCount = Math.max(totalCount, Number(result?.totalCount) || list.length);
      const normalizedOrders = [];
      for (const value of list) {
        const order = normalizeShopOrder(value);
        if (order?.statusKind === 'available') {
          try {
            order.useUrl = await orderUseLinkRequest(page, order.orderNumber, session.headers);
          } catch (error) {
            console.error(`[shop-orders] No se pudo obtener el enlace de uso de ${order.orderNumber}: ${error.message}`);
          }
        }
        normalizedOrders.push(order);
      }
      orders.push(...normalizedOrders.filter(Boolean));
      if (!list.length || list.length < PAGE_SIZE) break;
      pageNumber += 1;
    }

    return [...new Map(orders.map((order) => [order.id, order])).values()];
  });
}

export function normalizeShopOrder(value) {
  const id = String(value?.id || value?.orderNo || '').trim();
  const title = String(value?.goodsName || value?.goodsVO?.name || '').trim();
  if (!id || !title) return null;
  const status = shopOrderStatus(value);
  return {
    id,
    orderNumber: String(value?.orderNo || value?.orderNum || ''),
    title,
    imageUrl: String(value?.compressPic || value?.goodsVO?.compressPic || value?.goodsVO?.pic || ''),
    points: Math.max(0, Number(value?.kwBeans) || 0),
    quantity: Math.max(1, Math.floor(Number(value?.buyNum) || 1)),
    status: status.label,
    statusKind: status.kind,
    statusKey: status.key,
    useUrl: normalizeOrderUseUrl(value?.useUrl),
    region: String(value?.site || ''),
    createdAt: timestampToIso(value?.createTime),
    updatedAt: timestampToIso(value?.lastModifyTime)
  };
}

function shopOrderStatus(value) {
  const orderStatus = Number(value?.orderStatus);
  const dtcStatus = String(value?.dtcOrderStatus ?? '').trim();
  const statusKey = `${Number.isFinite(orderStatus) ? orderStatus : ''}:${dtcStatus}`;
  const couponReady = orderStatus === 1 && Boolean(String(value?.couponCode || '').trim());
  if (couponReady) {
    return { label: 'Disponible', kind: 'available', key: `${statusKey}:coupon` };
  }
  const logisticsReady = Boolean(value?.logisticsNo || value?.deliveredTime);
  if (logisticsReady || orderStatus === 3) {
    return { label: 'Enviado', kind: 'shipped', key: statusKey };
  }
  if ([0, 1, 2].includes(orderStatus)) {
    return { label: 'Pendiente', kind: 'pending', key: statusKey };
  }
  if (orderStatus === 4) return { label: 'Cancelado', kind: 'neutral', key: statusKey };
  if (orderStatus === 5) return { label: 'Rechazado', kind: 'neutral', key: statusKey };
  return {
    label: Number.isFinite(orderStatus) ? `Estado ${orderStatus}` : 'Estado desconocido',
    kind: 'neutral',
    key: statusKey
  };
}

async function orderUseLinkRequest(page, orderNumber, headers = {}) {
  if (!orderNumber) return '';
  const response = await authenticatedPostRequest(page, SHOP_ORDER_USE_ENDPOINT, {
    orderNo: orderNumber,
    trace: { utm_source: 'creality_cloud', utm_medium: 'eshop' }
  }, headers);
  if (response.timedOut) {
    throw shopOrdersError('SHOP_ORDER_USE_LINK_TIMEOUT', 'La consulta del enlace de uso tardó demasiado en responder.');
  }
  if (!response.ok || !response.json || Number(response.json.code) !== 0) {
    throw shopOrdersError('SHOP_ORDER_USE_LINK_ERROR', response.json?.msg || `El enlace de uso respondió con HTTP ${response.status}.`);
  }
  const link = normalizeOrderUseUrl(response.json.result?.link);
  if (!link) throw shopOrdersError('SHOP_ORDER_USE_LINK_INVALID', 'Creality Cloud no devolvió un enlace de uso válido.');
  return link;
}

async function openOrdersSession(page) {
  let resolveObserved;
  const observed = new Promise((resolve) => { resolveObserved = resolve; });
  const listener = async (response) => {
    if (!response.url().includes(SHOP_ORDERS_ENDPOINT)) return;
    const [body, headers] = await Promise.all([
      response.json().catch(() => null),
      response.request().allHeaders().catch(() => ({}))
    ]);
    resolveObserved({ body, headers: replayableHeaders(headers) });
  };
  page.on('response', listener);
  await page.goto(CREALITY_SHOP_ORDERS_URL, { waitUntil: 'domcontentloaded' });
  const result = await Promise.race([
    observed,
    page.waitForTimeout(10000).then(() => null)
  ]);
  page.off('response', listener);
  if (!result?.headers || !Object.keys(result.headers).length || Number(result.body?.code) !== 0) {
    throw shopOrdersError('SHOP_ORDERS_SESSION_UNAVAILABLE', 'No se pudo recuperar la sesión de pedidos de Creality Cloud.');
  }
  return { headers: result.headers, firstPage: result.body.result };
}

async function ordersRequest(page, body, headers = {}) {
  const response = await authenticatedPostRequest(page, SHOP_ORDERS_ENDPOINT, body, headers);
  if (response.timedOut) {
    throw shopOrdersError('SHOP_ORDERS_TIMEOUT', 'La consulta de pedidos tardó demasiado en responder.');
  }
  if (!response.ok || !response.json || Number(response.json.code) !== 0) {
    throw shopOrdersError('SHOP_ORDERS_API_ERROR', response.json?.msg || `La consulta de pedidos respondió con HTTP ${response.status}.`);
  }
  return response.json.result;
}

async function authenticatedPostRequest(page, endpoint, payload, headers = {}) {
  return page.evaluate(async ({ endpoint: requestEndpoint, payload: requestPayload, forwarded }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const result = await fetch(requestEndpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { ...forwarded, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
        signal: controller.signal
      });
      return { ok: result.ok, status: result.status, json: await result.json().catch(() => null) };
    } catch (error) {
      return { ok: false, status: 0, json: null, timedOut: error?.name === 'AbortError' };
    } finally {
      clearTimeout(timer);
    }
  }, { endpoint, payload, forwarded: replayableHeaders(headers) });
}

function normalizeOrderUseUrl(value) {
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

function timestampToIso(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  const milliseconds = number < 1e12 ? number * 1000 : number;
  return new Date(milliseconds).toISOString();
}

function replayableHeaders(headers = {}) {
  const blocked = /^(?:host|connection|content-length|cookie|origin|referer|user-agent|accept-encoding|content-type|sec-|:)/i;
  return Object.fromEntries(Object.entries(headers)
    .filter(([name]) => !blocked.test(name))
    .map(([name, value]) => [name, String(value)]));
}

function shopOrdersError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.systemic = false;
  return error;
}
