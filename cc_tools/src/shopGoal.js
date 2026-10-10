import { withAutomationBrowser, withParallelSessionBrowser } from './browserManager.js';

export const CREALITY_SHOP_URL = 'https://www.crealitycloud.com/es/shop-center/eshop';
const SHOP_LIST_ENDPOINT = '/api/rest/lottery/eshop/goods/list';
const SHOP_DETAIL_ENDPOINT = '/api/rest/lottery/goodsCxy/clientDetail';
const SHOP_REGIONS_ENDPOINT = '/api/rest/lottery/eshop/dtc/getIntegratedSiteList';
const PAGE_SIZE = 12;
const BUY_ENDPOINTS = ['/api/rest/lottery/goods/buy', '/api/cxy/v2/goods/buy'];

export async function readShopCatalog(region = 'ES') {
  return withParallelSessionBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    const session = await openShopSession(page);
    const site = normalizeShopRegion(region);
    const products = await readCatalogProducts(page, session, site);
    const regions = await shopRequest(page, SHOP_REGIONS_ENDPOINT, {}, session.headers);
    return {
      products: products.sort((left, right) => left.points - right.points || left.name.localeCompare(right.name, 'es')),
      regions: normalizeRegions(regions)
    };
  });
}

export async function redeemShopGoal(goal) {
  return withAutomationBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    let session = await openShopSession(page);
    const site = normalizeShopRegion(goal.region);
    await selectShopRegion(page, site);
    const catalogProduct = (await readCatalogProducts(page, session, site))
      .find((item) => item.id === goal.productId);
    if (!catalogProduct) {
      return {
        success: false,
        unavailable: true,
        product: { ...goal, id: goal.productId, available: false },
        availablePoints: Number.NaN
      };
    }

    // Open the exact product, including products outside the first catalog page.
    session = await openShopSession(page, goal.productId);
    const detail = await shopRequest(page, SHOP_DETAIL_ENDPOINT, { id: goal.productId }, session.headers);
    const product = normalizeProduct(detail);
    if (!product) throw shopError('SHOP_GOAL_UNAVAILABLE', 'El objetivo seleccionado ya no está disponible.');
    const availablePoints = Number(detail?.userKwBeans);
    if (!Number.isFinite(availablePoints)) {
      throw shopError('SHOP_POINTS_UNAVAILABLE', 'No se pudo comprobar el saldo antes del canje.');
    }
    if (!product.available) {
      return { success: false, unavailable: true, product, availablePoints };
    }
    if (availablePoints < product.points) {
      return { success: false, insufficient: true, product, availablePoints };
    }
    if (Number(detail?.payMethod) === 2 || Number(detail?.minQuantity || 1) !== 1) {
      throw shopError('SHOP_GOAL_UNSUPPORTED', 'Este objetivo requiere otra moneda o una cantidad mínima distinta de una unidad. Revísalo en Creality Cloud.');
    }
    const orderNumber = await confirmShopRedemption(page, product);
    const after = await shopRequest(page, SHOP_DETAIL_ENDPOINT, { id: goal.productId }, session.headers).catch(() => null);
    const remainingPoints = Number(after?.userKwBeans);
    return {
      success: true,
      orderNumber,
      product,
      availablePoints,
      remainingPoints: after?.userKwBeans != null && Number.isFinite(remainingPoints) ? remainingPoints : Number.NaN
    };
  });
}

async function readCatalogProducts(page, session, site) {
  const products = [];
  let pageNumber = 1;
  let totalCount = Number.POSITIVE_INFINITY;
  while (products.length < totalCount && pageNumber <= 20) {
    const result = await shopRequest(page, SHOP_LIST_ENDPOINT, catalogPayload(pageNumber, site), session.headers);
    const list = Array.isArray(result?.list) ? result.list : [];
    totalCount = Math.max(0, Number(result?.totalCount) || list.length);
    products.push(...list.map(normalizeProduct).filter(Boolean));
    if (!list.length || list.length < PAGE_SIZE) break;
    pageNumber += 1;
  }
  return products;
}

