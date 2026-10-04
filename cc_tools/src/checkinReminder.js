const CHECKIN_BUTTON_SELECTOR = '.sign-in-action .sign-in-btn';
const AVAILABLE_RE = /^(registrar|check\s*in\s*today)$/i;
const DONE_RE = /^(registrado|checked\s*in)$/i;
const REMINDER_TITLE_RE = /recordatorio de reposici[oó]n|(?:make[ -]?up|replenishment) reminder/i;
const REMINDER_OPTION_RE = /no recordar de nuevo en este ciclo|(?:do not|don['’]t) remind(?: me)? again (?:in|during|for) this cycle/i;
const CONFIRM_RE = /^\s*(?:Hecho|Done)\s*$/i;

const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();

// Creality renders this Element Plus dialog both directly and inside iframe.iframe-box.
// Require its title and cycle option: other check-in dialogs can spend makeup cards.
export async function findCheckinReminder(page, container) {
  for (const scope of [...new Set([container, page])]) {
    const dialogs = scope.locator('.el-dialog, [role="dialog"]')
      .filter({ hasText: REMINDER_TITLE_RE })
      .filter({ hasText: REMINDER_OPTION_RE });
    for (let index = 0; index < await dialogs.count(); index += 1) {
      const dialog = dialogs.nth(index);
      if (await dialog.isVisible()) return dialog;
    }
  }
  return null;
}

async function dismissCheckinReminder(dialog) {
  const checkbox = dialog.getByLabel(REMINDER_OPTION_RE).first();
  if (!(await checkbox.count())) throw new Error('No se encontró la casilla del recordatorio de reposición.');
  if (!(await checkbox.isChecked())) {
    try {
      await checkbox.check({ timeout: 2000 });
    } catch (error) {
      // Element Plus can hide its native input behind the visible label.
      if (!(await checkbox.isChecked())) {
        const label = dialog.locator('label').filter({ hasText: REMINDER_OPTION_RE }).first();
        if (!(await label.isVisible())) throw error;
        await label.click({ timeout: 2000 });
      }
    }
  }
  if (!(await checkbox.isChecked())) throw new Error('No se pudo marcar «No recordar de nuevo en este ciclo».');
  const done = dialog.locator('button, [role="button"], .base-confirm-btn').filter({ hasText: CONFIRM_RE }).first();
  await done.click({ timeout: 3000 });
  await dialog.waitFor({ state: 'hidden', timeout: 5000 });
}

export async function submitDailyCheckin(page, container = page) {
  const button = container.locator(CHECKIN_BUTTON_SELECTOR).first();
  let reminderHandled = false;
  let clicks = 0;
  const failure = reason => ({
    success: false, status: 'reminder_blocked', reminderHandled,
    reason, message: `No se pudo resolver el recordatorio de reposición: ${reason}`
  });
  const recover = async dialog => {
    if (reminderHandled) return failure('El recordatorio volvió a aparecer después de cerrarlo.');
    try {
      await dismissCheckinReminder(dialog);
      reminderHandled = true;
      return null;
    } catch (error) {
      return failure(error.message);
    }
  };
  const initialReminder = await findCheckinReminder(page, container);
  if (initialReminder) {
    const blocked = await recover(initialReminder);
    if (blocked) return blocked;
  }

  // One initial submission and, only after the reminder was dismissed, one retry.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = normalize(await button.textContent({ timeout: 3000 }).catch(() => ''));
    const visible = await button.isVisible();
    if (visible && DONE_RE.test(text)) return {
      success: true, status: clicks ? 'completed_now' : 'already_done', reminderHandled,
      message: clicks ? 'Check-in completado correctamente.' : 'Check-in ya realizado hoy.'
    };
    if (!visible || !AVAILABLE_RE.test(text)) return {
      success: false, status: 'unknown_state', rawText: text, reminderHandled,
      reason: 'Estado del check-in no reconocido', message: 'No se ha podido identificar el estado del check-in.'
    };

    let clickError = null;
    try {
      await button.scrollIntoViewIfNeeded();
      await button.click({ timeout: 6000 });
      clicks += 1;
      await page.waitForTimeout(5000);
    } catch (error) {
      clickError = error;
    }
    const reminder = await findCheckinReminder(page, container);
    if (reminder) {
      const blocked = await recover(reminder);
      if (blocked) return blocked;
      // Closing the reminder does not submit the check-in. Re-read before retrying.
      if (attempt === 0) continue;
    } else if (clickError) {
      throw clickError;
    }

    const reward = container.locator('.reward-content-box .reward-content-label:visible').first();
    const rewardText = await reward.isVisible()
      ? normalize(await reward.textContent({ timeout: 3000 }).catch(() => '')) : '';
    const finalText = normalize(await button.textContent({ timeout: 3000 }).catch(() => ''));
    if (rewardText || (await button.isVisible() && DONE_RE.test(finalText))) return {
      success: true, status: 'completed_now', reward: normalizeReward(rewardText), reminderHandled,
      message: 'Check-in completado correctamente.'
    };
    return {
      success: false, status: 'confirmation_failed', reminderHandled,
      reason: 'No se pudo confirmar el resultado después de pulsar',
      message: 'No se pudo confirmar que el check-in se haya completado.'
    };
  }
}

function normalizeReward(value) {
  const match = value.match(/^(\d+)\s*(?:vez|veces|time|times)$/i);
  if (!match) return value;
  const amount = Number(match[1]);
  return `${amount} ${amount === 1 ? 'boleto de lotería' : 'boletos de lotería'}`;
}
