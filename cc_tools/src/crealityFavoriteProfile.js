import { withIsolatedBrowser } from './browserManager.js';
import { normalizeFavoriteAvatarUrl, parseFavoriteProfileUrl } from './favoriteProfiles.js';

export async function readFavoriteProfile(value, { requireModels = false } = {}) {
  const parsed = parseFavoriteProfileUrl(value);
  if (!parsed) throw favoriteError('FAVORITE_PROFILE_URL_INVALID', 'La URL no corresponde a un perfil de Creality Cloud.');

  return withIsolatedBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${parsed.profileUrl}/model`, { waitUntil: 'domcontentloaded' });

    const profile = await readFavoriteProfileFromPage(page, parsed.profileUrl);
    if (requireModels) await requirePublishedFavoriteModels(page, profile);
    return profile;
  });
}

export async function requirePublishedFavoriteModels(page, profile, { timeout = 45000, settleMs = 2500 } = {}) {
  const container = '.user-model-container';
  await page.locator(`${container} a[href*="model-detail"], ${container} .empty_comp`).first()
    .waitFor({ state: 'visible', timeout }).catch(() => {});
  await page.waitForTimeout(settleMs);
  const visibleId = await page.locator('.user-id').first().textContent().catch(() => '');
  const matches = String(visibleId).match(/ID\s*:\s*(\d+)/i)?.[1] === String(profile.userId);
  const links = await page.locator(`${container} a[href*="model-detail"]`).evaluateAll(anchors =>
    anchors.filter(anchor => anchor.getClientRects().length > 0).map(anchor => anchor.href));
  const hasModels = links.some(href => {
    try {
      const url = new URL(href);
      return url.protocol === 'https:' && ['crealitycloud.com', 'www.crealitycloud.com'].includes(url.hostname)
        && /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?model-detail\/[^/]+/.test(url.pathname);
    } catch { return false; }
  });
  if (matches && hasModels) return;
  const empty = await page.locator(`${container} .loading-layout .empty_comp`).isVisible().catch(() => false);
  const count = await page.locator(`${container} a[href*="model-detail"]`).count();
  if (matches && empty && count === 0) {
    throw favoriteError('FAVORITE_PROFILE_NO_MODELS',
      'Este perfil todavía no tiene diseños publicados para seguir. No se ha añadido a favoritos. Inténtalo de nuevo más adelante.');
  }
  throw favoriteError('FAVORITE_PROFILE_MODELS_UNCONFIRMED',
    'No se ha podido comprobar si este perfil tiene diseños. No se ha añadido a favoritos. Inténtalo de nuevo cuando cargue correctamente.');
}

export async function readFavoriteProfileFromPage(page, value, { timeout = 45000 } = {}) {
  const parsed = parseFavoriteProfileUrl(value);
  if (!parsed) throw favoriteError('FAVORITE_PROFILE_URL_INVALID', 'La URL no corresponde a un perfil de Creality Cloud.');

  const nameNode = page.locator('.user-name .text-ellipsis').first();
  const avatarNode = page.locator('.creality-user-avatar').first();
  await nameNode.waitFor({ state: 'visible', timeout }).catch(() => {});

  const name = String(await nameNode.getAttribute('title').catch(() => '')
    || await nameNode.textContent().catch(() => '')
    || '').trim();
  const avatarStyle = String(await avatarNode.getAttribute('style').catch(() => '') || '');
  const avatarUrl = normalizeFavoriteAvatarUrl(extractBackgroundUrl(avatarStyle));
  const visibleId = String(await page.locator('.user-id').first().textContent().catch(() => '') || '');
  const visibleIdMatch = visibleId.match(/ID\s*:\s*(\d+)/i);

  if (!name || (visibleIdMatch && visibleIdMatch[1] !== parsed.userId)) {
    throw favoriteError('FAVORITE_PROFILE_NOT_FOUND', 'No se pudo encontrar ese perfil en Creality Cloud.');
  }

  return {
    userId: parsed.userId,
    name,
    avatarUrl,
    profileUrl: parsed.profileUrl,
    isDefault: false
  };
}

export function extractBackgroundUrl(style = '') {
  const match = String(style).match(/background-image\s*:\s*url\(\s*["']?([^"')]+?)["']?\s*\)/i);
  return match ? match[1].trim() : '';
}

function favoriteError(code, message) {
  return Object.assign(new Error(message), { code });
}