async function selectShopRegion(page, site) {
  const selector = page.locator('.site-select-header');
  if (!await selector.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)) {
    throw shopError('SHOP_REGION_REQUIRED', 'Selecciona primero la región de la tienda en Creality Cloud y vuelve a programar el objetivo.');
  }
  if ((await selector.innerText()).trim() === site) return;
  await selector.click();
  const option = page.locator('.el-select-dropdown:visible').getByRole('option').filter({ has: page.getByText(site, { exact: true }) });
  await option.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (await option.count() !== 1) {
    throw shopError('SHOP_REGION_UNVERIFIED', `No se pudo seleccionar la región ${site} de la tienda.`);
  }
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/rest/lottery/eshop/dtc/saveUserSite', { timeout: 15000 }).catch(() => null);
  await option.click();
  // Region changes can ask for confirmation when the profile country differs.
  // Do not accept that mismatch automatically.
  const response = await saved;
  const result = await response?.json().catch(() => null);
  const selected = response?.ok() && result?.code != null && Number(result.code) === 0
    && await selector.getByText(site, { exact: true }).waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
  if (!selected) {
    throw shopError('SHOP_REGION_UNVERIFIED', `Confirma manualmente la región ${site} en la tienda de Creality Cloud antes de programar el canje.`);
  }
}

