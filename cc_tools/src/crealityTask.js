import path from 'path';
import { screenshotsDir } from './storage.js';
import {
  closeInteractiveBrowser,
  openInteractiveBrowser,
  withAutomationBrowser
} from './browserManager.js';
import {
  captureDiagnosticScreenshot,
  diagnoseTaskError,
  inspectCrealityPage,
  observeCrealityPage
} from './crealityDiagnostics.js';
import { readPointsSummary } from './pointsCounter.js';
import { submitDailyCheckin } from './checkinReminder.js';

const CHECKIN_URL = 'https://www.crealitycloud.com/check-in';

export async function openLoginBrowser() {
  await openInteractiveBrowser(CHECKIN_URL);
  return { ok: true, message: 'Navegador de login abierto.' };
}

export async function closeLoginBrowser() {
  const closed = await closeInteractiveBrowser();
  if (!closed) return { ok: true, message: 'No había ningún navegador abierto.' };
  return { ok: true, message: 'Navegador cerrado. La sesión queda guardada si el login se completó.' };
}

export async function runCrealityCheckin(options = {}) {
  return withAutomationBrowser({}, async (context) => {
    const screenshots = [];
    const page = context.pages()[0] || await context.newPage();
    const observer = observeCrealityPage(page, 'creality');
    try {
      const checkin = await executeCheckin(page, screenshots, observer);
      if (options.skipRaffle) {
        const pointsSummary = checkin.success
          ? await readPointsSummary(page, { timezone: options.timezone })
          : null;
        return {
          success: checkin.success,
          message: manualCheckinMessage(checkin),
          details: checkinDetails(checkin, null, pointsSummary),
          screenshots
        };
      }

      let raffle = { status: 'skipped', success: true, message: 'Lotería no ejecutada.', prizes: [] };
      const pointsBeforeRaffle = checkin.success
        ? await readPointsSummary(page, { timezone: options.timezone })
        : null;
      if (checkin.success) {
        try {
          raffle = await executeRaffle(page, screenshots);
        } catch (error) {
          const diagnostic = await diagnoseTaskError(error, page, observer);
          const screenshot = await captureDiagnosticScreenshot(page, 'raffle', diagnostic.code);
          if (screenshot) screenshots.push(screenshot);
          raffle = {
            success: false,
            status: 'draw_failed',
            warning: true,
            reason: diagnostic.message,
            prizes: [],
            diagnostic
          };
        }
      }
      let pointsSummary = checkin.success
        ? await readPointsSummary(page, { timezone: options.timezone })
        : null;
      if (raffleHasAmbiguousPrize(raffle) && !pointsIncreased(pointsBeforeRaffle, pointsSummary)) {
        await page.waitForTimeout(10000);
        pointsSummary = await readPointsSummary(page, {
          timezone: options.timezone,
          fallbackTotal: pointsSummary?.total
        });
      }
      raffle = reconcileRafflePoints(raffle, pointsBeforeRaffle, pointsSummary);

      return {
        success: checkin.success,
        message: buildCheckinRunMessage(checkin, raffle),
        details: checkinDetails(checkin, raffle, pointsSummary),
        screenshots
      };
    } catch (error) {
      const diagnostic = await diagnoseTaskError(error, page, observer);
      const screenshot = await captureDiagnosticScreenshot(page, 'checkin', diagnostic.code);
      if (screenshot) screenshots.push(screenshot);
      const checkin = {
        success: false,
        status: diagnostic.code.toLowerCase(),
        reason: diagnostic.message,
        message: diagnostic.message,
        diagnostic
      };
      return {
        success: false,
        message: `Check-in fallido\nMotivo: ${diagnostic.message}`,
        details: checkinDetails(checkin),
        screenshots
      };
    } finally {
      observer.stop();
    }
  });
}

