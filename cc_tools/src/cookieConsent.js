const installed = new WeakSet();

// Use Creality's own consent control. Never edit cookies or consent storage here.
export async function installCookieConsentHandling(context) {
  if (installed.has(context)) return;
  installed.add(context);
  try {
    await context.addInitScript(rejectOptionalCookies);
    await Promise.all(context.pages().map(page => page.evaluate(rejectOptionalCookies).catch(() => {})));
  } catch (error) {
    installed.delete(context);
    throw error;
  }
}

function rejectOptionalCookies() {
  if (window !== window.top || location.protocol !== 'https:'
    || !['crealitycloud.com', 'www.crealitycloud.com'].includes(location.hostname)) return;
  const key = Symbol.for('ccTools.optionalCookieConsent');
  if (window[key]) return;
  window[key] = true;
  let timer;
  const attempts = new WeakMap();
  const dismiss = () => {
    timer = null;
    // CookieConsent's initial banner only; leave its preferences editor alone.
    const modal = document.querySelector('#cc-main .cm');
    const button = modal?.querySelector('button[data-role="necessary"]');
    if (!button || button.disabled || modal.getAttribute('aria-hidden') === 'true'
      || !button.getClientRects().length || getComputedStyle(button).visibility !== 'visible') return;
    const count = attempts.get(button) || 0;
    if (count >= 3) return;
    attempts.set(button, count + 1);
    button.click();
  };
  const schedule = () => {
    if (timer == null) timer = setTimeout(dismiss, 50);
  };
  new MutationObserver(schedule).observe(document, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'disabled']
  });
  schedule();
}
