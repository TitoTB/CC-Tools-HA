import { canonicalModelUrl } from './modelIdentity.js';
import { findStructuredAuthorName, normalizeModelOwnership, selectModelOwnership } from './modelOwnership.js';
import { selectModelCategoryFromTitle } from './modelDownloadTask.js';
import { readConfig, readDesigns, updateDesignMetadata } from './storage.js';

const INITIAL_DELAY_MS = 15 * 1000;
const RETRY_DELAY_MS = 2 * 60 * 1000;
const IDLE_DELAY_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 20;

let timer = null;
let running = false;

export function startDesignMetadataRepair() {
  scheduleRepair(INITIAL_DELAY_MS);
}

export function stopDesignMetadataRepair() {
  if (timer) clearTimeout(timer);
  timer = null;
}

export async function repairMissingDesignMetadata(limit = BATCH_SIZE) {
  if (running) return { repaired: 0, pending: 0 };
  running = true;
  try {
    const designs = await readDesigns();
    const missing = designs.filter((design) => design.indexedOnly !== true
      && canonicalModelUrl(design.url)
      && (!String(design.author || '').trim() || !String(design.category || '').trim()));
    const config = await readConfig();
    const repairedIds = new Set();
    const targets = sortRepairTargets(missing)
      .slice(0, Math.max(1, Number(limit) || BATCH_SIZE));
    for (const design of targets) {
      const attemptedAt = new Date().toISOString();
      const metadata = await fetchPublicModelMetadata(design);
      const patch = {
        categoryRepairAttemptAt: attemptedAt
      };
      if (!String(design.author || '').trim() && metadata.author) {
        Object.assign(patch, metadata);
      }
      if (!String(design.category || '').trim() && metadata.category) {
        patch.category = metadata.category;
      }
      await updateDesignMetadata(design.id, patch, config.crealityProfile?.userId || '');
      if (patch.author || patch.category) repairedIds.add(design.id);
    }

    const remaining = (await readDesigns()).filter((design) => design.indexedOnly !== true
      && canonicalModelUrl(design.url)
      && (!String(design.author || '').trim() || !String(design.category || '').trim()));
    return { repaired: repairedIds.size, pending: remaining.length };
  } finally {
    running = false;
  }
}

export const repairMissingDesignAuthors = repairMissingDesignMetadata;

function sortRepairTargets(designs = []) {
  return [...designs].sort((left, right) => {
    const leftAttempt = Date.parse(left.categoryRepairAttemptAt || '') || 0;
    const rightAttempt = Date.parse(right.categoryRepairAttemptAt || '') || 0;
    if (!leftAttempt && !rightAttempt) {
      return (Date.parse(right.downloadedAt || right.updatedAt || '') || 0)
        - (Date.parse(left.downloadedAt || left.updatedAt || '') || 0);
    }
    if (!leftAttempt) return -1;
    if (!rightAttempt) return 1;
    return leftAttempt - rightAttempt;
  });
}

export async function fetchPublicModelOwnership(design = {}) {
  const metadata = await fetchPublicModelMetadata(design);
  return normalizeModelOwnership(metadata.author, metadata.authorUrl);
}

export async function fetchPublicModelMetadata(design = {}) {
  const url = canonicalModelUrl(design.url);
  if (!url) return { ...normalizeModelOwnership('', ''), category: '' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.7',
        'User-Agent': 'Mozilla/5.0 (compatible; CC-Tools metadata repair)'
      }
    });
    if (!response.ok) return { ...normalizeModelOwnership('', ''), category: '' };
    return extractPublicModelMetadata(await response.text(), url, design);
  } catch {
    return { ...normalizeModelOwnership('', ''), category: '' };
  } finally {
    clearTimeout(timeout);
  }
}

export function extractPublicModelOwnership(html, baseUrl, existing = {}) {
  const { category, ...ownership } = extractPublicModelMetadata(html, baseUrl, existing);
  return ownership;
}

export function extractPublicModelMetadata(html, baseUrl, existing = {}) {
  const scripts = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of String(html || '').matchAll(scriptPattern)) {
    if (/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1])) scripts.push(match[2]);
  }
  const structuredAuthor = findStructuredAuthorName(scripts);
  const profileUrl = String(existing.authorUrl || '').trim()
    || (existing.ownerUserId ? `/es/user/${encodeURIComponent(String(existing.ownerUserId))}` : '')
    || firstProfileLink(html);
  const ownership = selectModelOwnership(
    [],
    structuredAuthor || String(existing.author || '').trim(),
    new URL(profileUrl || baseUrl, baseUrl).toString()
  );
  return {
    ...ownership,
    category: selectModelCategoryFromTitle(readHtmlTitle(html))
  };
}

function readHtmlTitle(html) {
  const title = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  return decodeHtml(title.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function firstProfileLink(html) {
  const match = String(html || '').match(/href\s*=\s*["']([^"']*\/(?:[a-z]{2}\/)?user\/[^"'?#/]+)["']/i);
  return match?.[1] || '';
}

function scheduleRepair(delay) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    let pending = 0;
    try {
      ({ pending } = await repairMissingDesignMetadata());
    } catch (error) {
      console.warn('[design-metadata]', error?.message || error);
      pending = 1;
    }
    scheduleRepair(pending > 0 ? RETRY_DELAY_MS : IDLE_DELAY_MS);
  }, delay);
  timer.unref?.();
}
