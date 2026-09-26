const DETAIL_PATTERN = /\/(?:es\/)?model-detail\/([^/?#]+)/i;

export function canonicalModelUrl(value) {
  try {
    const url = new URL(value, 'https://www.crealitycloud.com');
    if (!DETAIL_PATTERN.test(url.pathname)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function modelSlugFromUrl(value) {
  try {
    const url = new URL(value, 'https://www.crealitycloud.com');
    const match = url.pathname.match(DETAIL_PATTERN);
    return normalizeIdentityPart(match?.[1] || '');
  } catch {
    return '';
  }
}

export function modelProfileIdFromUrl(value) {
  try {
    const url = new URL(value, 'https://www.crealitycloud.com');
    return normalizeIdentityPart(url.searchParams.get('profileId') || '');
  } catch {
    return '';
  }
}

export function modelKeyFromUrl(value) {
  const slug = modelSlugFromUrl(value);
  if (!slug) return '';

  const profileId = modelProfileIdFromUrl(value);
  return profileId ? `${slug}::${profileId}` : slug;
}

export function sameModelIdentity(left, right) {
  if (!left || !right) return false;
  if (left.modelKey && right.modelKey && left.modelKey === right.modelKey) return true;

  const leftHasProfile = String(left.modelKey || '').includes('::');
  const rightHasProfile = String(right.modelKey || '').includes('::');
  return Boolean(left.modelSlug && right.modelSlug && left.modelSlug === right.modelSlug && (!leftHasProfile || !rightHasProfile));
}

function normalizeIdentityPart(value) {
  return decodeURIComponent(String(value || '')).trim().toLowerCase();
}
