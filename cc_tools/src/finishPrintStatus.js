import { withAutomationBrowser, withParallelSessionBrowser } from './browserManager.js';
import {
  LIMIT_DEVICE_LIST_PATH,
  WORKBENCH_URL,
  forwardAuthenticationHeaders,
  hasCrealityAuthentication,
  parsePrinterResponse
} from './finishPrintDiscovery.js';
import { buildSelectDeviceUrl, parsePrintRecord } from './finishPrintExecution.js';

const PRINT_RECORD_DETAIL_PATH = '/api/cxy/v3/print/record/detail';
const PRINT_SET_STATE_PATH = '/api/cxy/v2/print/setState';
const REQUEST_TIMEOUT_MS = 45 * 1000;

export const PRINTER_STATE_LABELS = {
  0: 'Inactiva',
  1: 'Imprimiendo',
  2: 'Finalizada',
  3: 'Error',
  4: 'Detenida',
  5: 'Pausada'
};

export function printerStateLabel(value) {
  if (value === null || value === undefined || value === '') return 'No disponible';
  const state = Number(value);
  return PRINTER_STATE_LABELS[state] || `Estado ${Number.isFinite(state) ? state : 'desconocido'}`;
}

export function recordsByKey(records) {
  return Object.fromEntries((Array.isArray(records) ? records : [])
    .filter((record) => record && record.key)
    .map((record) => [String(record.key), record.value]));
}

export function latestTimeseriesValue(payload, key) {
  const samples = payload?.[key];
  if (!Array.isArray(samples) || !samples.length) return null;
  const sample = samples.reduce((latest, current) =>
    Number(current?.ts || 0) > Number(latest?.ts || 0) ? current : latest, samples[0]);
  return sample?.value ?? null;
}

export function parsePrinterTelemetry(printer, attributesPayload, timeseriesPayload, printRecord = null) {
  const attributes = recordsByKey(attributesPayload?.result);
  const timeseries = timeseriesPayload?.result || {};
  const deviceConnectionState = finiteNumber(printer.connectionState, null);
  const telemetryConnectionState = finiteNumber(attributes.connect, null);
  const connected = deviceConnectionState !== null
    ? deviceConnectionState !== 0
    : telemetryConnectionState !== null
      ? telemetryConnectionState !== 0
      : null;
  const telemetryState = finiteNumber(attributes.state, null);
  const workbenchIdle = finiteNumber(printer.idleState, null) === 0;
  const inactive = connected !== false && workbenchIdle && ![1, 5].includes(telemetryState);
  const suppressPreviousPrint = connected === false || inactive;
  const rawState = connected === false
    ? null
    : inactive
      ? 0
      : finiteNumber(telemetryState, printer.deviceState, null);
  const hasCurrentPrintRecord = Boolean(printRecord?.printId);
  const printIdentityUpdatedAt = latestRecordTimestamp(attributesPayload?.result, ['printId', 'printStartTime']);
  const errorUpdatedAt = latestRecordTimestamp(attributesPayload?.result, [
    'err', 'errorMessage', 'errorMsg', 'errMsg', 'errorDesc', 'errDesc', 'failReason', 'error'
  ]);
  const attributeErrorIsCurrent = !printIdentityUpdatedAt || !errorUpdatedAt || errorUpdatedAt >= printIdentityUpdatedAt;
  const printError = suppressPreviousPrint
    ? 0
    : finiteNumber(
      hasCurrentPrintRecord ? printRecord?.printError : null,
      attributeErrorIsCurrent ? attributes.err : null,
      0
    );
  const printErrorDetail = suppressPreviousPrint
    ? ''
    : printerErrorDetail(attributes, printRecord, {
      preferRecord: hasCurrentPrintRecord,
      includeAttributes: attributeErrorIsCurrent
    });
  const progress = suppressPreviousPrint
    ? 0
    : clamp(finiteNumber(latestTimeseriesValue(timeseries, 'printProgress'), 0), 0, 100);
  const printId = suppressPreviousPrint ? '' : String(attributes.printId || printRecord?.printId || '').trim();
  const gcodeName = suppressPreviousPrint ? '' : String(
    printRecord?.name || attributes.filename || attributes.print || attributes.opGcodeFile || ''
  ).trim();
  const active = connected !== false && (rawState === 1 || rawState === 5);
  const stateLabel = connected === false ? 'Desconectada' : printerStateLabel(rawState);
  return {
    printerName: printer.name,
    deviceId: printer.deviceId || '',
    deviceName: printer.deviceName || '',
    telemetryId: printer.telemetryId || '',
    model: printer.model || '',
    imageUrl: printer.imageUrl || '',
    deviceState: printer.deviceState,
    idleState: printer.idleState,
    connected,
    state: rawState,
    stateLabel,
    active,
    paused: rawState === 5,
    canStop: active && Boolean(printer.telemetryId),
    canPause: active && Boolean(printer.telemetryId),
    printId,
    printError,
    printErrorDetail,
    gcodeName,
    progress,
    elapsedSeconds: suppressPreviousPrint ? 0 : Math.max(0, finiteNumber(latestTimeseriesValue(timeseries, 'printJobTime'), printRecord?.printJobTime, 0)),
    remainingSeconds: suppressPreviousPrint ? 0 : Math.max(0, finiteNumber(latestTimeseriesValue(timeseries, 'printLeftTime'), 0)),
    startedAt: suppressPreviousPrint ? 0 : finiteNumber(attributes.printStartTime, printRecord?.printStartTime, 0),
    printRecord,
    diagnostics: {
      state: rawState,
      stateLabel,
      deviceState: printer.deviceState,
      connectionState: printer.connectionState,
      idleState: printer.idleState,
      connected,
      printError,
      printId,
      progress,
      connect: finiteNumber(attributes.connect, null),
      active: attributes.active ?? null,
      lastTelemetryUpdate: latestAttributeTimestamp(attributesPayload?.result)
    }
  };
}

