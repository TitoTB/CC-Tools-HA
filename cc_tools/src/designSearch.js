export function filterDesigns(designs, query, filters = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const from = validDateFilter(filters.from);
  const to = validDateFilter(filters.to);
  return designs.filter((design) => {
    if (normalizedQuery && !normalizeSearchText(
      `${design?.title || ''} ${design?.url || ''}`
    ).includes(normalizedQuery)) return false;
    const date = designDateKey(design, filters.timezone);
    if (from && (!date || date < from)) return false;
    if (to && (!date || date > to)) return false;
    if (!matchesCompletion(design?.likeCompleted, filters.like)) return false;
    if (!matchesCompletion(design?.collectionCompleted, filters.collection)) return false;
    if (!matchesCompletion(design?.commentCompleted, filters.comment)) return false;
    if (filters.favoriteAuthor && filters.favoriteAuthor !== 'all') {
      const authorId = String(design?.ownerUserId || design?.favoriteProfileId || '');
      if (authorId !== String(filters.favoriteAuthor)) return false;
    }
    return true;
  });
}

export function sortDesignsByActivity(designs = []) {
  return sortDesigns(designs, 'date', 'desc');
}

export function normalizeDesignSort(key, direction) {
  return {
    key: ['date', 'title', 'author', 'category', 'like', 'collection', 'comment', 'boost'].includes(key) ? key : 'date',
    direction: direction === 'asc' ? 'asc' : 'desc'
  };
}

export function sortDesigns(designs = [], key = 'date', direction = 'desc') {
  const normalized = normalizeDesignSort(key, direction);
  const multiplier = normalized.direction === 'asc' ? 1 : -1;
  return [...designs].sort((left, right) => {
    const comparison = compareSortValues(sortValue(left, normalized.key), sortValue(right, normalized.key));
    if (comparison) return comparison * multiplier;
    const activityComparison = activityTime(right) - activityTime(left);
    if (activityComparison) return activityComparison;
    return normalizeSearchText(left?.title).localeCompare(normalizeSearchText(right?.title), 'es');
  });
}

function activityTime(design) {
  return Date.parse(design?.updatedAt || design?.downloadedAt || '') || 0;
}

function sortValue(design, key) {
  if (key === 'date') return activityTime(design);
  if (key === 'title') return normalizeSearchText(design?.title);
  if (key === 'author') return normalizeSearchText(design?.author || design?.favoriteProfileName);
  if (key === 'category') return normalizeSearchText(design?.category);
  if (key === 'like') return design?.likeCompleted === true ? 1 : 0;
  if (key === 'collection') return design?.collectionCompleted === true ? 1 : 0;
  if (key === 'comment') return design?.commentCompleted === true ? 1 : 0;
  if (key === 'boost') return Math.max(0, Number(design?.boostCount) || 0);
  return '';
}

function compareSortValues(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left || '').localeCompare(String(right || ''), 'es', { sensitivity: 'base', numeric: true });
}

function matchesCompletion(completed, filter) {
  if (filter === 'yes') return completed === true;
  if (filter === 'no') return completed !== true;
  return true;
}

function validDateFilter(value) {
  const date = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function designDateKey(design, timezone = 'Europe/Madrid') {
  const value = design?.updatedAt || design?.downloadedAt;
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const part = (type) => parts.find((entry) => entry.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
