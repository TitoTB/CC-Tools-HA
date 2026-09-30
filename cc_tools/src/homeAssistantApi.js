import { normalizeFinishPrintProfiles } from './finishPrintProfiles.js';
import { countCreditedFinishPrintRun, isFinishPrintStartRun } from './finishPrintSelection.js';

export const HOME_ASSISTANT_API_VERSION = 1;

export const HOME_ASSISTANT_TASKS = Object.freeze({
  checkin: 'creality',
  print: 'finishPrint',
  downloads: 'modelDownloads',
  comments: 'comments',
  boosts: 'modelBoosts',
  likes: 'modelLikes'
});

const TASK_LABELS = Object.freeze({
  creality: 'Check-in diario',
  finishPrint: 'Enviar una impresión',
  modelDownloads: 'Descarga de diseños',
  comments: 'Comentarios',
  modelBoosts: 'Impulsar diseños',
  modelLikes: 'Dar me gusta',
  shopOrders: 'Seguimiento de pedidos',
  shopRedemption: 'Canje de puntos'
});

const EXPOSED_TASKS = Object.entries(HOME_ASSISTANT_TASKS);

export function buildHomeAssistantState({
  config,
  runs = [],
  scheduler = {},
  browser = {},
  dailyCounters = {},
  nextExecutions = {},
  health = {}
}) {
  const timezone = config.timezone || 'Europe/Madrid';
  const latestCheckin = runs.find((run) => run.taskId === 'creality');
  const orders = Array.isArray(config.shopOrders?.items) ? config.shopOrders.items : [];
  const latestOrder = latestShopOrder(orders);
  const taskStates = Object.fromEntries(EXPOSED_TASKS.map(([publicId, internalId]) => {
    const task = config.tasks?.[internalId] || {};
    return [publicId, {
      id: publicId,
      name: TASK_LABELS[internalId],
      enabled: task.enabled === true,
      dailyCount: Math.max(0, Number(dailyCounters[internalId]) || 0),
      dailyLimit: taskDailyLimit(internalId, task),
      lastRunAt: String(task.lastRunAt || ''),
      lastStatus: String(task.lastStatus || 'never'),
      lastMessage: String(task.lastMessage || ''),
      nextRunAt: String(nextExecutions[internalId] || task.nextRunAt || '')
    }];
  }));

  return {
    ok: true,
    apiVersion: HOME_ASSISTANT_API_VERSION,
    generatedAt: new Date().toISOString(),
    account: {
      userId: String(config.crealityProfile?.userId || ''),
      name: String(config.crealityProfile?.name || 'Creality Cloud'),
      avatarUrl: String(config.crealityProfile?.avatarUrl || ''),
      timezone,
      configured: config.setup?.assistantCompleted === true
    },
    points: {
      total: nullableNumber(config.points?.total),
      earnedToday: Math.max(0, Number(config.points?.earnedToday) || 0),
      status: String(config.points?.status || 'unavailable'),
      updatedAt: String(config.points?.updatedAt || config.points?.checkedAt || '')
    },
    rewards: {
      lotteryTickets: raffleTickets(latestCheckin),
      boostsAvailable: Math.max(0, Number(config.tasks?.modelBoosts?.availableBoosts) || 0)
    },
    scheduler: {
      running: scheduler.running === true,
      runningTask: publicTaskId(scheduler.runningTask),
      browserActive: browser.active === true,
      browserMode: String(browser.mode || 'idle')
    },
    health: {
      state: String(health.state || 'active'),
      attempts: Math.max(0, Number(health.attempts) || 0),
      successes: Math.max(0, Number(health.successes) || 0),
      failures: Math.max(0, Number(health.failures) || 0),
      successRate: Math.max(0, Number(health.successRate) || 0),
      reason: String(health.reason || ''),
      pausedUntil: String(health.pausedUntil || '')
    },
    orders: {
      pending: orders.filter((order) => order.statusKind === 'pending' && order.archived !== true).length,
      shipped: orders.filter((order) => order.statusKind === 'shipped' && order.archived !== true).length,
      latest: latestOrder ? homeAssistantOrder(latestOrder) : null,
      updatedAt: String(config.shopOrders?.updatedAt || '')
    },
    tasks: taskStates,
    printers: buildPrinterStates(config.tasks?.finishPrint || {}, runs, timezone)
  };
}

function latestShopOrder(orders) {
  return [...orders].sort((left, right) => {
    const rightDate = Date.parse(right.createdAt || right.updatedAt || '') || 0;
    const leftDate = Date.parse(left.createdAt || left.updatedAt || '') || 0;
    return rightDate - leftDate;
  })[0] || null;
}

