export const FINISH_PRINT_SAFETY_MINUTES = 5;
export const DEFAULT_FINISH_PRINT_DURATION_MINUTES = 10;

export function estimatedFinishPrintDurationMinutes(taskConfig = {}) {
  const durations = (Array.isArray(taskConfig.cloudFileRecords) ? taskConfig.cloudFileRecords : [])
    .map((file) => Math.ceil(Math.max(0, Number(file?.printTime) || 0) / 60))
    .filter((minutes) => minutes > 0);

  return durations.length
    ? Math.max(...durations)
    : DEFAULT_FINISH_PRINT_DURATION_MINUTES;
}

export function finishPrintSlotMinutes(taskConfig = {}) {
  const minIntervalMinutes = Math.max(10, Number(taskConfig.minIntervalMinutes) || 10);
  return minIntervalMinutes
    + estimatedFinishPrintDurationMinutes(taskConfig)
    + FINISH_PRINT_SAFETY_MINUTES;
}

export function requiredFinishPrintWindowMinutes(taskConfig = {}) {
  const dailyLimit = Math.max(0, Math.min(10, Number(taskConfig.dailyLimit) || 0));
  return dailyLimit * finishPrintSlotMinutes(taskConfig);
}
