import { withAutomationBrowser } from './browserManager.js';

export const WORKBENCH_URL = 'https://www.crealitycloud.com/en/workbench-beta/?type=1';
const DEVICE_GROUPS_PATH = '/api/rest/print/cluster/devices/getDeviceGroups';
export const LIMIT_DEVICE_LIST_PATH = '/api/rest/print/cluster/devices/getLimitDeviceList';
const GCODE_SELECT_PATH = '/api/cxy/v2/gcodev2/selectForPrinter';
const GCODE_OWNER_LIST_PATH = '/api/cxy/v2/gcode/ownerList';
const GCODE_PAGE_SIZE = 3;
const MAX_GCODE_PAGES = 50;

export function discoverPrinters() {
  return withAutomationBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    const deviceListResponse = waitForEndpoint(page, LIMIT_DEVICE_LIST_PATH);
    const deviceGroupsResponse = waitForDeviceGroups(page);
    await page.goto(WORKBENCH_URL, { waitUntil: 'domcontentloaded' });
    const response = await deviceListResponse;
    await page.waitForTimeout(1500);
    ensureWorkbenchSession(page, await collectSurfaceText(page));

    const payload = await response?.json().catch(() => null);
    const responsePrinters = parsePrinterResponse(payload);
    if (responsePrinters.length) return responsePrinters;

    const groupsResponse = await deviceGroupsResponse;
    const groupsPayload = await groupsResponse?.json().catch(() => null);
    const groupedPrinters = parsePrinterResponse(groupsPayload);
    if (groupedPrinters.length) return groupedPrinters;

    const sources = await collectTextSources(page);
    const printers = parsePrinterNames(sources.join('\n'));
    if (!printers.length) {
      if (!response && !groupsResponse) {
        throw discoveryError(
          'FINISH_PRINT_DEVICE_QUERY_NOT_OBSERVED',
          'Creality Cloud no realizó la consulta de impresoras del Banco de trabajo.'
        );
      }
      throw discoveryError('FINISH_PRINT_PRINTERS_NOT_FOUND', 'Creality Cloud no devolvió impresoras vinculadas en el Banco de trabajo.');
    }
    return printers;
  });
}

export function discoverGcodeFiles(printer = {}) {
  const requestedPrinter = String(printer.name || '').trim();
  const printerInterName = String(printer.printerInterName || '').trim();
  const deviceType = Number(printer.deviceType);
  if (!requestedPrinter) throw discoveryError('FINISH_PRINT_PRINTER_REQUIRED', 'Selecciona una impresora.');
  if (!printerInterName || !Number.isFinite(deviceType)) {
    throw discoveryError(
      'FINISH_PRINT_PRINTER_METADATA_REQUIRED',
      'Actualiza las impresoras y vuelve a seleccionar la impresora virtual.'
    );
  }

  return withAutomationBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    const authenticationHeadersPromise = waitForAuthenticationHeaders(page);
    await page.goto(WORKBENCH_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    ensureWorkbenchSession(page, await collectSurfaceText(page));
    const authenticationHeaders = await authenticationHeadersPromise;
    if (!authenticationHeaders) {
      const error = discoveryError(
        'FINISH_PRINT_AUTH_REQUEST_NOT_OBSERVED',
        'Creality Cloud no realizó la consulta autenticada del Banco de trabajo.'
      );
      error.silentRetry = true;
      throw error;
    }

    const result = await requestGcodeFiles(
      page,
      buildGcodeQueryPayload({ printerInterName, deviceType }),
      authenticationHeaders
    );
    const responses = [result, ...await requestRemainingGcodeFiles(
      page,
      result,
      printerInterName,
      authenticationHeaders
    )];
    const files = parseGcodeRecords(responses);
    if (!files.length) {
      throw discoveryError('FINISH_PRINT_GCODES_NOT_FOUND', 'No se encontraron archivos G-code compatibles en Cargas.');
    }
    return files;
  });
}