async function executeCheckin(page, screenshots, observer) {
  await page.goto(CHECKIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const initialDiagnostic = await inspectCrealityPage(page, observer, { requireBody: true });
  if (initialDiagnostic) {
    const screenshot = await takeScreenshot(page, initialDiagnostic.code.toLowerCase());
    screenshots.push(screenshot);
    return {
      success: false,
      status: initialDiagnostic.code.toLowerCase(),
      reason: initialDiagnostic.message,
      message: initialDiagnostic.message,
      diagnostic: initialDiagnostic
    };
  }

  const container = await page.locator('iframe.iframe-box').count()
    ? page.frameLocator('iframe.iframe-box')
    : page;

  await page.waitForTimeout(2500);

  const result = await submitDailyCheckin(page, container);
  if (result.status !== 'unknown_state') {
    screenshots.push(await takeScreenshot(page, `checkin-${result.status}`));
    return result;
  }

  const finalDiagnostic = await inspectCrealityPage(page, observer, { requireBody: true });
  if (finalDiagnostic) {
    const screenshot = await takeScreenshot(page, finalDiagnostic.code.toLowerCase());
    screenshots.push(screenshot);
    return {
      success: false,
      status: finalDiagnostic.code.toLowerCase(),
      reason: finalDiagnostic.message,
      message: finalDiagnostic.message,
      diagnostic: finalDiagnostic
    };
  }

  const screenshot = await takeScreenshot(page, 'checkin-not-found');
  screenshots.push(screenshot);
  return result;
}

export async function executeRaffle(page, screenshots = [], options = {}) {
  const activeChannel = Number(options.activeChannel) || 6;
  const raffleUrl = `https://share.crealitycloud.com/boost-sign-in?activeChannel=${activeChannel}`;
  await page.goto(raffleUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const selectAccount = page.locator('text=Select Account');
  if (await selectAccount.count()) {
    const continueButton = page.locator('button, [role="button"]').filter({ hasText: /continue|continuar/i }).first();
    if (await continueButton.count()) {
      await continueButton.click().catch(() => {});
      await page.waitForTimeout(8000);
    }
  }

  const counter = page.locator('.lucky-draw-left .num');
  if (!(await counter.count())) {
    const screenshot = await takeScreenshot(page, 'raffle-unavailable');
    screenshots.push(screenshot);
    return {
      success: true,
      status: 'counter_unavailable',
      warning: true,
      reason: 'No se pudo leer el contador de boletos',
      prizes: []
    };
  }

  let tickets = Number.parseInt((await counter.innerText()).trim(), 10) || 0;
  if (tickets <= 0) {
    return { success: true, status: 'no_tickets', tickets: 0, prizes: [] };
  }

  const prizes = [];
  const initialTickets = tickets;
  for (let attempt = 1; tickets > 0 && attempt <= 10; attempt += 1) {
    const previousDialog = await findVisibleRaffleDialog(page);
    if (previousDialog && !(await dismissDialog(page, previousDialog))) {
      screenshots.push(await takeScreenshot(page, `raffle-dialog-blocked-${attempt}`));
      return raffleFailure(initialTickets, tickets, prizes, 'No se pudo cerrar el premio anterior');
    }

    const startButton = page.locator('.start-btn').first();
    if (!(await startButton.count())) {
      screenshots.push(await takeScreenshot(page, `raffle-start-missing-${attempt}`));
      return raffleFailure(
        initialTickets,
        tickets,
        prizes,
        prizes.length
          ? 'No se pudo confirmar el resultado de uno de los sorteos'
          : 'No se pudo encontrar el botón del sorteo'
      );
    }

    const previousTickets = tickets;
    try {
      await startButton.click({ timeout: 6000 });
    } catch (error) {
      screenshots.push(await takeScreenshot(page, `raffle-start-blocked-${attempt}`));
      return raffleFailure(initialTickets, tickets, prizes, error.message);
    }

    const dialog = await waitForRaffleDialog(page, 6000);

    if (dialog) {
      const text = normalize(await dialog.locator('.win-name').first().textContent().catch(() => ''));
      prizes.push(text || extractPrize(normalize(await dialog.innerText().catch(() => 'Premio desconocido'))));
      screenshots.push(await takeScreenshot(page, `raffle-win-${attempt}`));
      if (!(await dismissDialog(page, dialog))) {
        return raffleFailure(initialTickets, Math.max(0, previousTickets - 1), prizes, 'No se pudo cerrar el resultado del sorteo');
      }
    } else {
      await page.waitForTimeout(2000);
      tickets = Number.parseInt((await counter.innerText()).trim(), 10) || 0;
      if (tickets < previousTickets) {
        prizes.push('Sin premio');
        continue;
      }
      screenshots.push(await takeScreenshot(page, `raffle-error-${attempt}`));
      return raffleFailure(
        initialTickets,
        tickets,
        prizes,
        prizes.length
          ? 'No se pudo confirmar el resultado de uno de los sorteos'
          : 'No se pudo confirmar el resultado del sorteo'
      );
    }

    tickets = await waitForTicketCount(page, counter, previousTickets);
  }

  return {
    success: true,
    status: tickets <= 0 ? 'completed' : 'partial',
    warning: tickets > 0,
    reason: tickets > 0 ? 'Quedaron boletos pendientes después del límite de sorteos' : '',
    tickets: initialTickets,
    remainingTickets: tickets,
    prizes
  };
}

async function dismissDialog(page, dialog) {
  const button = dialog.locator('button, [role="button"], .cus-button, .el-button, .win-btn, [class*="confirm"], span, div, a')
    .filter({ hasText: /^\s*(Got\s*it|Entendido|Aceptar|Close|Confirm|OK|Ok)\s*$/i })
    .first();
  if (await button.count()) {
    await button.click({ timeout: 3000, force: true }).catch(() => {});
  }
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.evaluate((root) => {
      const labels = /^(Got\s*it|Entendido|Aceptar|Close|Confirm|OK)$/i;
      const controls = root.querySelectorAll('button, [role="button"], .cus-button, .el-button, .win-btn, [class*="confirm"], a, span, div');
      const target = [...controls].find((element) => labels.test(String(element.textContent || '').trim()));
      target?.click();
    }).catch(() => {});
  }
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
  }
  return dialog.waitFor({ state: 'hidden', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
}

async function findVisibleRaffleDialog(page) {
  for (const selector of ['.boost-win_dialog', '.el-dialog__wrapper', '[role="dialog"]']) {
    const dialogs = page.locator(selector);
    for (let index = (await dialogs.count()) - 1; index >= 0; index -= 1) {
      const dialog = dialogs.nth(index);
      if (await dialog.isVisible().catch(() => false)) return dialog;
    }
  }
  return null;
}

async function waitForRaffleDialog(page, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const dialog = await findVisibleRaffleDialog(page);
    if (dialog) return dialog;
    await page.waitForTimeout(250);
  }
  return null;
}

async function waitForTicketCount(page, counter, previousTickets) {
  const deadline = Date.now() + 6000;
  let tickets = previousTickets;
  while (Date.now() < deadline) {
    tickets = Number.parseInt((await counter.innerText()).trim(), 10) || 0;
    if (tickets < previousTickets) return tickets;
    await page.waitForTimeout(300);
  }
  return tickets;
}

export function raffleFailure(initialTickets, remainingTickets, prizes = [], reason = '') {
  return {
    success: false,
    status: prizes.length ? 'partial' : 'draw_failed',
    warning: true,
    reason,
    tickets: initialTickets,
    remainingTickets,
    prizes
  };
}

async function takeScreenshot(page, label) {
  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.png`;
  const fullPath = path.join(screenshotsDir(), filename);
  await page.screenshot({ path: fullPath, fullPage: true });
  return `/screenshots/${filename}`;
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function manualCheckinMessage(checkin) {
  if (checkin.status === 'already_done') return 'Check-in ya realizado hoy.';
  if (checkin.status === 'completed_now') return 'Check-in completado correctamente.';
  return checkin.message || 'Check-in fallido';
}

function checkinDetails(checkin, raffle, pointsSummary) {
  const details = { checkin };
  if (raffle) details.raffle = raffle;
  if (pointsSummary) details.pointsSummary = pointsSummary;
  if (raffle?.diagnostic) {
    details.diagnostics = [raffle.diagnostic];
    if (raffle.diagnostic.systemic) details.incident = raffle.diagnostic;
  }
  if (checkin.diagnostic) {
    details.diagnostics = [checkin.diagnostic];
    if (checkin.diagnostic.systemic) details.incident = checkin.diagnostic;
  }
  return details;
}

export function buildCheckinRunMessage(checkin, raffle) {
  const lines = [];
  if (checkin.status === 'already_done') {
    lines.push('Check-in ya realizado');
  } else if (checkin.status === 'completed_now') {
    lines.push('Check-in completado');
    lines.push(`Recompensa: ${checkin.reward || 'no detectada'}`);
  } else {
    lines.push('Check-in fallido');
    lines.push(`Motivo: ${checkin.reason || 'error técnico durante la ejecución'}`);
    return lines.join('\n');
  }

  if (!raffle || raffle.status === 'skipped') return lines.join('\n');
  if (raffle.status === 'no_tickets') {
    lines.push('Lotería: sin boletos disponibles');
  } else if (raffle.status === 'completed') {
    lines.push(formatRafflePrizes(raffle.prizes));
  } else if (raffle.status === 'counter_unavailable') {
    lines.push('Lotería: no se pudo leer el contador de boletos');
  } else if (raffle.status === 'draw_failed') {
    lines.push('Lotería: no se pudo confirmar el resultado del sorteo');
  } else if (raffle.status === 'partial') {
    lines.push(formatRafflePrizes(raffle.prizes));
    const remaining = Number(raffle.remainingTickets);
    lines.push(Number.isFinite(remaining) && remaining > 0
      ? `Lotería: ${remaining} ${remaining === 1 ? 'boleto pendiente' : 'boletos pendientes'}`
      : 'Lotería: no se pudo confirmar el resultado de uno de los sorteos');
  }
  return lines.join('\n');
}

function formatRafflePrizes(prizes = []) {
  if (!prizes.length) return 'Lotería: sin premio detectado';
  if (prizes.length === 1) return `Lotería: ${prizes[0]}`;
  return `Lotería:\n${prizes.map((prize) => `- ${prize}`).join('\n')}`;
}

export function reconcileRafflePoints(raffle, before, after) {
  if (!raffle || !pointsIncreased(before, after)) return raffle;
  const prizes = Array.isArray(raffle.prizes) ? [...raffle.prizes] : [];
  const ambiguousIndex = prizes.findIndex((prize) => /^Sin premio$/i.test(String(prize || '').trim()));
  if (ambiguousIndex < 0) return raffle;

  const delta = Number(after.total) - Number(before.total);
  prizes[ambiguousIndex] = `${delta} ${delta === 1 ? 'punto' : 'puntos'}`;
  return { ...raffle, prizes, pointsDelta: delta, prizeConfirmedByPoints: true };
}

function raffleHasAmbiguousPrize(raffle) {
  return (raffle?.prizes || []).some((prize) => /^Sin premio$/i.test(String(prize || '').trim()));
}

function pointsIncreased(before, after) {
  return Number.isFinite(before?.total)
    && Number.isFinite(after?.total)
    && Number(after.total) > Number(before.total);
}

function extractPrize(text) {
  const match = text.match(/(?:Congratulations|Felicidades)!\s*(.*?)\s*(?:has|have|is|are|been|added|se\s+ha|se\s+han)/i);
  return match?.[1]?.trim() || text || 'Premio desconocido';
}
