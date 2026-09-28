import fs from 'fs/promises';
import path from 'path';
import { withAutomationBrowser } from './browserManager.js';
import { captureDiagnosticScreenshot, diagnoseTaskError, failureFromDiagnostic, inspectCrealityPage, observeCrealityPage } from './crealityDiagnostics.js';
import { compareIncentiveProgress, readIncentiveProgress, waitForIncentiveProgress } from './incentiveTasks.js';
import { appendDesign, commentImagesDir, markDesignCommentUnavailable, markDesignCommented, readDesigns, readRuns, updateDesignOwnership } from './storage.js';
import { isOwnModel, readModelOwnership } from './modelOwnership.js';
import { collectCatalogCandidates } from './modelDownloadTask.js';
import { selectFavoriteCandidates } from './favoriteModelIndex.js';

const INCENTIVES = {
  image: { title: 'Image comments', points: 2, label: 'Comentario con imagen' },
  text: { title: 'Comment on models', points: 1, label: 'Comentario sin imagen' }
};

export async function runModelComment(taskConfig = {}, options = {}) {
  const entries = normalizeComments(taskConfig.comments).filter((entry) => entry.enabled);
  const allDesigns = await readDesigns();
  const designs = eligibleCommentDesigns(allDesigns, options.ownUserId);
  if (!entries.length) return skipped('No hay comentarios activos en la biblioteca.');

  const runs = await readRuns();
  const counts = countTodayComments(runs, taskConfig.timezone);
  const kind = selectCommentKind(taskConfig, entries, counts, options.commentKind);
  if (!kind) return skipped('Los comentarios configurados para hoy ya están completados.');

  const candidates = eligibleCommentsForKind(entries, kind);
  const entry = randomItem(candidates);
  let design = null;
  const incentive = INCENTIVES[kind];

  return withAutomationBrowser({}, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    const observer = observeCrealityPage(page, 'comments');
    const screenshots = [];
    const alreadyApplied = [];
    try {
      const before = await readIncentiveProgress(page, observer, incentive.title, {
        timezone: taskConfig.timezone,
        requireTaskList: true
      });
      if (!before.found) throw taskError('INCENTIVE_TASK_NOT_FOUND', `No se encontró la tarea diaria "${incentive.title}".`);
      if (before.completed) return skipped(`La recompensa diaria "${incentive.title}" ya estaba completada.`, { before, after: before });

      if (!designs.length) {
        const catalogCandidates = await collectCatalogCandidates(page, allDesigns, 20, observer);
        for (const catalogCandidate of catalogCandidates) {
          const stored = await appendDesign({
            ...catalogCandidate,
            source: 'catalog',
            indexedOnly: true,
            downloadedAt: ''
          });
          if (stored.record && !isOwnModel(stored.record, options.ownUserId)) designs.push(stored.record);
        }
      }

      const candidates = prioritizedCommentCandidates(
        designs,
        allDesigns,
        taskConfig.prioritizeFavorites !== false
      );
      while (candidates.length) {
        const candidate = candidates.shift();
        observer.responses.length = 0;
        observer.failedRequests.length = 0;
        const commentFeedResponse = waitForCommentFeed(page);
        await page.goto(candidate.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3500);
        const pageDiagnostic = await inspectCrealityPage(page, observer, { requireBody: true });
        if (pageDiagnostic?.code === 'MODEL_NOT_FOUND') {
          await markDesignCommentUnavailable(candidate.id);
          continue;
        }
        if (pageDiagnostic) throw diagnosticError(pageDiagnostic);
        const ownership = await readModelOwnership(page);
        const updated = await updateDesignOwnership(candidate.id, ownership, options.ownUserId);
        if (isOwnModel(ownership, options.ownUserId)) continue;
        const existingComment = await findExistingUserComment(page, commentFeedResponse, options.ownUserId);
        if (existingComment) {
          const updatedComment = await markDesignCommented(candidate.id, {
            kind: existingComment.kind,
            actionState: 'already_applied',
            completedAt: existingComment.createdAt
          });
          alreadyApplied.push(updatedComment || candidate);
          continue;
        }
        design = updated || candidate;
        break;
      }
      if (!design) {
        return skipped(
          alreadyApplied.length
            ? `${alreadyApplied.length} diseño(s) ya tenían un comentario del usuario conectado.`
            : 'No hay diseños disponibles para comentar.',
          null,
          { alreadyApplied }
        );
      }

      const action = await postComment(page, entry, kind);
      const commentedDesign = await markDesignCommented(design.id, { kind });
      const after = await waitForIncentiveProgress(
        page,
        observer,
        incentive.title,
        before,
        [0, 5000, 10000, 15000, 20000],
        { timezone: taskConfig.timezone }
      );
      const rewardVerification = compareIncentiveProgress(before, after);
      rewardVerification.actionEvidence = action;

      const acted = [{
        ...(commentedDesign || design),
        commentKind: kind,
        commentText: entry.text,
        rewardVerification
      }];
      if (rewardVerification.status !== 'credited') {
        const diagnostic = rewardDiagnostic(rewardVerification, design, incentive);
        const screenshot = await captureDiagnosticScreenshot(page, 'comments-reward', rewardVerification.status);
        if (screenshot) screenshots.push(screenshot);
        return {
          success: false,
          message: `${incentive.label}: recompensa no acreditada.`,
          details: {
            acted: [],
            commented: acted,
            alreadyApplied,
            failures: [failureFromDiagnostic(diagnostic, { title: design.title, url: design.url })],
            diagnostics: [diagnostic],
            rewardVerification,
            commentKind: kind,
            commentUsage: { id: entry.id, increment: 1 }
          },
          screenshots
        };
      }

      return {
        success: true,
        message: `${incentive.label} publicado. +${incentive.points} punto${incentive.points === 1 ? '' : 's'}.`,
        details: {
          acted,
          commented: acted,
          alreadyApplied,
          failures: [],
          diagnostics: [],
          rewardVerification,
          commentKind: kind,
          pointsAwarded: incentive.points,
          commentUsage: { id: entry.id, increment: 1 }
        },
        screenshots
      };
    } catch (error) {
      if (error.silentRetry) throw error;
      const diagnostic = await diagnoseTaskError(error, page, observer, {
        code: error.code || 'COMMENT_EXECUTION_FAILED',
        category: error.category || 'action',
        systemic: Boolean(error.systemic),
        message: error.userMessage || error.message,
        url: design?.url
      });
      const screenshot = await captureDiagnosticScreenshot(page, 'comments', diagnostic.code);
      if (screenshot) screenshots.push(screenshot);
      return {
        success: false,
        message: `${incentive.label}: no se pudo publicar.`,
        details: {
          acted: [],
          alreadyApplied,
          failures: [failureFromDiagnostic(diagnostic, { title: design?.title, url: design?.url })],
          diagnostics: [diagnostic],
          incident: diagnostic.systemic ? diagnostic : null,
          commentKind: kind
        },
        screenshots
      };
    } finally {
      observer.stop();
    }
  });
}