export function parsePrinterNames(text) {
  const lines = normalizedLines(text);
  const ignored = /^(Banco de trabajo|Workbench|Dispositivos(?:\s*\(\d+\))?|Devices(?:\s*\(\d+\))?|En línea|Online|Desconectad[ao]|Offline|Imprimiendo|Printing|Pausad[ao]|Paused|Imprimir desde archivos en la nube|Print from cloud files)$/i;
  const status = /^(En línea|Online|Desconectad[ao]|Offline|Imprimiendo|Printing|Pausad[ao]|Paused)$/i;
  const result = [];

  for (let index = 0; index < lines.length; index += 1) {
    const inline = lines[index].match(/^(.{1,80}?)\s+(En línea|Online|Desconectad[ao]|Offline|Imprimiendo|Printing|Pausad[ao]|Paused)(?:\s|$)/i);
    if (inline && !ignored.test(inline[1].trim())) {
      result.push(inline[1].trim());
      continue;
    }
    if (!status.test(lines[index])) continue;
    for (let previous = index - 1; previous >= Math.max(0, index - 4); previous -= 1) {
      const candidate = lines[previous];
      if (!candidate || ignored.test(candidate) || /\.gcode$/i.test(candidate)) continue;
      if (candidate.length > 80) continue;
      result.push(candidate);
      break;
    }
  }

  return [...new Set(result)].map((name) => ({ name }));
}

export function parsePrinterResponse(payload) {
  const devices = [];
  collectDeviceRecords(payload, devices);
  const unique = new Map();

  for (const device of devices) {
    const name = String(
      device.aliasName || device.nickName || device.deviceName || device.name || device.model || ''
    ).trim();
    if (!name) continue;
    const identity = String(device.deviceId || device.dn || device.id || name).trim();
    const model = String(device.model || device.deviceType?.name || device.deviceName || '').trim();
    if (!unique.has(identity)) {
      unique.set(identity, {
        name,
        deviceId: String(device.deviceId || device.dn || device.id || '').trim(),
        deviceName: String(device.deviceName || device.dn || '').trim(),
        model,
        printerInterName: String(device.deviceType?.internalName || model).trim(),
        deviceType: Number.isFinite(Number(device.type)) ? Number(device.type) : null
      });
    }
  }

  return [...unique.values()];
}

export function parseGcodeFiles(text) {
  const matches = String(text || '').match(/[^\r\n]*?\.gcode\b/gi) || [];
  return [...new Set(matches.map((file) => file.trim()).filter(Boolean))];
}

export function parseGcodeResponse(payload) {
  return parseGcodeResponses([payload]);
}

export function parseGcodeResponses(payloads) {
  return parseGcodeRecords(payloads).map((file) => file.name);
}

export function parseGcodeRecords(payloads) {
  const unique = new Map();
  for (const payload of payloads || []) {
    const result = payload?.result || {};
    const files = [
      ...(result.strictList || []),
      ...(result.alternativeList || []),
      ...(result.list || [])
    ];
    for (const file of files) {
      const name = String(file?.name || '').trim();
      if (!name || !/\.gcode$/i.test(name)) continue;
      const identity = String(file.id || name).trim();
      if (!unique.has(identity)) {
        unique.set(identity, {
          id: identity,
          name,
          printTime: Math.max(0, Number(file?.printTime) || 0)
        });
      }
    }
  }
  return [...unique.values()];
}

export function buildGcodeQueryPayload({ printerInterName, deviceType }) {
  return {
    printerInterName: String(printerInterName || '').trim(),
    pageSize: GCODE_PAGE_SIZE,
    state: 1,
    deviceType: Number(deviceType),
    isUpload: true
  };
}

export function buildGcodeOwnerListPayload({ page, printerInterName, strictPrinterId, alternative }) {
  const payload = {
    pageSize: GCODE_PAGE_SIZE,
    page: Number(page),
    state: 1,
    isUpload: true,
    type: 1
  };
  if (alternative) {
    payload.exPrinterId = String(strictPrinterId || '').trim();
  } else {
    payload.deviceId = String(strictPrinterId || '').trim();
    payload.printerInterName = String(printerInterName || '').trim();
  }
  return payload;
}

export function forwardAuthenticationHeaders(headers = {}) {
  const blocked = new Set([
    'accept',
    'accept-encoding',
    'accept-language',
    'connection',
    'content-length',
    'content-type',
    'cookie',
    'host',
    'origin',
    'referer',
    'user-agent'
  ]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => {
    const normalized = name.toLowerCase();
    return !blocked.has(normalized) && !normalized.startsWith('sec-') && !normalized.startsWith(':');
  }));
}

async function collectTextSources(page) {
  const sources = [];
  for (const frame of page.frames()) {
    sources.push(await frame.locator('body').innerText().catch(() => ''));
    const labels = await frame.locator('[aria-label]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('aria-label') || '')
    ).catch(() => []);
    sources.push(...labels);
  }
  return sources;
}

async function collectSurfaceText(page) {
  return (await collectTextSources(page)).join('\n');
}

function waitForDeviceGroups(page) {
  return waitForEndpoint(page, DEVICE_GROUPS_PATH);
}

function waitForEndpoint(page, path) {
  return page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes(path),
  { timeout: 45000 }).catch(() => null);
}

