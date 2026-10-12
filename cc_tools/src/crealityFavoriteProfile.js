import { withIsolatedBrowser } from './browserManager.js';
import { normalizeFavoriteAvatarUrl, parseFavoriteProfileUrl } from './favoriteProfiles.js';

export async function readFavoriteProfile(value, options = {}) {
  const parsed = parseFavoriteProfileUrl(value);
  if (!parsed) throw favoriteError('FAVORITE_PROFILE_URL_INVALID', 'La URL no corresponde a un perfil de Creality Cloud.');

  return withIsolatedBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${parsed.profileUrl}/model`, { waitUntil: 'domcontentloaded' });
    const profile = await readFavoriteProfileFromPage(page, parsed.profileUrl);
    if (options.requirePublishedDesign === true) {
      const designState = await publishedDesignState(page);
      if (designState === 'empty') {
        throw favoriteError('FAVORITE_PROFILE_EMPTY', 'Este perfil no tiene diseños publicados y no puede añadirse como favorito.');
      }
      if (designState !== 'available') {
        throw favoriteError('FAVORITE_PROFILE_UNAVAILABLE', 'No se pudo comprobar si el perfil tiene diseños publicados.');
      }
    }
    return profile;
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

export async function publishedDesignState(page, { timeout = 45000 } = {}) {
  const container = page.locator('.user-model-container').first();
  await container.locator('a[href*="model-detail"], .empty_comp').first()
    .waitFor({ state: 'visible', timeout }).catch(() => {});
  if (await container.locator('a[href*="model-detail"]').count()) return 'available';
  if (await container.locator('.loading-layout .empty_comp').first().isVisible().catch(() => false)) return 'empty';
  return 'unknown';
}

export function extractBackgroundUrl(style = '') {
  const match = String(style).match(/background-image\s*:\s*url\(\s*["']?([^"')]+?)["']?\s*\)/i);
  return match ? match[1].trim() : '';
}

function favoriteError(code, message) {
  return Object.assign(new Error(message), { code });
}