export function eligibleCommentDesigns(designs = [], ownUserId = '') {
  return designs.filter((design) => design?.url
    && design.commentCompleted !== true
    && design.commentUnavailable !== true
    && !(design.indexedOnly === true && design.source === 'favorite' && design.favoriteActive !== true)
    && !isOwnModel(design, ownUserId));
}

export function prioritizedCommentCandidates(designs = [], allDesigns = designs, prioritizeFavorites = true, random = Math.random) {
  if (!prioritizeFavorites) return shuffle(designs, random);
  const eligibleIds = new Set(designs.map((design) => design.id));
  const favorites = selectFavoriteCandidates(allDesigns, 'commentCompleted')
    .filter((design) => eligibleIds.has(design.id));
  const favoriteIds = new Set(favorites.map((design) => design.id));
  const catalog = shuffle(designs.filter((design) => !favoriteIds.has(design.id)), random);
  return [...favorites, ...catalog];
}

function shuffle(values = [], random = Math.random) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

export function eligibleCommentsForKind(entries = [], kind = 'text') {
  return kind === 'image'
    ? entries.filter((entry) => entry?.image?.filename)
    : entries;
}

export function findUserCommentInFeed(payload = {}, userId = '') {
  const expected = String(userId || '').trim();
  if (!expected) return null;
  const list = Array.isArray(payload?.result?.list) ? payload.result.list : [];
  for (const entry of list) {
    const comment = entry?.comment || entry;
    const authorId = String(comment?.userId || comment?.userInfo?.userId || '').trim();
    if (authorId !== expected) continue;
    const pictures = Array.isArray(comment?.pictures) ? comment.pictures.filter(Boolean) : [];
    return {
      id: String(comment?.id || entry?.id || '').trim(),
      userId: authorId,
      kind: pictures.length ? 'image' : 'text',
      createdAt: commentDate(comment?.createTime || comment?.lastModifyTime)
    };
  }
  return null;
}