export function readPrinterStatuses(knownPrinters = []) {
  return withPrinterSession(async ({ page, headers, printers }) => {
    const statuses = [];
    for (const printer of printers) {
      if (!printer.telemetryId) {
        statuses.push(parsePrinterTelemetry(printer, null, null));
        continue;
      }
      try {
        const [attributes, timeseries] = await Promise.all([
          requestJson(page, `/api/rest/iotrouter/plugins/telemetry/${encodeURIComponent(printer.telemetryId)}/values/attributes`, null, headers, 'GET'),
          requestJson(page, `/api/rest/iotrouter/${encodeURIComponent(printer.telemetryId)}/values/timeseries`, null, headers, 'GET')
        ]);
        const attributeMap = recordsByKey(attributes?.result);
        const printId = String(attributeMap.printId || '').trim();
        const connectionState = finiteNumber(printer.connectionState, attributeMap.connect, null);
        const telemetryState = finiteNumber(attributeMap.state, null);
        const inactive = connectionState !== 0
          && finiteNumber(printer.idleState, null) === 0
          && ![1, 5].includes(telemetryState);
        let printRecord = null;
        if (printId && connectionState !== 0 && !inactive) {
          const detail = await requestJson(page, PRINT_RECORD_DETAIL_PATH, { id: printId }, headers, 'POST')
            .catch(() => null);
          if (detail?.code === 0 && detail.result) printRecord = parsePrintRecord(detail);
        }
        statuses.push(parsePrinterTelemetry(printer, attributes, timeseries, printRecord));
      } catch (error) {
        statuses.push({
          ...parsePrinterTelemetry(printer, null, null),
          state: null,
          stateLabel: 'No disponible',
          error: error.code || error.message || String(error),
          printErrorDetail: error.message || String(error)
        });
      }
    }
    return statuses;
  }, knownPrinters, { parallel: true });
}

