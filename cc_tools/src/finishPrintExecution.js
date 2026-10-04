import { withAutomationBrowser } from './browserManager.js';
import {
  waitForAuthenticationHeaders,
  WORKBENCH_URL
} from './finishPrintDiscovery.js';
import { observeCrealityPage } from './crealityDiagnostics.js';
import {
  compareIncentiveProgress,
  readIncentiveProgress,
  waitForIncentiveProgress
} from './incentiveTasks.js';

const CHECK_PRINT_PATH = '/api/rest/print/cluster/devices/checkGcodePrintDevice';
const ADD_PRINT_TASK_PATH = '/api/rest/print/cluster/addSingleTask';
const PRINT_RECORD_DETAIL_PATH = '/api/cxy/v3/print/record/detail';
const FINISH_PRINT_INCENTIVE_TITLE = 'Finish a Print';
const SELECT_DEVICE_BASE_URL = 'https://www.crealitycloud.com/es/workbench-beta/select-device';
const PRINT_REQUEST_TIMEOUT_MS = 60 * 1000;

export function buildPrintCheckPayload({ deviceName, gcodeId }) {
  return {
    dn: String(deviceName || '').trim(),
    selectedGcodeId: String(gcodeId || '').trim()
  };
}

export function buildPrintTaskPayload({ deviceName, gcodeId, fileName }) {
  return {
    taskName: String(fileName || '').trim(),
    deviceName: String(deviceName || '').trim(),
    printCount: 1,
    gcodeId: String(gcodeId || '').trim()
  };
}

export function buildSelectDeviceUrl(gcodeId) {
  return `${SELECT_DEVICE_BASE_URL}/${encodeURIComponent(String(gcodeId || '').trim())}?type=1`;
}

export function validatePrintCheck(response, context = {}) {
  if (response?.code !== 0) {
    throw printCheckError(
      'FINISH_PRINT_CHECK_REJECTED',
      response?.msg || 'Creality Cloud rechazó la validación del G-code.',
      response,
      context
    );
  }
  if (Number(response?.result?.printable) !== 1) {
    throw printCheckError(
      'FINISH_PRINT_NOT_PRINTABLE',
      'El G-code seleccionado no se puede imprimir en la impresora virtual.',
      response,
      context
    );
  }
  return response.result;
}

export function validatePrintTask(response) {
  const result = response?.result || {};
  if (response?.code !== 0 || Number(result.errCode || 0) !== 0 || !result.printInfo || !result.taskInfo) {
    throw executionError('FINISH_PRINT_TASK_REJECTED', response?.msg || 'Creality Cloud no aceptó el trabajo de impresión.');
  }
  return {
    printId: String(result.printInfo.id || '').trim(),
    taskId: String(result.taskInfo.taskId || '').trim(),
    taskName: String(result.taskInfo.taskName || result.gcodeInfo?.name || '').trim()
  };
}

export function parsePrintRecord(response) {
  if (response?.code !== 0 || !response?.result) {
    throw executionError(
      'FINISH_PRINT_STATUS_REJECTED',
      response?.msg || 'Creality Cloud no devolvió el estado de la impresión.'
    );
  }
  const record = response.result;
  const printState = Number(record.printState);
  const printError = Number(record.printErr || 0);
  const printErrorDetail = [
    record.errorMessage,
    record.errorMsg,
    record.errMsg,
    record.errorDesc,
    record.errDesc,
    record.failReason
  ].map((value) => String(value || '').trim()).find(Boolean) || '';
  const printStartTime = Number(record.printStartTime || 0);
  const printEndTime = Number(record.printEndTime || 0);
  const failed = [3, 4].includes(printState) || printError > 0;
  const completed = !failed && printEndTime > 0 && printEndTime >= printStartTime && ![1, 5].includes(printState);
  return {
    printId: String(record.id || '').trim(),
    gcodeId: String(record.gcodeId || '').trim(),
    name: String(record.name || record.gcodeInfo?.name || '').trim(),
    printState,
    printError,
    printErrorDetail,
    printJobTime: Number(record.printJobTime || 0),
    printStartTime,
    printEndTime,
    completed,
    failed,
    active: [1, 5].includes(printState),
    paused: printState === 5,
    stateLabel: ({ 0: 'En reposo', 1: 'Imprimiendo', 2: 'Finalizada', 3: 'Error', 4: 'Detenida', 5: 'Pausada' })[printState]
      || `Estado ${Number.isFinite(printState) ? printState : 'desconocido'}`,
    diagnostics: {
      printState,
      printError,
      printErrorDetail,
      printStartTime,
      printEndTime,
      printJobTime: Number(record.printJobTime || 0),
      deviceName: String(record.deviceName || record.dn || '').trim(),
      deviceType: record.deviceType ?? null,
      model: String(record.model || '').trim()
    }
  };
}

