import { withAutomationBrowser } from './browserManager.js';

const PROFILE_PAGE_URL = 'https://www.crealitycloud.com/es/workbench-beta/?type=1';
const PROFILE_API_PATH = '/api/cxy/v3/user/getInfo';

export async function readCrealityProfile() {
  return withAutomationBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    const profileResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST' && response.url().includes(PROFILE_API_PATH)
    ), { timeout: 45000 }).catch(() => null);

    await page.goto(PROFILE_PAGE_URL, { waitUntil: 'domcontentloaded' });
    const response = await profileResponse;
    if (!response) {
      throw profileError('CREALITY_PROFILE_UNAVAILABLE', 'Creality Cloud no devolvió los datos del usuario.');
    }
    if (!response.ok()) {
      throw profileError('CREALITY_PROFILE_HTTP_ERROR', `Creality Cloud respondió con HTTP ${response.status()} al consultar el perfil.`);
    }

    const payload = await response.json().catch(() => null);
    const profile = parseCrealityProfile(payload);
    if (!profile.userId && !profile.name && !profile.avatarUrl) {
      throw profileError('CREALITY_PROFILE_INVALID', 'Creality Cloud devolvió un perfil vacío.');
    }
    return profile;
  });
}

export function parseCrealityProfile(payload = {}) {
  const base = payload?.result?.profileUserInfo?.base || {};
  return {
    userId: String(base.userId || '').trim(),
    name: String(base.nickName || '').trim(),
    avatarUrl: normalizeAvatarUrl(base.avatar),
    updatedAt: new Date().toISOString()
  };
}

function normalizeAvatarUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const allowedHost = url.hostname === 'creality.com'
      || url.hostname.endsWith('.creality.com')
      || url.hostname === 'crealitycloud.com'
      || url.hostname.endsWith('.crealitycloud.com');
    return url.protocol === 'https:' && allowedHost ? url.toString() : '';
  } catch {
    return '';
  }
}

function profileError(code, message) {
  return Object.assign(new Error(message), { code });
}