export function waitForAuthenticationHeaders(page, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      page.off('request', listener);
      resolve(value);
    };
    const listener = (request) => {
      if (request.method() !== 'POST' || !/^https:\/\/www\.crealitycloud\.com\/api\//i.test(request.url())) return;
      request.allHeaders().then((headers) => {
        const forwarded = forwardAuthenticationHeaders(headers);
        if (!hasCrealityAuthentication(forwarded)) return;
        finish(forwarded);
      }).catch(() => {});
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    page.on('request', listener);
  });
}

export function hasCrealityAuthentication(headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return Boolean(normalized.__cxy_token_ && normalized.__cxy_uid_);
}

async function requestRemainingGcodeFiles(page, initialResponse, printerInterName, authenticationHeaders) {
  const result = initialResponse?.result || {};
  const strictPrinterId = String(result.strictPrinterId || '').trim();
  if (!strictPrinterId) return [];

  const responses = [];
  if (result.moreStrict) {
    responses.push(...await requestGcodePages(page, {
      printerInterName,
      strictPrinterId,
      alternative: false,
      authenticationHeaders
    }));
  }
  if (result.moreAlternative) {
    responses.push(...await requestGcodePages(page, {
      printerInterName,
      strictPrinterId,
      alternative: true,
      authenticationHeaders
    }));
  }
  return responses;
}

async function requestGcodePages(page, options) {
  const responses = [];
  for (let pageNumber = 2; pageNumber <= MAX_GCODE_PAGES; pageNumber += 1) {
    const response = await requestGcodeFiles(
      page,
      buildGcodeOwnerListPayload({ ...options, page: pageNumber }),
      options.authenticationHeaders,
      GCODE_OWNER_LIST_PATH
    );
    responses.push(response);
    const list = Array.isArray(response?.result?.list) ? response.result.list : [];
    const rawCount = response?.result?.count;
    const count = rawCount == null ? Number.NaN : Number(rawCount);
    if (!list.length || list.length < GCODE_PAGE_SIZE) break;
    if (Number.isFinite(count) && pageNumber * GCODE_PAGE_SIZE >= count) break;
  }
  return responses;
}

async function requestGcodeFiles(page, payload, authenticationHeaders, path = GCODE_SELECT_PATH) {
  const response = await page.evaluate(async ({ path, body, authenticationHeaders: forwarded }) => {
    try {
      const result = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { ...forwarded, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { status: result.status, text: await result.text() };
    } catch (error) {
      return { status: 0, error: error?.message || String(error), text: '' };
    }
  }, { path, body: payload, authenticationHeaders });

  if (!response.status) {
    throw discoveryError('FINISH_PRINT_GCODE_QUERY_FAILED', `No se pudo consultar los archivos G-code: ${response.error || 'error de red'}.`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw discoveryError('FINISH_PRINT_GCODE_HTTP_ERROR', `Creality Cloud respondió con HTTP ${response.status} al consultar los G-code.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(response.text || '{}');
  } catch {
    throw discoveryError('FINISH_PRINT_GCODE_INVALID_RESPONSE', 'Creality Cloud devolvió una respuesta no válida al consultar los G-code.');
  }
  if (parsed.code !== 0) {
    throw discoveryError('FINISH_PRINT_GCODE_QUERY_REJECTED', parsed.msg || 'Creality Cloud rechazó la consulta de G-code.');
  }
  return parsed;
}

function collectDeviceRecords(value, devices) {
  if (Array.isArray(value)) {
    for (const item of value) collectDeviceRecords(item, devices);
    return;
  }
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value.deviceList)) {
    for (const device of value.deviceList) {
      if (device && typeof device === 'object') devices.push(device);
    }
  }

  const looksLikeDevice = ['deviceId', 'dn', 'macAddress', 'productKey']
    .some((field) => value[field] !== undefined && value[field] !== null && value[field] !== '');
  if (looksLikeDevice) devices.push(value);

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') collectDeviceRecords(nested, devices);
  }
}

function ensureWorkbenchSession(page, text) {
  if (/Iniciar sesión|Log In|Sign In/i.test(text) || /login/i.test(page.url())) {
    throw discoveryError('LOGIN_REQUIRED', 'La sesión de Creality Cloud no está iniciada.');
  }
  if (/Just a moment|Cloudflare|DataDome|verificación de seguridad/i.test(`${text}\n${page.url()}`)) {
    throw discoveryError('SECURITY_CHALLENGE', 'Creality Cloud ha mostrado una verificación de seguridad.');
  }
}

function normalizedLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function discoveryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