export function executeVirtualPrint({
  printerName,
  deviceId,
  deviceName,
  printerInterName,
  deviceType,
  file,
  timezone = 'Europe/Madrid'
}) {
  const gcodeId = String(file?.id || '').trim();
  const fileName = String(file?.name || '').trim();
  const normalizedDeviceName = String(deviceName || '').trim();
  if (!normalizedDeviceName) {
    throw executionError('FINISH_PRINT_DEVICE_REQUIRED', 'Actualiza las impresoras y vuelve a guardar la impresora virtual.');
  }
  if (!gcodeId || !fileName) {
    throw executionError('FINISH_PRINT_GCODE_ID_REQUIRED', 'Actualiza los archivos G-code y vuelve a guardar la selección.');
  }

  return withAutomationBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    const observer = observeCrealityPage(page, 'finishPrint');
    try {
      const incentiveBefore = await readIncentiveProgress(page, observer, FINISH_PRINT_INCENTIVE_TITLE, {
        timezone,
        includePoints: false,
        requireTaskList: true
      });
      const authenticationHeaders = await workbenchAuthenticationHeaders(page, gcodeId);
      const checkPayload = buildPrintCheckPayload({ deviceName: normalizedDeviceName, gcodeId });
      const check = await requestJson(
        page,
        CHECK_PRINT_PATH,
        checkPayload,
        authenticationHeaders
      );
      validatePrintCheck(check, {
        endpoint: CHECK_PRINT_PATH,
        request: checkPayload,
        printer: {
          name: String(printerName || '').trim(),
          deviceId: String(deviceId || '').trim(),
          deviceName: normalizedDeviceName,
          printerInterName: String(printerInterName || '').trim(),
          deviceType: Number.isFinite(Number(deviceType)) ? Number(deviceType) : null
        },
        gcode: {
          id: gcodeId,
          name: fileName,
          printTime: Math.max(0, Number(file?.printTime) || 0)
        },
        selectDeviceUrl: buildSelectDeviceUrl(gcodeId)
      });
      const task = await requestJson(
        page,
        ADD_PRINT_TASK_PATH,
        buildPrintTaskPayload({ deviceName: normalizedDeviceName, gcodeId, fileName }),
        authenticationHeaders
      );
      return {
        ...validatePrintTask(task),
        file: { id: gcodeId, name: fileName },
        rewardVerification: {
          status: incentiveBefore.found ? 'pending' : 'unverified',
          before: incentiveBefore
        }
      };
    } finally {
      observer.stop();
    }
  });
}