export function normalizeComments(values = []) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => ({
    id: String(value?.id || '').trim(),
    text: String(value?.text || '').trim(),
    enabled: value?.enabled !== false,
    usageCount: Math.max(0, Math.floor(Number(value?.usageCount) || 0)),
    image: value?.image?.filename ? {
      id: String(value.image.id || '').trim(),
      filename: path.basename(String(value.image.filename)),
      name: String(value.image.name || '').slice(0, 180),
      mime: String(value.image.mime || '').slice(0, 80)
    } : null
  })).filter((entry) => entry.id && entry.text);
}

export function countTodayComments(runs = [], timezone = 'Europe/Madrid', now = new Date()) {
  const today = dayKey(timezone, now);
  return runs.reduce((counts, run) => {
    if (run.taskId !== 'comments' || run.details?.rewardVerification?.status !== 'credited') return counts;
    if (dayKey(timezone, new Date(run.finishedAt || run.createdAt)) !== today) return counts;
    const kind = run.details?.commentKind;
    if (kind === 'image' || kind === 'text') counts[kind] += 1;
    return counts;
  }, { image: 0, text: 0 });
}

export function selectCommentKind(taskConfig = {}, entries = [], counts = { image: 0, text: 0 }, preferredKind = '') {
  const imagePending = Math.max(0, Number(taskConfig.imageDailyLimit) || 0) > (counts.image || 0)
    && entries.some((entry) => entry.image?.filename);
  const textPending = Math.max(0, Number(taskConfig.textDailyLimit) || 0) > (counts.text || 0);
  if (preferredKind === 'image' && imagePending) return 'image';
  if (preferredKind === 'text' && textPending) return 'text';
  if (imagePending && textPending) return Math.random() < 0.5 ? 'image' : 'text';
  if (imagePending) return 'image';
  if (textPending) return 'text';
  return '';
}

export function buildCommentKindPlan(taskConfig = {}, counts = { image: 0, text: 0 }, random = Math.random) {
  const imageRemaining = Math.max(0, Math.min(5, Number(taskConfig.imageDailyLimit) || 0) - (counts.image || 0));
  const textRemaining = Math.max(0, Math.min(1, Number(taskConfig.textDailyLimit) || 0) - (counts.text || 0));
  const kinds = [
    ...Array(imageRemaining).fill('image'),
    ...Array(textRemaining).fill('text')
  ];
  for (let index = kinds.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [kinds[index], kinds[swapIndex]] = [kinds[swapIndex], kinds[index]];
  }
  return kinds;
}

function waitForCommentFeed(page) {
  return page.waitForResponse(
    (response) => /\/api\/cxy\/comment\/modelFeedList(?:\?|$)/.test(response.url())
      && response.request().method() === 'POST',
    { timeout: 15000 }
  ).catch(() => null);
}

async function findExistingUserComment(page, responsePromise, userId) {
  const expected = String(userId || '').trim();
  if (!expected) {
    throw taskError('COMMENT_USER_ID_UNAVAILABLE', 'No se pudo identificar al usuario conectado antes de comprobar sus comentarios.');
  }

  const response = await responsePromise;
  if (!response) {
    throw taskError('COMMENT_HISTORY_UNAVAILABLE', 'Creality Cloud no cargó el historial de comentarios del diseño.');
  }

  const firstPayload = await response.json().catch(() => null);
  if (!response.ok() || Number(firstPayload?.code) !== 0) {
    throw taskError('COMMENT_HISTORY_UNAVAILABLE', firstPayload?.msg || 'Creality Cloud no permitió consultar los comentarios del diseño.');
  }
  const firstMatch = findUserCommentInFeed(firstPayload, expected);
  if (firstMatch) return firstMatch;

  const count = Math.max(0, Number(firstPayload?.result?.count) || 0);
  const firstList = Array.isArray(firstPayload?.result?.list) ? firstPayload.result.list : [];
  if (count <= firstList.length) return null;

  let requestPayload = {};
  try {
    requestPayload = JSON.parse(response.request().postData() || '{}');
  } catch {
    throw taskError('COMMENT_HISTORY_UNAVAILABLE', 'Creality Cloud devolvió una consulta de comentarios no reconocida.');
  }
  const pageSize = 100;
  const totalPages = Math.ceil(count / pageSize);
  if (!requestPayload.modelGroupId || totalPages > 50) {
    throw taskError('COMMENT_HISTORY_TOO_LARGE', 'El historial de comentarios es demasiado extenso para comprobarlo de forma segura.');
  }

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    const payload = await fetchCommentFeedPage(page, response.url(), {
      ...requestPayload,
      page: pageNumber,
      pageSize
    });
    const match = findUserCommentInFeed(payload, expected);
    if (match) return match;
  }
  return null;
}

