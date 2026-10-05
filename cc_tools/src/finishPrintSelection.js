export function normalizeGcodeFiles(files) {
  return [...new Set((Array.isArray(files) ? files : [])
    .map((file) => String(file || '').trim())
    .filter((file) => /\.gcode$/i.test(file)))]
    .slice(0, 100);
}

export function normalizeGcodeRecords(files) {
  const unique = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    const name = String(file?.name || '').trim();
    const id = String(file?.id || '').trim();
    if (!id || !/\.gcode$/i.test(name) || unique.has(id)) continue;
    unique.set(id, {
      id,
      name,
      printTime: Math.max(0, Number(file?.printTime) || 0),
      ...(file?.quantity !== undefined ? { quantity: clampQuantity(file.quantity) } : {})
    });
  }
  return [...unique.values()].slice(0, 100);
}

export function printUsageKey(file) {
  return String(file?.id || file?.name || '').trim();
}

export function incrementPrintUsage(finishPrint, file) {
  const key = printUsageKey(file);
  if (!key) return 0;
  finishPrint.fileUsageCounts = finishPrint.fileUsageCounts && typeof finishPrint.fileUsageCounts === 'object'
    ? finishPrint.fileUsageCounts
    : {};
  const count = Math.max(0, Number(finishPrint.fileUsageCounts[key]) || 0) + 1;
  finishPrint.fileUsageCounts[key] = count;
  return count;
}

export function buildPrintUsageHistory(runs) {
  const counts = {};
  const seenPrintIds = new Set();
  for (const run of Array.isArray(runs) ? runs : []) {
    if (run?.taskId !== 'finishPrint' || run?.status !== 'success') continue;
    const printId = String(run?.details?.printId || '').trim();
    const file = run?.details?.file;
    const key = printUsageKey(file);
    if (!printId || !key || seenPrintIds.has(printId)) continue;
    seenPrintIds.add(printId);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function countCreditedFinishPrintRun(run) {
  if (run?.taskId !== 'finishPrint' || run?.status !== 'success') return 0;
  if (!run?.details?.printRecord?.completed) return 0;
  return run?.details?.rewardVerification?.status === 'credited' ? 1 : 0;
}

export function isFinishPrintStartRun(run) {
  if (run?.taskId !== 'finishPrint') return false;
  if (run?.details?.printRecord) return false;
  if (run?.details?.printId) return true;
  return run?.source === 'schedule';
}

export function normalizePrintMode(mode) {
  return ['quantities', 'ordered', 'random'].includes(mode) ? mode : 'random';
}

export function buildPrintShuffleBag(configOrFiles, random = Math.random) {
  const config = Array.isArray(configOrFiles) ? { cloudFiles: configOrFiles } : (configOrFiles || {});
  const files = normalizeGcodeFiles(config.cloudFiles);
  const records = normalizeGcodeRecords(config.cloudFileRecords);
  const mode = normalizePrintMode(config.printMode);
  if (mode === 'ordered') return files;
  if (mode === 'quantities') {
    const quantities = new Map(records.map((file) => [file.name, file.quantity]));
    return files.flatMap((file) => Array(quantities.get(file) || 1).fill(file));
  }

  const bag = files.flatMap((file) => [file, file, file]);

  for (let index = bag.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [bag[index], bag[target]] = [bag[target], bag[index]];
  }

  return bag;
}

export function selectNextPrintFile(config, random = Math.random) {
  const files = normalizeGcodeFiles(config.cloudFiles);
  let bag = Array.isArray(config.shuffleBag)
    ? config.shuffleBag.filter((file) => files.includes(file))
    : [];
  let cursor = Math.max(0, Number(config.shuffleBagCursor) || 0);

  if (!bag.length || cursor >= bag.length) {
    bag = buildPrintShuffleBag(config, random);
    cursor = 0;
  }

  const file = bag[cursor] || '';
  return {
    file,
    shuffleBag: bag,
    shuffleBagCursor: file ? cursor + 1 : 0
  };
}

function clampQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? Math.min(99, Math.max(1, Math.round(quantity))) : 1;
}