export function controlPrinter({ printerName, action, knownPrinters = [] }) {
  const normalizedName = String(printerName || '').trim();
  if (!['pause', 'resume', 'stop'].includes(action)) {
    throw statusError('FINISH_PRINT_CONTROL_INVALID', 'La orden solicitada no es válida.');
  }
  return withPrinterSession(async ({ page, headers, printers }) => {
    const printer = printers.find((item) => item.name === normalizedName);
    if (!printer?.telemetryId) {
      throw statusError('FINISH_PRINT_PRINTER_NOT_FOUND', 'No se pudo identificar la impresora en Creality Cloud.');
    }
    const attributes = await requestJson(
      page,
      `/api/rest/iotrouter/plugins/telemetry/${encodeURIComponent(printer.telemetryId)}/values/attributes`,
      null,
      headers,
      'GET'
    );
    const values = recordsByKey(attributes?.result);
    const printId = String(values.printId || '').trim();
    const stateBefore = finiteNumber(values.state, printer.deviceState);
    const responses = {};

    if (action === 'stop' && printId) {
      responses.record = await requestJson(page, PRINT_SET_STATE_PATH, { id: printId, state: 4 }, headers, 'POST');
      validateControlResponse(responses.record, 'FINISH_PRINT_STOP_RECORD_REJECTED');
    }
    const params = action === 'stop'
      ? { stop: 1 }
      : { pause: action === 'pause' ? 1 : 0 };
    responses.device = await requestJson(
      page,
      `/api/rest/iotrouter/rpc/twoway/${encodeURIComponent(printer.telemetryId)}`,
      { method: 'set', params },
      headers,
      'POST'
    );
    validateControlResponse(responses.device, 'FINISH_PRINT_DEVICE_CONTROL_REJECTED');
    return {
      action,
      printerName: printer.name,
      deviceName: printer.deviceName || '',
      telemetryId: printer.telemetryId,
      printId,
      stateBefore,
      stateBeforeLabel: printerStateLabel(stateBefore),
      responses: {
        recordCode: responses.record?.code ?? null,
        deviceCode: responses.device?.code ?? null,
        deviceResultCode: responses.device?.result?.code ?? null
      }
    };
  }, knownPrinters);
}

async function withPrinterSession(callback, knownPrinters = [], options = {}) {
  const openBrowser = options.parallel ? withParallelSessionBrowser : withAutomationBrowser;
  return openBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    const observer = observePrinterSession(page);
    const targetUrl = printerSessionTargetUrl(knownPrinters);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    let observed = await observer.snapshot();
    if (!observed.headers || !observed.printers.length) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await page.waitForTimeout(3500);
      observed = await observer.snapshot();
    }
    observer.stop();
    const printers = mergeKnownPrinters(observed.printers, knownPrinters);
    if (!observed.headers) {
      const surfaceText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
      const loginRequired = looksLikePrinterLogin({ url: page.url(), text: surfaceText });
      throw statusError(
        loginRequired ? 'LOGIN_REQUIRED' : 'FINISH_PRINT_AUTH_REQUEST_NOT_OBSERVED',
        loginRequired
          ? 'La sesión de Creality Cloud no está iniciada. Abre Creality Cloud e inicia sesión.'
          : 'No se pudo obtener la sesión del Banco de trabajo.',
        { ...observed.diagnostics, knownPrinterCount: knownPrinters.length, loginRequired }
      );
    }
    if (!printers.length) {
      throw statusError(
        'FINISH_PRINT_PRINTERS_NOT_FOUND',
        'Creality Cloud no devolvió impresoras vinculadas.',
        { ...observed.diagnostics, knownPrinterCount: knownPrinters.length }
      );
    }
    return callback({ page, headers: observed.headers, printers });
  });
}

export function mergeKnownPrinters(observed = [], known = []) {
  const printers = [];
  for (const source of [known, observed]) {
    for (const printer of Array.isArray(source) ? source : []) {
      const name = String(printer?.name || printer?.printerName || '').trim();
      const deviceName = String(printer?.deviceName || printer?.printerDeviceName || '').trim();
      if (!name && !deviceName) continue;
      const deviceId = String(printer?.deviceId || printer?.printerDeviceId || '').trim();
      const telemetryId = String(printer?.telemetryId || printer?.printerTelemetryId || '').trim();
      const index = printers.findIndex((candidate) => printerRecordsMatch(candidate, {
        name,
        deviceName,
        deviceId,
        telemetryId
      }));
      const previous = index >= 0 ? printers[index] : {};
      const imageUrl = String(printer?.imageUrl || printer?.printerImageUrl || '').trim();
      const deviceState = finiteNumber(printer?.deviceState, previous.deviceState, null);
      const connectionState = finiteNumber(printer?.connectionState, previous.connectionState, null);
      const idleState = finiteNumber(printer?.idleState, previous.idleState, null);
      const merged = {
        ...previous,
        ...printer,
        name: name || deviceName,
        deviceId: deviceId || previous.deviceId || '',
        deviceName,
        telemetryId: telemetryId || previous.telemetryId || '',
        imageUrl: imageUrl || previous.imageUrl || '',
        deviceState,
        connectionState,
        idleState
      };
      if (index >= 0) printers[index] = merged;
      else printers.push(merged);
    }
  }
  return printers;
}

