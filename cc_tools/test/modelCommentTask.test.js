import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommentKindPlan,
  countTodayComments,
  eligibleCommentDesigns,
  eligibleCommentsForKind,
  findUserCommentInFeed,
  normalizeComments,
  prioritizedCommentCandidates,
  selectCommentKind
} from '../src/modelCommentTask.js';

test('normaliza la biblioteca y conserva imagen, estado y contador', () => {
  assert.deepEqual(normalizeComments([{
    id: 'one',
    text: '  Buen diseño  ',
    enabled: false,
    usageCount: 3,
    image: { id: 'img', filename: '../photo.png', name: 'photo.png', mime: 'image/png' }
  }]), [{
    id: 'one',
    text: 'Buen diseño',
    enabled: false,
    usageCount: 3,
    image: { id: 'img', filename: 'photo.png', name: 'photo.png', mime: 'image/png' }
  }]);
});

test('elige el tipo pendiente compatible con la biblioteca', () => {
  const config = { imageDailyLimit: 5, textDailyLimit: 1 };
  assert.equal(selectCommentKind(config, [{ id: 'a', text: 'A', image: null }], { image: 0, text: 0 }), 'text');
  assert.equal(selectCommentKind(config, [{ id: 'a', text: 'A', image: { filename: 'a.png' } }], { image: 0, text: 1 }), 'image');
  assert.equal(selectCommentKind(config, [{ id: 'a', text: 'A', image: { filename: 'a.png' } }], { image: 5, text: 1 }), '');
  assert.equal(selectCommentKind(config, [{ id: 'a', text: 'A', image: { filename: 'a.png' } }], { image: 0, text: 0 }, 'text'), 'text');
  assert.equal(selectCommentKind(config, [{ id: 'a', text: 'A', image: { filename: 'a.png' } }], { image: 0, text: 0 }, 'image'), 'image');
});

test('crea un plan barajado con el número pendiente de cada tipo', () => {
  const plan = buildCommentKindPlan(
    { imageDailyLimit: 3, textDailyLimit: 1 },
    { image: 1, text: 0 },
    () => 0
  );
  assert.equal(plan.length, 3);
  assert.equal(plan.filter((kind) => kind === 'image').length, 2);
  assert.equal(plan.filter((kind) => kind === 'text').length, 1);
});

test('el contador diario solo suma recompensas acreditadas por tipo', () => {
  const runs = [
    run('image', 'credited'),
    run('text', 'credited'),
    run('image', 'not_credited'),
    { ...run('image', 'credited'), taskId: 'modelLikes' }
  ];
  assert.deepEqual(countTodayComments(runs, 'UTC', new Date('2026-09-23T12:00:00Z')), { image: 1, text: 1 });
});

test('un modelo que ya recibió un comentario no vuelve a ser candidato', () => {
  const pending = { id: 'pending', url: 'https://example.com/pending', commentCompleted: false };
  const completed = { id: 'completed', url: 'https://example.com/completed', commentCompleted: true };
  const unavailable = { id: 'unavailable', url: 'https://example.com/unavailable', commentUnavailable: true };
  const withoutUrl = { id: 'invalid', commentCompleted: false };

  assert.deepEqual(eligibleCommentDesigns([completed, pending, unavailable, withoutUrl]), [pending]);
});

test('un modelo propio no es candidato para comentarios', () => {
  const own = { id: 'own', url: 'https://example.test/own', ownerUserId: '42' };
  const external = { id: 'external', url: 'https://example.test/external', ownerUserId: '84' };

  assert.deepEqual(eligibleCommentDesigns([own, external], '42'), [external]);
});

test('detecta un comentario previo del usuario conectado en la respuesta de Creality', () => {
  const payload = {
    result: {
      list: [{
        id: 'feed-1',
        comment: {
          id: 'comment-1',
          userId: 7963944884,
          createTime: 1790422091,
          pictures: ['photo.gif']
        }
      }]
    }
  };

  assert.deepEqual(findUserCommentInFeed(payload, '7963944884'), {
    id: 'comment-1',
    userId: '7963944884',
    kind: 'image',
    createdAt: '2026-09-26T11:28:11.000Z'
  });
  assert.equal(findUserCommentInFeed(payload, '123'), null);
});

test('puede omitir la prioridad de autores favoritos', () => {
  const favorite = { id: 'favorite', url: 'https://example.test/favorite', source: 'favorite', favoriteActive: true };
  const downloaded = { id: 'downloaded', url: 'https://example.test/downloaded', source: 'catalog' };

  assert.deepEqual(
    prioritizedCommentCandidates([favorite, downloaded], [favorite, downloaded], false, () => 0),
    [downloaded, favorite]
  );
});

test('los comentarios con imagen sirven para ambas tareas y los de texto solo para la tarea sin imagen', () => {
  const withImage = { id: 'image', text: 'Con imagen', image: { filename: 'photo.png' } };
  const textOnly = { id: 'text', text: 'Solo texto', image: null };

  assert.deepEqual(eligibleCommentsForKind([withImage, textOnly], 'image'), [withImage]);
  assert.deepEqual(eligibleCommentsForKind([withImage, textOnly], 'text'), [withImage, textOnly]);
});

function run(commentKind, status) {
  return {
    taskId: 'comments',
    finishedAt: '2026-09-23T10:00:00Z',
    details: { commentKind, rewardVerification: { status } }
  };
}
