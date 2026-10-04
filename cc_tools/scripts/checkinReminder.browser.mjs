import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { submitDailyCheckin } from '../src/checkinReminder.js';

let browser;
before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'chrome' } : {})
  });
});
after(async () => { await browser?.close(); });

function fixture(options = {}) {
  const o = { language: 'es', ...options };
  const en = o.language === 'en';
  return `<!doctype html><html><body>
    <div class="sign-in-action"><button class="sign-in-btn">${o.alreadyDone ? (en ? 'Checked In' : 'Registrado') : (en ? 'Check In Today' : 'Registrar')}</button></div>
    <div class="reward-content-box" hidden><span class="reward-content-label">4 veces</span></div>
    <div class="el-dialog" role="dialog" ${o.initial ? '' : 'hidden'}>
      <h2>${o.unrelated ? 'Confirmar reposición' : en ? 'Makeup Reminder' : 'Recordatorio de reposición'}</h2>
      <p>Repone para continuar recibiendo recompensas consecutivas</p>
      <label class="el-checkbox"><input type="checkbox" ${o.checked ? 'checked' : ''} ${o.disabled ? 'disabled' : ''}>${en ? "Don't remind me again in this cycle" : 'No recordar de nuevo en este ciclo'}</label>
      <button class="base-confirm-btn">${en ? 'Done' : 'Hecho'}</button>
    </div>
    <script>
      const opts = ${JSON.stringify(o)};
      window.events = []; window.submissions = 0;
      const button = document.querySelector('.sign-in-btn');
      const dialog = document.querySelector('[role=dialog]');
      const checkbox = document.querySelector('input');
      let dismissed = false;
      document.querySelector('input').onchange = e => events.push('checked:' + e.target.checked);
      document.querySelector('.base-confirm-btn').onclick = () => {
        events.push('done:' + checkbox.checked);
        if (!opts.stuck) { dialog.hidden = true; dismissed = true; }
        if (opts.completeOnDismiss) {button.textContent = '${en ? 'Checked In' : 'Registrado'}'; button.disabled = true;}
      };
      button.onclick = () => {
        submissions++; events.push('submit');
        if (!opts.noReminder && (!dismissed || opts.repeated)) { dialog.hidden = false; return; }
        if (opts.unconfirmed) return;
        button.textContent = '${en ? 'Checked In' : 'Registrado'}'; button.disabled = true;
        document.querySelector('.reward-content-box').hidden = false;
      };
    </script></body></html>`;
}

async function run(options, verify) {
  const page = await browser.newPage();
  try {
    const html = fixture(options);
    if (options.iframe) {
      await page.setContent('<iframe class="iframe-box"></iframe>');
      await page.locator('iframe').evaluate((frame, value) => { frame.srcdoc = value; }, html);
      await page.frameLocator('iframe').locator('.sign-in-btn').waitFor();
    } else {
      await page.setContent(html);
    }
    const scope = options.iframe ? page.frameLocator('iframe.iframe-box') : page;
    if (options.outerDialog) {
      // The check-in is framed, but its reminder is rendered by the top page.
      await page.evaluate(() => {
        const frame = document.querySelector('iframe').contentWindow;
        const dialog = frame.document.querySelector('[role=dialog]');
        document.body.append(dialog);
      });
    }
    if (options.hiddenInput) await scope.locator('input').evaluate(el => { el.style.display = 'none'; });
    if (options.missingCheckbox) await scope.locator('input').evaluate(el => el.remove());
    // Keep real DOM interactions and locator waits, only shorten deliberate pauses.
    page.waitForTimeout = () => new Promise(resolve => setTimeout(resolve, 20));
    const result = await submitDailyCheckin(page, scope);
    const data = await scope.locator('body').evaluate(() => ({ events: window.events, submissions: window.submissions }));
    await verify(result, data, page);
  } finally { await page.close(); }
}

for (const language of ['es', 'en']) {
  test(`cierra el recordatorio y reintenta el check-in en ${language}`, async () => run({ language }, (result, data) => {
    assert.equal(result.success, true);
    assert.equal(result.status, 'completed_now');
    assert.equal(result.reminderHandled, true);
    assert.equal(result.reward, '4 boletos de lotería');
    assert.deepEqual(data.events, ['submit', 'checked:true', 'done:true', 'submit']);
  }));
}
test('no desmarca una casilla que ya estaba marcada', async () => run({ checked: true }, (result, data) => {
  assert.equal(result.success, true);
  assert.deepEqual(data.events, ['submit', 'done:true', 'submit']);
}));
test('resuelve un aviso ya abierto antes de la primera pulsación', async () => run({ initial: true }, (result, data) => {
  assert.equal(result.success, true);
  assert.deepEqual(data.events, ['checked:true', 'done:true', 'submit']);
}));
test('el recordatorio también funciona dentro del iframe', async () => run({ iframe: true }, result => {
  assert.equal(result.success, true);
  assert.equal(result.reminderHandled, true);
}));
test('encuentra el aviso en la página principal con check-in en iframe', async () => run({ iframe: true, outerDialog: true }, result => {
  assert.equal(result.success, true);
  assert.equal(result.reminderHandled, true);
}));
test('pulsa la etiqueta de Element Plus si el input está oculto', async () => run({ hiddenInput: true }, (result, data) => {
  assert.equal(result.success, true);
  assert.deepEqual(data.events, ['submit', 'checked:true', 'done:true', 'submit']);
}));
test('no repite un check-in que ya está registrado', async () => run({ alreadyDone: true }, (result, data) => {
  assert.equal(result.status, 'already_done');
  assert.equal(data.submissions, 0);
}));
test('no vuelve a pulsar Registrar si al cerrar ya figura registrado', async () => run({ completeOnDismiss: true }, (result, data) => {
  assert.equal(result.success, true);
  assert.equal(data.submissions, 1);
}));
test('el flujo normal sigue funcionando sin recordatorio', async () => run({ noReminder: true }, (result, data) => {
  assert.equal(result.success, true);
  assert.equal(result.reminderHandled, false);
  assert.deepEqual(data.events, ['submit']);
}));
test('cerrar el aviso no basta para registrar éxito', async () => run({ unconfirmed: true }, (result, data) => {
  assert.equal(result.success, false);
  assert.equal(result.status, 'confirmation_failed');
  assert.equal(data.submissions, 2);
}));
test('no entra en bucle si el recordatorio reaparece', async () => run({ repeated: true }, (result, data) => {
  assert.equal(result.success, false);
  assert.equal(result.status, 'reminder_blocked');
  assert.equal(data.submissions, 2);
  assert.equal(data.events.filter(e => e.startsWith('done:')).length, 1);
}));
test('no reintenta cuando el diálogo no se cierra', async () => run({ stuck: true }, (result, data) => {
  assert.equal(result.status, 'reminder_blocked');
  assert.equal(data.submissions, 1);
}));
test('no confirma si falta la casilla requerida', async () => run({ missingCheckbox: true }, (result, data) => {
  assert.equal(result.status, 'reminder_blocked');
  assert.deepEqual(data.events, ['submit']);
}));
test('no confirma si no puede marcar la casilla', async () => run({ disabled: true }, (result, data) => {
  assert.equal(result.status, 'reminder_blocked');
  assert.deepEqual(data.events, ['submit']);
}));
test('no acepta otros diálogos ni gasta tarjetas de reposición', async () => run({ unrelated: true }, (result, data) => {
  assert.equal(result.success, false);
  assert.equal(result.status, 'confirmation_failed');
  assert.deepEqual(data.events, ['submit']);
}));