export function verifyVirtualPrint({ printId, gcodeId, rewardBefore, timezone = 'Europe/Madrid' }) {
  const normalizedPrintId = String(printId || '').trim();
  if (!normalizedPrintId) {
    throw executionError('FINISH_PRINT_ID_REQUIRED', 'No se guardó el identificador de la impresión pendiente.');
  }

  return withAutomationBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    const observer = observeCrealityPage(page, 'finishPrintVerification');
    try {
      const authenticationHeaders = await workbenchAuthenticationHeaders(page, gcodeId);
      const response = await requestJson(
        page,
        PRINT_RECORD_DETAIL_PATH,
        { id: normalizedPrintId },
        authenticationHeaders
      );
      const printRecord = parsePrintRecord(response);
      if (printRecord.failed) {
        return { status: 'failed', printRecord };
      }
      if (!printRecord.completed) {
        return { status: 'printing', printRecord };
      }

      if (!rewardBefore?.found) {
        const after = await readRewardProgressSafely(page, observer, timezone);
        return {
          status: 'unverified',
          printRecord,
          rewardVerification: { status: 'unverified', before: rewardBefore, after }
        };
      }

      let after;
      try {
        after = await waitForIncentiveProgress(
          page,
          observer,
          FINISH_PRINT_INCENTIVE_TITLE,
          rewardBefore,
          [0, 10000, 15000, 20000],
          { timezone }
        );
      } catch (error) {
        return {
          status: 'unverified',
          printRecord,
          rewardVerification: {
            status: 'unverified',
            before: rewardBefore,
            error: error.code || error.message || String(error)
          }
        };
      }
      const rewardVerification = compareIncentiveProgress(rewardBefore, after);
      return { status: rewardVerification.status, printRecord, rewardVerification };
    } finally {
      observer.stop();
    }
  });
}

async function readRewardProgressSafely(page, observer, timezone) {
  try {
    return await readIncentiveProgress(page, observer, FINISH_PRINT_INCENTIVE_TITLE, { timezone });
  } catch (error) {
    return {
      found: false,
      title: FINISH_PRINT_INCENTIVE_TITLE,
      error: error.code || error.message || String(error),
      checkedAt: new Date().toISOString()
    };
  }
}

async function workbenchAuthenticationHeaders(page, gcodeId = '') {
  const authenticationHeaders = waitForAuthenticationHeaders(page);
  const targetUrl = String(gcodeId || '').trim()
    ? buildSelectDeviceUrl(gcodeId)
    : WORKBENCH_URL;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  const headers = await authenticationHeaders;
  if (!headers) {
    const error = executionError(
      'FINISH_PRINT_AUTH_REQUEST_NOT_OBSERVED',
      'Creality Cloud no realizó la consulta autenticada del Banco de trabajo.'
    );
    error.silentRetry = true;
    throw error;
  }
  return headers;
}

async function requestJson(page, path, body, authenticationHeaders) {
  const response = await page.evaluate(async ({ path: endpoint, body: payload, headers, timeoutMs }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      return { status: result.status, text: await result.text() };
    } catch (error) {
      return {
        status: 0,
        text: '',
        error: error?.message || String(error),
        timedOut: error?.name === 'AbortError'
      };
    } finally {
      clearTimeout(timeout);
    }
  }, { path, body, headers: authenticationHeaders, timeoutMs: PRINT_REQUEST_TIMEOUT_MS });

  if (!response.status) {
    if (response.timedOut) {
      throw executionError(
        'FINISH_PRINT_REQUEST_TIMEOUT',
        'Creality Cloud tardó demasiado en responder al consultar la impresión.'
      );
    }
    throw executionError('FINISH_PRINT_NETWORK_FAILURE', `No se pudo contactar con Creality Cloud: ${response.error || 'error de red'}.`);
  }
  if (response.status === 404 && path === PRINT_RECORD_DETAIL_PATH) {
    throw executionError('FINISH_PRINT_RECORD_NOT_FOUND', 'Creality Cloud ya no encuentra el registro de esta impresión.');
  }
  if (response.status < 200 || response.status >= 300) {
    throw executionError('FINISH_PRINT_HTTP_ERROR', `Creality Cloud respondió con HTTP ${response.status}.`);
  }
  try {
    return JSON.parse(response.text || '{}');
  } catch {
    throw executionError('FINISH_PRINT_INVALID_RESPONSE', 'Creality Cloud devolvió una respuesta no válida.');
  }
}

function executionError(code, message) {
  return Object.assign(new Error(message), { code });
}

function printCheckError(code, message, response, context = {}) {
  const error = executionError(code, message);
  error.technical = JSON.stringify({
    stage: 'checkGcodePrintDevice',
    endpoint: context.endpoint || CHECK_PRINT_PATH,
    request: context.request || null,
    printer: context.printer || null,
    gcode: context.gcode || null,
    selectDeviceUrl: context.selectDeviceUrl || '',
    response: response || null
  });
  return error;
}
