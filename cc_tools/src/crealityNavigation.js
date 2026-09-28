const DEFAULT_TIMEOUT_MS = 45_000;

export async function navigateToCrealityPage(page, url, options = {}) {
  const timeout = Math.max(1_000, Number(options.timeout) || DEFAULT_TIMEOUT_MS);
  const attempts = Math.max(1, Number(options.attempts) || 2);
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await page.goto(url, {
        waitUntil: attempt === 0 ? 'domcontentloaded' : 'commit',
        timeout
      });
      if (sameNavigationTarget(page.url(), url)) return;
      lastError = navigationTargetError(page.url(), url);
    } catch (error) {
      lastError = error;
      if (!isNavigationTimeout(error)) throw error;
      if (sameNavigationTarget(page.url(), url) && await documentAvailable(page)) return;
    }

    if (attempt + 1 < attempts) {
      await page.waitForTimeout(1_500).catch(() => {});
    }
  }

  throw lastError || navigationTargetError(page.url(), url);
}

export function sameNavigationTarget(currentUrl, requestedUrl) {
  try {
    const current = new URL(currentUrl);
    const requested = new URL(requestedUrl);
    return current.origin === requested.origin
      && trimTrailingSlash(current.pathname) === trimTrailingSlash(requested.pathname)
      && Array.from(requested.searchParams.entries())
        .every(([name, value]) => current.searchParams.get(name) === value);
  } catch {
    return String(currentUrl || '') === String(requestedUrl || '');
  }
}

export function isNavigationTimeout(error) {
  return /(?:Timeout \d+ms exceeded|Navigation timeout)/i.test(error?.message || String(error));
}

async function documentAvailable(page) {
  return page.locator('body').first().isVisible({ timeout: 3_000 }).catch(() => false);
}

function navigationTargetError(currentUrl, requestedUrl) {
  const error = new Error(`El navegador permaneció en ${currentUrl || 'una página desconocida'} al intentar abrir ${requestedUrl}.`);
  error.code = 'NAVIGATION_TARGET_MISMATCH';
  error.category = 'page';
  error.systemic = false;
  return error;
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '') || '/';
}
