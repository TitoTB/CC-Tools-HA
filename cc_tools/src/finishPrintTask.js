import { executeVirtualPrint } from './finishPrintExecution.js';
import {
  incrementPrintUsage,
  normalizeGcodeRecords,
  selectNextPrintFile
} from './finishPrintSelection.js';

export async function startVirtualPrint(taskConfig = {}) {
  const selection = selectNextPrintFile(taskConfig);
  const file = normalizeGcodeRecords(taskConfig.cloudFileRecords)
    .find((record) => record.name === selection.file);

  if (taskConfig.pendingVerification?.printId) {
    const error = printTaskError(
      'FINISH_PRINT_VERIFICATION_PENDING',
      'Hay una impresión pendiente de finalizar y verificar.',
      file
    );
    error.technical = JSON.stringify({
      printId: taskConfig.pendingVerification.printId,
      printerProfileId: taskConfig.pendingVerification.printerProfileId || '',
      printerName: taskConfig.pendingVerification.printerName || '',
      startedAt: taskConfig.pendingVerification.startedAt || '',
      lastCheckedAt: taskConfig.pendingVerification.lastCheckedAt || '',
      nextCheckAt: taskConfig.pendingVerification.nextCheckAt || '',
      verificationError: taskConfig.pendingVerification.verificationError || '',
      printRecord: taskConfig.pendingVerification.printRecord || null
    });
    throw error;
  }
  if (!selection.file) {
    throw printTaskError(
      'FINISH_PRINT_FILE_REQUIRED',
      'Selecciona y guarda al menos un archivo G-code.'
    );
  }
  if (!file) {
    throw printTaskError(
      'FINISH_PRINT_GCODE_ID_REQUIRED',
      'Actualiza los archivos G-code y vuelve a guardar la selección.'
    );
  }

  try {
    const execution = await executeVirtualPrint({
      printerName: taskConfig.printerName,
      deviceId: taskConfig.printerDeviceId,
      deviceName: taskConfig.printerDeviceName,
      printerInterName: taskConfig.printerInterName,
      deviceType: taskConfig.printerDeviceType,
      file,
      timezone: taskConfig.timezone || 'Europe/Madrid'
    });
    return {
      success: true,
      message: `Impresión iniciada: ${file.name}`,
      details: {
        ...execution,
        printerProfileId: taskConfig.activePrinterProfileId || '',
        printerName: taskConfig.printerName || taskConfig.printerDeviceName || '',
        ...(taskConfig.manualSelection === true ? { manualSelection: true } : {}),
        selection: {
          shuffleBag: selection.shuffleBag,
          shuffleBagCursor: selection.shuffleBagCursor
        }
      }
    };
  } catch (error) {
    error.finishPrintFile = file;
    throw error;
  }
}

export function manualVirtualPrintConfig(taskConfig = {}, selection = {}) {
  const printer = selection.printer && typeof selection.printer === 'object' ? selection.printer : {};
  const [file] = normalizeGcodeRecords([selection.file]);
  const printerName = String(printer.name || '').trim();
  const printerDeviceName = String(printer.deviceName || printerName).trim();
  if (!printerName || !printerDeviceName) {
    throw printTaskError('FINISH_PRINT_PRINTER_REQUIRED', 'Selecciona una impresora.');
  }
  if (!file) {
    throw printTaskError('FINISH_PRINT_FILE_REQUIRED', 'Selecciona un archivo G-code.');
  }
  return {
    ...taskConfig,
    activePrinterProfileId: '',
    printerName,
    printerDeviceId: String(printer.deviceId || '').trim(),
    printerDeviceName,
    printerTelemetryId: String(printer.telemetryId || '').trim(),
    printerInterName: String(printer.printerInterName || '').trim(),
    printerDeviceType: printer.deviceType ?? null,
    cloudFiles: [file.name],
    cloudFileRecords: [file],
    printMode: 'ordered',
    shuffleBag: [],
    shuffleBagCursor: 0,
    manualSelection: true
  };
}

export function applyStartedVirtualPrint(finishPrint, result, source = 'manual', startedAt = new Date()) {
  const details = result?.details || {};
  const file = details.file || {};
  finishPrint.shuffleBag = details.selection?.shuffleBag || finishPrint.shuffleBag || [];
  finishPrint.shuffleBagCursor = Math.max(0, Number(details.selection?.shuffleBagCursor) || 0);
  incrementPrintUsage(finishPrint, file);
  finishPrint.pendingVerification = {
    printId: details.printId,
    taskId: details.taskId,
    file,
    source,
    ...(details.printerProfileId || finishPrint.activePrinterProfileId
      ? { printerProfileId: details.printerProfileId || finishPrint.activePrinterProfileId }
      : {}),
    ...(details.printerName || finishPrint.printerName
      ? { printerName: details.printerName || finishPrint.printerName }
      : {}),
    ...(details.manualSelection === true ? { manualSelection: true } : {}),
    timezone: finishPrint.timezone || 'Europe/Madrid',
    rewardBefore: details.rewardVerification?.before || null,
    startedAt: startedAt.toISOString(),
    nextCheckAt: new Date(startedAt.getTime() + 5 * 60 * 1000).toISOString(),
    lastCheckedAt: '',
    verificationAttempts: 0
  };
  return finishPrint;
}

function printTaskError(code, message, file = null) {
  return Object.assign(new Error(message), { code, finishPrintFile: file });
}