export function normalizeShopGoal(value = {}) {
  return {
    enabled: value.enabled === true,
    productId: String(value.productId || ''),
    name: String(value.name || ''),
    imageUrl: String(value.imageUrl || ''),
    points: Math.max(0, Number(value.points) || 0),
    region: normalizeShopRegion(value.region),
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

export function normalizeProduct(value) {
  const id = String(value?.id || '');
  const name = String(value?.name || '').trim();
  const regularPoints = Math.max(0, Number(value?.kwBeans) || 0);
  const offerPoints = Math.max(0, Number(value?.firstOrderKwBeans) || 0);
  const points = value?.promotionType === 'first_order_discount' ? offerPoints : regularPoints;
  if (!id || !name || !points) return null;
  const stock = Number(value?.currentQuanity);
  return {
    id,
    name,
    imageUrl: String(value?.compressPic || value?.pic || ''),
    points,
    regularPoints,
    type: Number(value?.type),
    available: ![0, 2].includes(Number(value?.stockStatus)) && ![1, 2, 3, 5, 6].includes(Number(value?.goodsStatus)) && (!Number.isFinite(stock) || stock > 0),
    stock: Number.isFinite(stock) ? stock : null
  };
}

async function openShopSession(page, productId = '') {
  let resolveObserved;
  const observed = new Promise((resolve) => { resolveObserved = resolve; });
  const listener = async (response) => {
    if (!response.url().includes(SHOP_LIST_ENDPOINT)) return;
    const [body, headers] = await Promise.all([
      response.json().catch(() => null),
      response.request().allHeaders().catch(() => ({}))
    ]);
    resolveObserved({ body, headers: replayableHeaders(headers) });
  };
  page.on('response', listener);
  await page.goto(productId ? `${CREALITY_SHOP_URL}?id=${encodeURIComponent(productId)}` : CREALITY_SHOP_URL, { waitUntil: 'domcontentloaded' });
  const result = await Promise.race([
    observed,
    page.waitForTimeout(8000).then(() => null)
  ]);
  page.off('response', listener);
  if (!result?.headers || !Object.keys(result.headers).length) {
    throw shopError('SHOP_SESSION_UNAVAILABLE', 'No se pudo recuperar la sesión de la tienda de Creality Cloud.');
  }
  return {
    headers: result.headers,
    firstCatalog: Number(result.body?.code) === 0 ? result.body.result : null
  };
}

async function shopRequest(page, endpoint, body, headers = {}) {
  const response = await page.evaluate(async ({ endpoint: path, body: payload, headers: forwarded }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const result = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { ...forwarded, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      return { ok: result.ok, status: result.status, json: await result.json().catch(() => null) };
    } catch (error) {
      return { ok: false, status: 0, json: null, timedOut: error?.name === 'AbortError' };
    } finally {
      clearTimeout(timer);
    }
  }, { endpoint, body, headers: replayableHeaders(headers) });
  if (response.timedOut) {
    throw shopError('SHOP_API_TIMEOUT', 'La tienda de Creality Cloud tardó demasiado en responder.');
  }
  if (!response.ok || !response.json || Number(response.json.code) !== 0) {
    throw shopError('SHOP_API_ERROR', response.json?.msg || `La tienda respondió con HTTP ${response.status}.`);
  }
  return response.json.result;
}

function catalogPayload(page, site = 'ES') {
  return {
    page,
    pageSize: PAGE_SIZE,
    exchangeType: 1,
    isOnlyVip: false,
    site: normalizeShopRegion(site),
    classId: ''
  };
}

export function normalizeShopRegion(value) {
  const region = String(value || 'ES').trim();
  return /^[A-Za-z]{2,6}$/.test(region) ? region.toUpperCase() : 'ES';
}

function normalizeRegions(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).map((item) => ({
    code: normalizeShopRegion(item?.site),
    name: String(item?.name || item?.site || '').trim(),
    area: String(item?.area || '').trim(),
    imageUrl: String(item?.picture || '').trim()
  })).filter((item) => item.code && item.name && !seen.has(item.code) && seen.add(item.code));
}

function replayableHeaders(headers = {}) {
  const blocked = /^(?:host|connection|content-length|cookie|origin|referer|user-agent|accept-encoding|content-type|sec-|:)/i;
  return Object.fromEntries(Object.entries(headers)
    .filter(([name]) => !blocked.test(name))
    .map(([name, value]) => [name, String(value)]));
}

export async function confirmShopRedemption(page, product, { timeoutMs = 15000, responseTimeoutMs = 30000 } = {}) {
  const detail = page.locator('.el-dialog:visible').filter({ has: page.locator('.goods-detail-content') });
  await detail.waitFor({ state: 'visible', timeout: timeoutMs });
  await detail.locator('.goods-name').filter({ hasText: /\S/ }).waitFor({ state: 'visible', timeout: timeoutMs });
  const name = (await detail.locator('.goods-name').innerText()).trim();
  const price = Number((await detail.locator('.pay-num').innerText()).replace(/[^\d]/g, ''));
  const quantity = await detail.getByRole('spinbutton').inputValue().catch(() => '');
  if (name !== product.name || price !== product.points || quantity !== '1') {
    throw shopError('SHOP_GOAL_CHANGED', 'El producto, el precio o la cantidad de la confirmación no coinciden con el objetivo. Revisa la ficha y vuelve a programarlo.');
  }
  const next = detail.locator('.submit-box .el-button--primary');
  if (await next.count() !== 1 || !await next.isVisible() || !await next.isEnabled()) {
    throw shopError('SHOP_REDEEM_UNAVAILABLE', 'El canje no está habilitado para este producto. Comprueba su precio, existencias, límites y requisitos de cuenta en Creality Cloud.');
  }
  if (![1, 2].includes(product.type)) {
    throw shopError('SHOP_GOAL_UNSUPPORTED', 'No se reconoce el tipo de producto. Revisa el objetivo en Creality Cloud.');
  }
  await next.click();
  let confirmation;
  if (product.type === 1) {
    confirmation = page.locator('.el-message-box:visible');
    await confirmation.waitFor({ state: 'visible', timeout: timeoutMs });
  } else {
    confirmation = page.locator('.el-dialog:visible').filter({ has: page.locator('.top-address') });
    await confirmation.waitFor({ state: 'visible', timeout: timeoutMs });
    const hasAddress = await confirmation.locator('.top-address .address').waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true, () => false);
    if (!hasAddress) {
      throw shopError('SHOP_ADDRESS_REQUIRED', 'Añade una dirección de envío válida para la región de la tienda en Creality Cloud y vuelve a programar el objetivo.');
    }
  }
  const submit = confirmation.locator(product.type === 1
    ? '.el-message-box__btns .el-button--primary'
    : '.submit-box .el-button--primary');
  if (await submit.count() !== 1 || !await submit.isVisible() || !await submit.isEnabled()) {
    throw shopError('SHOP_REDEEM_CONFIRMATION_NOT_FOUND', 'No se encontró una confirmación final válida para el canje.');
  }
  // Observe the one final submission; never click it again after an uncertain result.
  const responsePromise = page.waitForResponse((response) => {
    if (!BUY_ENDPOINTS.includes(new URL(response.url()).pathname)) return false;
    const request = response.request();
    if (request.method() !== 'POST') return false;
    try {
      const body = request.postDataJSON();
      return String(body?.id) === product.id && Number(body?.buyNum) === 1;
    } catch { return false; }
  }, { timeout: responseTimeoutMs }).catch(() => null);
  await submit.click();
  const response = await responsePromise;
  const body = await response?.json().catch(() => null);
  if (!response || !body || body.code == null) {
    throw shopError('SHOP_REDEEM_UNVERIFIED', 'No se pudo verificar la respuesta del canje. Comprueba el historial de pedidos de Creality Cloud antes de volver a programarlo.');
  }
  if (!response.ok() || Number(body.code) !== 0) {
    const message = String(body.msg || body.message || 'Canje rechazado por Creality Cloud.').replace(/[\r\n]+/g, ' ').slice(0, 400);
    throw shopError('SHOP_REDEEM_REJECTED', `${message} (HTTP ${response.status()}, código ${body.code}).`);
  }
  const orderNumber = String(body.result?.orderNo || '').trim();
  if (!orderNumber) {
    throw shopError('SHOP_REDEEM_UNVERIFIED', 'Creality Cloud respondió sin número de pedido. Comprueba el historial de pedidos antes de volver a programar el objetivo.');
  }
  return orderNumber;
}

function shopError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.systemic = false;
  return error;
}
