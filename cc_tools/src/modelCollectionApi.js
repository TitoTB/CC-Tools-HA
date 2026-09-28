import { randomUUID } from 'node:crypto';

export const COLLECTION_URL = 'https://www.crealitycloud.com/api/cxy/v3/model/modelGroupCollection';
const HEADER_NAMES = new Set([
  '__cxy_app_ch_', '__cxy_app_id_', '__cxy_app_ver_', '__cxy_brand_',
  '__cxy_duid_', '__cxy_os_lang_', '__cxy_os_ver_', '__cxy_platform_',
  '__cxy_timezone_', '__cxy_token_', '__cxy_uid_'
]);
const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
function apiUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['www.crealitycloud.com', 'api.crealitycloud.com'].includes(url.hostname)
      && url.pathname.startsWith('/api/') ? url : null;
  } catch { return null; }
}

export function collectionSessionHeaders(headers = {}) {
  const filtered = Object.fromEntries(Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), String(value)])
    .filter(([key]) => HEADER_NAMES.has(key)));
  return filtered.__cxy_token_ && filtered.__cxy_uid_ ? filtered : null;
}

export function collectionModelIdFromRequest(url, payload) {
  const parsed = apiUrl(url);
  if (!parsed || !/\/model\/fileListPage\/?$/.test(parsed.pathname)) return '';
  const id = payload?.modelId || parsed.searchParams.get('modelId');
  return validId(id) ? id : '';
}

// Nuxt serializes its state as a table of references. Follow only the current
// model-info entry; IDs in printer profiles or recommendation lists are unrelated.
export function collectionModelIdFromNuxt(text, pageUrl) {
  try {
    const url = new URL(pageUrl);
    if (url.origin !== new URL(COLLECTION_URL).origin) return '';
    const slug = decodeURIComponent(url.pathname.match(/\/model-detail\/([^/]+)/)?.[1] || '');
    if (!slug) return '';
    const table = JSON.parse(text);
    if (!Array.isArray(table)) return '';
    const deref = index => {
      let value = table[index];
      let depth = 0;
      while (Array.isArray(value) && ['ShallowReactive', 'Reactive', 'Ref', 'ShallowRef'].includes(value[0]) && depth++ < 8) value = table[value[1]];
      return value;
    };
    const root = deref(0);
    const data = deref(root?.data);
    const response = deref(data?.[`model-info_${slug}`]);
    if (deref(response?.code) !== 0) return '';
    const result = deref(response?.result);
    const model = deref(result?.groupItem);
    const id = deref(model?.id);
    return validId(id) ? id : '';
  } catch { return ''; }
}

export function captureCollectionTarget(page) {
  let stopped = false;
  let modelId = '';
  let source = '';
  let authenticationHeaders = null;
  let apiRequests = 0;
  let fileRequests = 0;
  let resolveTarget;
  let timer;
  const target = new Promise(resolve => { resolveTarget = resolve; });
  const finish = () => {
    if (!stopped && modelId && authenticationHeaders) resolveTarget({ modelId, authenticationHeaders, source });
  };
  const listener = async request => {
    try {
      if (request.frame() !== page.mainFrame()) return;
      if (!apiUrl(request.url())) return;
      apiRequests++;
      let payload = null;
      try { payload = request.postDataJSON(); } catch { /* GET or non-JSON body. */ }
      const observedId = collectionModelIdFromRequest(request.url(), payload);
      if (/\/fileListPage\/?(?:\?|$)/.test(request.url())) fileRequests++;
      if (observedId) { modelId = observedId; source = 'fileListPage'; }
      const session = collectionSessionHeaders(await request.allHeaders());
      if (stopped) return;
      if (session) authenticationHeaders = session;
      finish();
    } catch { /* Never log request headers or session tokens. */ }
  };
  page.on('request', listener);
  return {
    async read(timeoutMs = 12000) {
      if (!modelId) {
        const text = await page.locator('#__NUXT_DATA__').textContent({ timeout: 2000 }).catch(() => '');
        const embeddedId = collectionModelIdFromNuxt(text, page.url());
        if (embeddedId && !modelId) { modelId = embeddedId; source = 'nuxt-model-info'; }
      }
      finish();
      timer = setTimeout(() => resolveTarget(null), timeoutMs);
      const found = await target;
      clearTimeout(timer);
      if (!found) {
        const missing = modelId ? 'sesión autenticada' : authenticationHeaders ? 'modelId de la ficha' : 'modelId de la ficha y sesión autenticada';
        const error = collectionError(modelId ? 'COLLECTION_SESSION_MISSING' : 'COLLECTION_MODEL_ID_MISSING',
          `No se pudo obtener ${missing}. API observadas: ${apiRequests}; fileListPage: ${fileRequests}; datos del modelo: ${source || 'no disponibles'}. No se ha enviado la acción.`);
        error.collectionContext = { modelFound: Boolean(modelId), sessionFound: Boolean(authenticationHeaders), source, apiRequests, fileRequests };
        throw error;
      }
      return found;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      resolveTarget(null);
      page.off('request', listener);
      authenticationHeaders = null;
    }
  };
}

export async function addModelToDefaultCollection(page, target) {
  if (!target || !/^[a-f\d]{24}$/i.test(target.modelId)
    || !target.authenticationHeaders?.__cxy_token_ || !target.authenticationHeaders?.__cxy_uid_) {
    throw collectionError('COLLECTION_CONTEXT_MISSING', 'Faltan el identificador del modelo o la sesión actual.');
  }
  if (new URL(page.url()).origin !== new URL(COLLECTION_URL).origin) {
    throw collectionError('COLLECTION_ORIGIN_INVALID', 'La ficha no pertenece al sitio esperado de Creality Cloud.');
  }
  try {
    return await page.evaluate(async ({ url, modelId, headers }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(url, {
          method: 'POST', credentials: 'include', redirect: 'error', signal: controller.signal,
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ id: modelId, action: true })
        });
        const data = await response.json().catch(() => null);
        const code = typeof data?.code === 'number' || typeof data?.code === 'string' ? data.code : null;
        return { http: response.status, code, accepted: response.ok && (code === 0 || code === '0') };
      } finally { clearTimeout(timer); }
    }, {
      url: COLLECTION_URL, modelId: target.modelId,
      headers: { ...target.authenticationHeaders, __cxy_requestid_: randomUUID() }
    });
  } catch {
    // A timeout can happen after the server applied the action. Do not retry it here.
    throw collectionError('COLLECTION_OUTCOME_UNKNOWN', 'No se pudo confirmar la respuesta del guardado. No se repetirá la petición para este modelo.');
  }
}

function collectionError(code, message) {
  return Object.assign(new Error(message), { code, category: 'action', userMessage: message, systemic: false });
}
