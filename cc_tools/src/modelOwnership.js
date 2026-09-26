const OWNER_LINK_SELECTOR = [
  '.model-info .model-user-content a[href*="/user/"]',
  '.model-info a.users-name[href*="/user/"]',
  'a.user-avatar[href*="/user/"]'
].join(', ');

export async function readModelOwnership(page) {
  const links = page.locator(OWNER_LINK_SELECTOR);
  await links.first().waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
  const candidates = await links.evaluateAll((elements) => elements.map((element) => ({
    name: element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '',
    href: element.getAttribute('href') || '',
    className: typeof element.className === 'string' ? element.className : ''
  }))).catch(() => []);
  const structuredAuthor = await page.locator('script[type="application/ld+json"]')
    .allTextContents()
    .then(findStructuredAuthorName)
    .catch(() => '');
  return selectModelOwnership(candidates, structuredAuthor, page.url());
}

export function selectModelOwnership(candidates = [], structuredAuthor = '', baseUrl = 'https://www.crealitycloud.com/') {
  const normalized = (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
    name: String(candidate?.name || '').replace(/\s+/g, ' ').trim(),
    href: String(candidate?.href || '').trim(),
    className: String(candidate?.className || '')
  }));
  const named = normalized
    .filter((candidate) => candidate.name && candidate.href)
    .sort((left, right) => ownershipCandidateScore(right) - ownershipCandidateScore(left))[0];
  const linked = named || normalized.find((candidate) => candidate.href);
  return normalizeModelOwnership(named?.name || structuredAuthor, linked?.href || '', baseUrl);
}

export function findStructuredAuthorName(values = []) {
  for (const value of Array.isArray(values) ? values : [values]) {
    try {
      const data = typeof value === 'string' ? JSON.parse(value) : value;
      const name = structuredAuthorName(data);
      if (name) return name;
    } catch {}
  }
  return '';
}

export function normalizeModelOwnership(author, href, baseUrl = 'https://www.crealitycloud.com/') {
  const name = String(author || '').replace(/\s+/g, ' ').trim();
  try {
    const url = new URL(String(href || ''), baseUrl);
    const allowedHost = url.hostname === 'crealitycloud.com' || url.hostname.endsWith('.crealitycloud.com');
    const ownerUserId = allowedHost && url.protocol === 'https:' ? crealityUserIdFromUrl(url) : '';
    return {
      author: name,
      authorUrl: ownerUserId ? url.toString() : '',
      ownerUserId
    };
  } catch {
    return { author: name, authorUrl: '', ownerUserId: '' };
  }
}

export function crealityUserIdFromUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(String(value || ''));
    const match = url.pathname.match(/^\/(?:[a-z]{2}\/)?user\/([^/]+)\/?$/i);
    return match ? decodeURIComponent(match[1]).trim() : '';
  } catch {
    return '';
  }
}

export function isOwnModel(model = {}, ownUserId = '') {
  const expected = String(ownUserId || '').trim();
  if (!expected) return false;
  const owner = String(model.ownerUserId || crealityUserIdFromUrl(model.authorUrl) || '').trim();
  return Boolean(owner) && owner === expected;
}

function ownershipCandidateScore(candidate) {
  if (/\busers-name\b/.test(candidate.className)) return 3;
  if (/\buser-avatar\b/.test(candidate.className)) return 2;
  return 1;
}

function structuredAuthorName(value) {
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = structuredAuthorName(item);
      if (name) return name;
    }
    return '';
  }
  const author = value.review?.author || value.author;
  const name = String(author?.name || '').replace(/\s+/g, ' ').trim();
  if (name) return name;
  for (const nested of Object.values(value)) {
    const nestedName = structuredAuthorName(nested);
    if (nestedName) return nestedName;
  }
  return '';
}