function homeAssistantOrder(order) {
  return {
    id: String(order.id || ''),
    orderNumber: String(order.orderNumber || ''),
    title: String(order.title || ''),
    imageUrl: String(order.imageUrl || ''),
    points: Math.max(0, Number(order.points) || 0),
    quantity: Math.max(1, Number(order.quantity) || 1),
    status: String(order.status || 'Estado desconocido'),
    statusKind: String(order.statusKind || 'neutral'),
    useUrl: String(order.useUrl || ''),
    region: String(order.region || ''),
    createdAt: String(order.createdAt || ''),
    updatedAt: String(order.updatedAt || '')
  };
}

export function buildHomeAssistantEvents(runs = [], limit = 100) {
  return runs.map(homeAssistantEvent).filter(Boolean).slice(0, Math.max(1, Math.min(200, Number(limit) || 100)));
}

export function internalTaskId(publicId) {
  return HOME_ASSISTANT_TASKS[String(publicId || '')] || '';
}

function buildPrinterStates(task, runs, timezone) {
  return normalizeFinishPrintProfiles(task).map((profile, index) => {
    const profileRuns = runs.filter((run) => isFinishPrintStartRun(run)
      && (run.details?.printerProfileId === profile.id || (index === 0 && !run.details?.printerProfileId)));
    const lastRun = profileRuns[0];
    return {
      id: profile.id,
      name: profile.printerName || profile.printerDeviceName || `Impresora ${index + 1}`,
      enabled: task.enabled === true,
      dailyCount: runs.filter((run) => countCreditedFinishPrintRun(run) > 0
        && (run.details?.printerProfileId === profile.id || (index === 0 && !run.details?.printerProfileId))
        && isToday(run.finishedAt || run.createdAt, timezone)).length,
      dailyLimit: Math.max(0, Number(profile.dailyLimit) || 0),
      lastRunAt: String(lastRun?.finishedAt || lastRun?.createdAt || ''),
      lastStatus: String(lastRun?.status || 'never'),
      lastGcode: String(lastRun?.details?.file?.name || ''),
      nextRunAt: task.enabled === true ? String(profile.nextRunAt || '') : '',
      available: Boolean(profile.printerName && profile.cloudFileRecords?.length)
    };
  });
}

function homeAssistantEvent(run) {
  if (!run?.id || run.status === 'skipped') return null;
  let type = '';
  if (run.taskId === 'shopOrders' && run.status === 'success') type = 'order_shipped';
  else if (run.taskId === 'shopRedemption' && run.status === 'success') type = 'shop_goal_redeemed';
  else if (Object.values(HOME_ASSISTANT_TASKS).includes(run.taskId)) {
    if (run.taskId === 'finishPrint' && run.status === 'success' && !run.details?.printRecord?.completed) return null;
    type = run.status === 'success' ? 'task_completed' : 'task_failed';
  }
  if (!type) return null;

  const related = run.details?.order
    || run.details?.product
    || run.details?.downloaded?.[0]
    || run.details?.acted?.[0]
    || run.details?.commented?.[0]
    || run.details?.boosted?.[0]
    || run.details?.file
    || {};
  return {
    id: String(run.id),
    type,
    task: publicTaskId(run.taskId),
    taskName: TASK_LABELS[run.taskId] || run.taskId,
    status: String(run.status || ''),
    source: String(run.source || ''),
    message: String(run.message || ''),
    occurredAt: String(run.finishedAt || run.createdAt || ''),
    related: {
      id: String(related.id || related.printId || ''),
      title: String(related.title || related.name || ''),
      url: String(related.url || ''),
      status: String(related.status || '')
    }
  };
}

function publicTaskId(internalId) {
  return EXPOSED_TASKS.find(([, value]) => value === internalId)?.[0] || String(internalId || '');
}

function taskDailyLimit(taskId, task) {
  if (taskId === 'creality') return 1;
  if (taskId === 'finishPrint') {
    return normalizeFinishPrintProfiles(task).reduce((total, profile) => total + profile.dailyLimit, 0);
  }
  return Math.max(0, Number(task.dailyLimit) || 0);
}

function raffleTickets(run) {
  const raffle = run?.details?.raffle;
  if (!raffle) return null;
  if (Number.isFinite(Number(raffle.remainingTickets))) return Math.max(0, Number(raffle.remainingTickets));
  if (Number.isFinite(Number(raffle.tickets))) return Math.max(0, Number(raffle.tickets));
  return null;
}

function nullableNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function isToday(value, timezone) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return false;
  return dayKey(date, timezone) === dayKey(new Date(), timezone);
}

function dayKey(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}
