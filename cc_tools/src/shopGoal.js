import { withAutomationBrowser, withParallelSessionBrowser } from './browserManager.js';

export const CREALITY_SHOP_URL = 'https://www.crealitycloud.com/es/shop-center/eshop';
const SHOP_LIST_ENDPOINT = '/api/rest/lottery/eshop/goods/list';
const SHOP_DETAIL_ENDPOINT = '/api/rest/lottery/goodsCxy/clientDetail';
const SHOP_REGIONS_ENDPOINT = '/api/rest/lottery/eshop/dtc/getIntegratedSiteList';
const PAGE_SIZE = 12;

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
    const session = await openShopSession(page);
    const site = normalizeShopRegion(goal.region);
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

    await selectShopRegion(page, goal.regionName).catch(() => {});
    const opened = await clickProductRedeem(page, product.name);
    if (!opened) throw shopError('SHOP_REDEEM_BUTTON_NOT_FOUND', 'No se encontró el botón de canje del objetivo.');
    await page.waitForTimeout(1000);

    const confirmed = await clickConfirmationRedeem(page);
    if (!confirmed) throw shopError('SHOP_REDEEM_CONFIRMATION_NOT_FOUND', 'No se encontró la confirmación final del canje.');
    await page.waitForTimeout(2500);

    const after = await shopRequest(page, SHOP_DETAIL_ENDPOINT, { id: goal.productId }, session.headers).catch(() => null);
    const remainingPoints = Number(after?.userKwBeans);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const successText = /canjead[oa]|redeem(?:ed)? successfully|exchange successful|éxito/i.test(bodyText);
    const balanceReduced = Number.isFinite(remainingPoints) && remainingPoints < availablePoints;
    if (!successText && !balanceReduced) {
      throw shopError('SHOP_REDEEM_UNVERIFIED', 'Creality Cloud no confirmó el canje del objetivo.');
    }
    return {
      success: true,
      product,
      availablePoints,
      remainingPoints: Number.isFinite(remainingPoints) ? remainingPoints : Math.max(0, availablePoints - product.points)
    };
  });
}

async function readCatalogProducts(page, session, site) {
  const products = [];
  let pageNumber = 1;
  let totalCount = Number.POSITIVE_INFINITY;
  while (products.length < totalCount && pageNumber <= 20) {
    const result = pageNumber === 1 && site === 'ES' && session.firstCatalog
      ? session.firstCatalog
      : await shopRequest(page, SHOP_LIST_ENDPOINT, catalogPayload(pageNumber, site), session.headers);
    const list = Array.isArray(result?.list) ? result.list : [];
    totalCount = Math.max(0, Number(result?.totalCount) || list.length);
    products.push(...list.map(normalizeProduct).filter(Boolean));
    if (!list.length || list.length < PAGE_SIZE) break;
    pageNumber += 1;
  }
  return products;
}

async function selectShopRegion(page, regionName) {
  const targetName = String(regionName || '').trim();
  if (!targetName || targetName === 'España') return;
  const current = page.getByText('España', { exact: true }).last();
  if (await current.isVisible().catch(() => false)) {
    await current.click();
    await page.waitForTimeout(300);
  }
  const target = page.getByText(targetName, { exact: true }).last();
  if (!await target.isVisible().catch(() => false)) return;
  await target.click();
  await page.waitForTimeout(1200);
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

function normalizeProduct(value) {
  const id = String(value?.id || '');
  const name = String(value?.name || '').trim();
  const regularPoints = Math.max(0, Number(value?.kwBeans) || 0);
  const offerPoints = Math.max(0, Number(value?.firstOrderKwBeans) || 0);
  const points = offerPoints || regularPoints;
  if (!id || !name || !points) return null;
  const stock = Number(value?.currentQuanity);
  return {
    id,
    name,
    imageUrl: String(value?.compressPic || value?.pic || ''),
    points,
    regularPoints,
    available: value?.stockStatus !== 0 && (!Number.isFinite(stock) || stock > 0),
    stock: Number.isFinite(stock) ? stock : null
  };
}

async function openShopSession(page) {
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
  await page.goto(CREALITY_SHOP_URL, { waitUntil: 'domcontentloaded' });
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

async function clickProductRedeem(page, productName) {
  const match = page.getByText(productName, { exact: true }).first();
  if (!await match.isVisible().catch(() => false)) return false;
  const clicked = await match.evaluate((node) => {
    let current = node;
    for (let depth = 0; current && depth < 9; depth += 1, current = current.parentElement) {
      const buttons = [...current.querySelectorAll('button')];
      const button = buttons.find((candidate) => /canjear|redeem/i.test(candidate.textContent || ''));
      if (button) {
        button.click();
        return true;
      }
    }
    return false;
  });
  return clicked;
}

async function clickConfirmationRedeem(page) {
  const dialogs = page.locator('[role="dialog"], .el-dialog, .ant-modal, .beans-dialog');
  for (let index = (await dialogs.count()) - 1; index >= 0; index -= 1) {
    const dialog = dialogs.nth(index);
    if (!await dialog.isVisible().catch(() => false)) continue;
    const button = dialog.getByRole('button', { name: /canjear|redeem/i }).last();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return true;
    }
  }
  const buttons = page.getByRole('button', { name: /canjear|redeem/i });
  if (await buttons.count() < 2) return false;
  await buttons.last().click();
  return true;
}

function shopError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.systemic = false;
  return error;
}