function printerRecordsMatch(candidate = {}, current = {}) {
  const candidateDeviceId = String(candidate.deviceId || '').trim();
  const candidateTelemetryId = String(candidate.telemetryId || '').trim();
  if (candidateDeviceId && current.deviceId && candidateDeviceId === current.deviceId) return true;
  if (candidateTelemetryId && current.telemetryId && candidateTelemetryId === current.telemetryId) return true;
  const candidateName = String(candidate.name || '').trim();
  const candidateDeviceName = String(candidate.deviceName || '').trim();
  return Boolean(
    candidateName
    && current.name
    && candidateName === current.name
    && candidateDeviceName === current.deviceName
  );
}

export function printerSessionTargetUrl(knownPrinters = []) {
  const gcodeId = (Array.isArray(knownPrinters) ? knownPrinters : [])
    .map((printer) => String(printer?.authenticationGcodeId || '').trim())
    .find(Boolean);
  return gcodeId ? buildSelectDeviceUrl(gcodeId) : WORKBENCH_URL;
}

export function looksLikePrinterLogin({ url = '', text = '' } = {}) {
  return /\/(?:login|sign-in|signin)(?:\/|\?|$)/i.test(String(url))
    || /(?:^|\n)\s*(?:Iniciar sesi[oó]n|Log In|Sign In)\s*(?:\n|$)/i.test(String(text));
}

function observePrinterSession(page) {
  const pending = [];
  const requests = new Map();
  const printerPayloads = [];
  let headers = null;

  const inspectRequest = (request) => {
    if (!isCrealityApiUrl(request.url())) return;
    const path = safePathname(request.url());
    const entry = requests.get(path) || { path, methods: new Set(), statuses: new Set(), hasToken: false, hasUid: false };
    entry.methods.add(request.method());
    requests.set(path, entry);
    const job = request.allHeaders().then((requestHeaders) => {
      const forwarded = forwardAuthenticationHeaders(requestHeaders);
      entry.hasToken ||= headerPresent(forwarded, '__cxy_token_');
      entry.hasUid ||= headerPresent(forwarded, '__cxy_uid_');
      if (!headers && hasCrealityAuthentication(forwarded)) headers = forwarded;
    }).catch(() => {});
    pending.push(job);
  };

  const inspectResponse = (response) => {
    if (!isCrealityApiUrl(response.url())) return;
    const path = safePathname(response.url());
    const entry = requests.get(path) || { path, methods: new Set(), statuses: new Set(), hasToken: false, hasUid: false };
    entry.statuses.add(response.status());
    requests.set(path, entry);
    if (!isPrinterPayloadPath(path)) return;
    const job = response.json().then((payload) => {
      const printers = parsePrinterResponse(payload);
      if (printers.length) printerPayloads.push(...printers);
    }).catch(() => {});
    pending.push(job);
  };

  page.on('request', inspectRequest);
  page.on('response', inspectResponse);
  return {
    async snapshot() {
      await Promise.allSettled([...pending]);
      const observedRequests = [...requests.values()].slice(-30).map((entry) => ({
        path: entry.path,
        methods: [...entry.methods],
        statuses: [...entry.statuses],
        hasToken: entry.hasToken,
        hasUid: entry.hasUid
      }));
      return {
        headers,
        printers: mergeKnownPrinters(printerPayloads, []),
        diagnostics: {
          pageUrl: page.url(),
          apiRequestCount: requests.size,
          authenticatedRequestObserved: Boolean(headers),
          observedRequests
        }
      };
    },
    stop() {
      page.off('request', inspectRequest);
      page.off('response', inspectResponse);
    }
  };
}

