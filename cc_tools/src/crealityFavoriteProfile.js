import { withIsolatedBrowser } from './browserManager.js';
import { normalizeFavoriteAvatarUrl, parseFavoriteProfileUrl } from './favoriteProfiles.js';

export async function readFavoriteProfile(value) {
  const parsed = parseFavoriteProfileUrl(value);
  if (!parsed) throw favoriteError('FAVORITE_PROFILE_URL_INVALID', 'La URL no corresponde a un perfil de Creality Cloud.');

  return withIsolatedBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${parsed.profileUrl}/model`, { waitUntil: 'domcontentloaded' });

    return readFavoriteProfileFromPage(page, parsed.profileUrl);
  });
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
