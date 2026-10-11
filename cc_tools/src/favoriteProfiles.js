export const DEFAULT_FAVORITE_PROFILE = Object.freeze({
  userId: '7963944884',
  name: 'Aguacatec',
  avatarUrl: 'https://pic2-cdn.creality.com/avatar/42fbfca7-66d2-4415-bdeb-7a592a39b98e?x-oss-process=image/resize,h_200,w_200,m_fill/format,webp/ignore-error,1',
  profileUrl: 'https://www.crealitycloud.com/es/user/7963944884',
  isDefault: true
});

export function parseFavoriteProfileUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return null;
  }

  const allowedHost = url.hostname === 'crealitycloud.com' || url.hostname === 'www.crealitycloud.com';
  if (url.protocol !== 'https:' || !allowedHost) return null;

  const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?user\/(\d+)(?:\/|$)/);
  if (!match) return null;

  const userId = match[1];
  return {
    userId,
    profileUrl: `https://www.crealitycloud.com/es/user/${userId}`
  };
}

export function normalizeFavoriteProfiles(profiles = []) {
  const defaultInput = Array.isArray(profiles)
    ? profiles.find((profile) => String(profile?.userId || '') === DEFAULT_FAVORITE_PROFILE.userId)
    : null;
  const normalizedDefault = {
    ...DEFAULT_FAVORITE_PROFILE,
    avatarUrl: normalizeFavoriteAvatarUrl(defaultInput?.avatarUrl) || DEFAULT_FAVORITE_PROFILE.avatarUrl
  };
  if (defaultInput && ['pending', 'syncing', 'ready', 'empty', 'error'].includes(defaultInput.indexStatus)) {
    const indexedModelCount = Math.max(0, Math.floor(Number(defaultInput.indexedModelCount) || 0));
    normalizedDefault.indexStatus = defaultInput.indexStatus === 'ready' && indexedModelCount === 0
      ? 'pending'
      : defaultInput.indexStatus;
    normalizedDefault.indexedAt = validIsoDate(defaultInput.indexedAt);
    normalizedDefault.fullIndexedAt = validIsoDate(defaultInput.fullIndexedAt);
    normalizedDefault.lastModelIndexedAt = validIsoDate(defaultInput.lastModelIndexedAt);
    normalizedDefault.indexedModelCount = indexedModelCount;
  }
  const normalized = [normalizedDefault];
  const seen = new Set([DEFAULT_FAVORITE_PROFILE.userId]);

  for (const profile of Array.isArray(profiles) ? profiles : []) {
    const parsed = parseFavoriteProfileUrl(profile?.profileUrl || `https://www.crealitycloud.com/es/user/${profile?.userId || ''}`);
    if (!parsed || seen.has(parsed.userId)) continue;
    seen.add(parsed.userId);
    const indexedModelCount = Math.max(0, Math.floor(Number(profile?.indexedModelCount) || 0));
    const indexStatus = normalizeIndexStatus(profile?.indexStatus);
    normalized.push({
      userId: parsed.userId,
      name: String(profile?.name || '').trim(),
      avatarUrl: normalizeFavoriteAvatarUrl(profile?.avatarUrl),
      profileUrl: parsed.profileUrl,
      isDefault: false,
      indexStatus: indexStatus === 'ready' && indexedModelCount === 0 ? 'pending' : indexStatus,
      indexedAt: validIsoDate(profile?.indexedAt),
      fullIndexedAt: validIsoDate(profile?.fullIndexedAt),
      lastModelIndexedAt: validIsoDate(profile?.lastModelIndexedAt),
      indexedModelCount
    });
  }

  return normalized;
}

function normalizeIndexStatus(value) {
  return ['pending', 'syncing', 'ready', 'empty', 'error'].includes(value) ? value : 'pending';
}

function validIsoDate(value) {
  const text = String(value || '');
  return Number.isNaN(Date.parse(text)) ? '' : text;
}

export function normalizeFavoriteAvatarUrl(value) {
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