function isCrealityApiUrl(value) {
  try {
    const url = new URL(value);
    return /(^|\.)crealitycloud\.com$/i.test(url.hostname) && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function safePathname(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return String(value || '').slice(0, 160);
  }
}

function isPrinterPayloadPath(path) {
  return [
    LIMIT_DEVICE_LIST_PATH,
    '/api/rest/print/cluster/devices/getDeviceGroups',
    '/api/rest/print/cluster/devices/getUnGroupDevices',
    '/api/rest/print/cluster/devices/getDeviceDetail',
    '/api/rest/print/cluster/devices/checkGcodePrintDevice'
  ].some((candidate) => path.includes(candidate));
}

function headerPresent(headers, name) {
  const normalized = Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  return Boolean(normalized[String(name).toLowerCase()]);
}

async function requestJson(page, path, body, headers, method) {
  const response = await page.evaluate(async ({ endpoint, payload, forwardedHeaders, requestMethod, timeoutMs }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await fetch(endpoint, {
        method: requestMethod,
        credentials: 'include',
        headers: payload === null ? forwardedHeaders : { ...forwardedHeaders, 'content-type': 'application/json' },
        body: payload === null ? undefined : JSON.stringify(payload),
        signal: controller.signal
      });
      return { status: result.status, text: await result.text() };
    } catch (error) {
      return { status: 0, text: '', error: error?.message || String(error), timedOut: error?.name === 'AbortError' };
    } finally {
      clearTimeout(timeout);
    }
  }, { endpoint: path, payload: body, forwardedHeaders: headers, requestMethod: method, timeoutMs: REQUEST_TIMEOUT_MS });
  if (!response.status) {
    throw statusError(
      response.timedOut ? 'FINISH_PRINT_STATUS_TIMEOUT' : 'FINISH_PRINT_STATUS_NETWORK_FAILURE',
      response.timedOut ? 'Creality Cloud tardó demasiado en responder.' : `No se pudo consultar la impresora: ${response.error || 'error de red'}.`
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw statusError('FINISH_PRINT_STATUS_HTTP_ERROR', `Creality Cloud respondió con HTTP ${response.status}.`);
  }
  try {
    return JSON.parse(response.text || '{}');
  } catch {
    throw statusError('FINISH_PRINT_STATUS_INVALID_RESPONSE', 'Creality Cloud devolvió una respuesta no válida.');
  }
}

function validateControlResponse(response, code) {
  if (response?.code !== 0 || (response?.result?.code !== undefined && Number(response.result.code) !== 0)) {
    throw statusError(code, response?.msg || 'Creality Cloud rechazó la orden enviada a la impresora.');
  }
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function latestAttributeTimestamp(records) {
  return (Array.isArray(records) ? records : []).reduce((latest, record) =>
    Math.max(latest, Number(record?.lastUpdateTs || 0)), 0);
}

function latestRecordTimestamp(records, keys) {
  const accepted = new Set(keys);
  return (Array.isArray(records) ? records : []).reduce((latest, record) =>
    accepted.has(String(record?.key || ''))
      ? Math.max(latest, Number(record?.lastUpdateTs || 0))
      : latest, 0);
}

function printerErrorDetail(attributes, printRecord, { preferRecord = false, includeAttributes = true } = {}) {
  const recordMessages = [
    printRecord?.printErrorDetail,
    printRecord?.errorMessage,
    printRecord?.errorMsg,
    printRecord?.errorDesc,
    printRecord?.failReason
  ];
  const attributeMessages = [
    attributes.errorMessage,
    attributes.errorMsg,
    attributes.errMsg,
    attributes.errorDesc,
    attributes.errDesc,
    attributes.failReason,
    attributes.error
  ];
  const messages = preferRecord
    ? recordMessages
    : [...(includeAttributes ? attributeMessages : []), ...recordMessages];
  const message = messages
    .map((value) => String(value || '').trim()).find(Boolean);
  if (message) return message;
  return '';
}

function statusError(code, message, diagnostics = null) {
  return Object.assign(new Error(message), { code, diagnostics });
}