async function fetchCommentFeedPage(page, url, payload) {
  const result = await page.evaluate(async ({ endpoint, body }) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return {
      ok: response.ok,
      status: response.status,
      payload: await response.json().catch(() => null)
    };
  }, { endpoint: url, body: payload });

  if (!result.ok || Number(result.payload?.code) !== 0) {
    throw taskError(
      'COMMENT_HISTORY_UNAVAILABLE',
      result.payload?.msg || `Creality Cloud no permitió consultar los comentarios (${result.status}).`
    );
  }
  return result.payload;
}

function commentDate(value) {
  if (Number.isFinite(Number(value))) {
    const milliseconds = Number(value) < 10_000_000_000 ? Number(value) * 1000 : Number(value);
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

async function postComment(page, entry, kind) {
  const editor = await visibleFirst(page, [
    'textarea[placeholder*="Di algo"]',
    'textarea[placeholder*="Say"]',
    'textarea',
    '[contenteditable="true"]'
  ]);
  if (!editor) throw taskError('COMMENT_EDITOR_NOT_FOUND', 'No se encontró el campo para escribir el comentario.');
  await editor.fill(entry.text).catch(async () => {
    await editor.click();
    await page.keyboard.insertText(entry.text);
  });

  if (kind === 'image') {
    const imagePath = path.join(commentImagesDir(), path.basename(entry.image.filename));
    await fs.access(imagePath);
    let input = page.locator('input[type="file"][accept*="image"], input[type="file"]').first();
    if (!(await input.count())) {
      const imageControl = page.locator('button, [role="button"], i, svg').filter({ hasText: /imagen|image|foto|photo/i }).first();
      if (await imageControl.count()) await imageControl.click().catch(() => {});
      input = page.locator('input[type="file"][accept*="image"], input[type="file"]').first();
    }
    if (!(await input.count())) throw taskError('COMMENT_IMAGE_CONTROL_NOT_FOUND', 'No se encontró el control para adjuntar la imagen.');
    await input.setInputFiles(imagePath);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(5000);
  }

  const responsePromise = page.waitForResponse(
    (response) => /\/api\/cxy\/comment\/postComment(?:\?|$)/.test(response.url()) && response.request().method() === 'POST',
    { timeout: 15000 }
  );
  const submit = await visibleFirst(page, [
    'button:has-text("Comentarios")',
    'button:has-text("Comment")',
    'button:has-text("Publicar")',
    '.comment-btn',
    '[class*="comment"] button'
  ]);
  if (!submit) throw taskError('COMMENT_SUBMIT_NOT_FOUND', 'No se encontró el botón para publicar el comentario.');
  await submit.click();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  if (!response.ok() || Number(body?.code) !== 0) {
    throw taskError('COMMENT_REJECTED', body?.msg || `Creality Cloud rechazó el comentario (${response.status()}).`);
  }
  return { status: response.status(), response: body, imageAttached: kind === 'image' };
}

async function visibleFirst(page, selectors) {
  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = await matches.count();
    for (let index = 0; index < count; index += 1) {
      const locator = matches.nth(index);
      if (await locator.isVisible().catch(() => false)) return locator;
    }
  }
  return null;
}

function randomItem(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function skipped(reason, rewardVerification = null, extra = {}) {
  return {
    success: true,
    skipped: true,
    message: reason,
    details: { acted: [], failures: [], skipped: true, reason, rewardVerification, ...extra }
  };
}

function rewardDiagnostic(verification, design, incentive) {
  return {
    code: verification.status === 'not_credited' ? 'ACTION_CONFIRMED_REWARD_NOT_CREDITED' : 'REWARD_UNVERIFIED',
    category: 'reward',
    systemic: false,
    message: `El comentario se publicó, pero Creality Cloud no acreditó "${incentive.title}".`,
    url: design.url,
    before: verification.before,
    after: verification.after,
    actionEvidence: verification.actionEvidence,
    detectedAt: new Date().toISOString()
  };
}

function taskError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.userMessage = message;
  error.category = code.includes('INCENTIVE') ? 'reward' : 'page';
  return error;
}

function diagnosticError(diagnostic) {
  const error = taskError(diagnostic.code, diagnostic.message);
  error.category = diagnostic.category;
  error.systemic = diagnostic.systemic;
  return error;
}

function dayKey(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
