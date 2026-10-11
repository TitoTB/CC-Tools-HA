import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { normalizeFavoriteProfiles, normalizeFavoriteAvatarUrl, DEFAULT_FAVORITE_PROFILE } from '../src/favoriteProfiles.js';
import { readFavoriteProfileFromPage } from '../src/crealityFavoriteProfile.js';
import { canonicalModelUrl, modelKeyFromUrl } from '../src/modelIdentity.js';

const previousDataDir = process.env.CCTOOLS_DATA_DIR;
const temporaryDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cctools-avatar-refresh-'));
process.env.CCTOOLS_DATA_DIR = temporaryDataDir;
const storage = await import(`../src/storage.js?avatar-test=${Date.now()}`);
after(async () => {
  if (previousDataDir === undefined) delete process.env.CCTOOLS_DATA_DIR;
  else process.env.CCTOOLS_DATA_DIR = previousDataDir;
  await fs.rm(temporaryDataDir, { recursive: true, force: true });
});

const source = (await fs.readFile(new URL('../src/favoriteModelIndex.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/^export /gm, '');
function harness(options = {}) {
  let currentId = '', pageVisits = 0;
  const page = {
    async goto(url) { currentId = url.match(/user\/(\d+)/)[1]; pageVisits++; },
    async waitForTimeout() {},
    async evaluate() { return { top: 0, height: 100, viewport: 100 }; },
    locator(selector) {
      const node = {
        first() { return node; }, async waitFor() {},
        async isVisible() { return selector.includes('.empty_comp') && options.confirmedEmpty === true; },
        async count() { return options.noModels ? 0 : 1; },
        async getAttribute(name) {
          if (selector === '.user-name .text-ellipsis' && name === 'title') return 'Current name';
          if (selector === '.creality-user-avatar' && name === 'style') {
            if (options.noAvatar) return '';
            return `background-image: url("${options.avatar || `https://pic2-cdn.creality.com/avatar/new-${currentId}`}" );`;
          }
          return '';
        },
        async textContent() { return selector === '.user-id' ? `ID: ${options.visibleId || currentId}` : 'Current name'; },
        async evaluateAll() { return options.noModels ? [] : [{ href: `https://www.crealitycloud.com/es/model-detail/test-${currentId}`, title: 'Test model' }]; }
      };
      return node;
    }
  };
  const context = vm.createContext({ Date, Map, Set, Promise, console: { error() {} },
    normalizeFavoriteProfiles, normalizeFavoriteAvatarUrl, readFavoriteProfileFromPage,
    canonicalModelUrl, modelKeyFromUrl, ...storage,
    withIsolatedBrowser: async (_options, callback) => callback({ pages: () => [page] }) });
  vm.runInContext(source, context);
  return { context, visits: () => pageVisits };
}

test('Actualizar renews default and custom avatars in the existing profile scan and persists them', async () => {
  const config = await storage.readConfig();
  config.crealityFavorites = normalizeFavoriteProfiles([...config.crealityFavorites,
    { userId: '123456789', name: 'Maker', avatarUrl: 'https://pic2-cdn.creality.com/avatar/old' }]);
  await storage.writeConfig(config);
  const h = harness();
  const results = await h.context.queueFavoriteProfilesFullRefresh(config.crealityFavorites, { source: 'manual' });
  assert.ok(results.every(result => result.ok));
  assert.equal(h.visits(), 2);
  const updated = await storage.readConfig();
  for (const favorite of updated.crealityFavorites) {
    assert.equal(favorite.avatarUrl, `https://pic2-cdn.creality.com/avatar/new-${favorite.userId}`);
    assert.equal(favorite.indexStatus, 'ready');
    assert.equal(favorite.indexedModelCount, 1);
  }
  assert.equal(updated.crealityFavorites[0].isDefault, true);
  assert.equal(updated.crealityFavorites[0].name, DEFAULT_FAVORITE_PROFILE.name);
  await storage.writeConfig(updated);
  assert.deepEqual((await storage.readConfig()).crealityFavorites, updated.crealityFavorites);
});

test('a subsequent refresh replaces a previously updated photo', async () => {
  const config = await storage.readConfig();
  const avatar = 'https://pic2-cdn.creality.com/avatar/second-photo';
  const h = harness({ avatar });
  await h.context.queueFavoriteProfilesFullRefresh(config.crealityFavorites, { source: 'manual' });
  assert.ok((await storage.readConfig()).crealityFavorites.every(profile => profile.avatarUrl === avatar));
});

test('missing, invalid or mismatched profile images do not replace the last good photo', async () => {
  for (const options of [{ noAvatar: true }, { avatar: 'https://example.com/untrusted.png' }, { visibleId: '99999' }]) {
    const before = await storage.readConfig();
    const h = harness(options);
    await h.context.queueFavoriteProfilesFullRefresh(before.crealityFavorites, { source: 'manual' });
    const after = await storage.readConfig();
    assert.deepEqual(after.crealityFavorites.map(p => p.avatarUrl), before.crealityFavorites.map(p => p.avatarUrl));
  }
});

test('a photo can refresh even when the model list is temporarily empty', async () => {
  const config = await storage.readConfig();
  const h = harness({ avatar: 'https://pic2-cdn.creality.com/avatar/without-models', noModels: true });
  const result = await h.context.queueFavoriteProfileSync(config.crealityFavorites[1], { full: true, source: 'manual' });
  assert.equal(result.ok, false);
  const updated = (await storage.readConfig()).crealityFavorites[1];
  assert.equal(updated.avatarUrl, 'https://pic2-cdn.creality.com/avatar/without-models');
  assert.equal(updated.indexedModelCount, config.crealityFavorites[1].indexedModelCount);
});

test('default avatars remain a fallback when no valid stored photo exists', () => {
  const profiles = normalizeFavoriteProfiles([DEFAULT_FAVORITE_PROFILE].map(profile => ({ ...profile, avatarUrl: 'javascript:invalid' })));
  assert.deepEqual(profiles, [DEFAULT_FAVORITE_PROFILE]);
});

test('un perfil confirmado vacío se guarda sin error, conserva su foto y no se reindexa cada cinco minutos', async () => {
  const config = await storage.readConfig();
  const h = harness({ noModels: true, confirmedEmpty: true });
  for (const profile of config.crealityFavorites) {
    const beforeRuns = (await storage.readRuns()).length;
    const result = await h.context.queueFavoriteProfileSync(profile, { full: false });
    assert.equal(result.ok, true);
    assert.equal(result.full, true);
    const saved = (await storage.readConfig()).crealityFavorites.find(p => p.userId === profile.userId);
    assert.equal(saved.indexStatus, 'empty');
    assert.equal(saved.indexedModelCount, 0);
    assert.equal(saved.lastModelIndexedAt, '');
    assert.ok(saved.indexedAt);
    assert.ok(saved.fullIndexedAt);
    assert.equal(saved.avatarUrl, `https://pic2-cdn.creality.com/avatar/new-${profile.userId}`);
    assert.equal((await storage.readRuns()).length, beforeRuns);
    assert.equal(h.context.favoriteSyncPlan(saved, Date.parse(saved.indexedAt) + 5 * 60 * 1000).due, false);
    assert.equal(h.context.favoriteSyncPlan(saved, Date.parse(saved.indexedAt) + 6 * 60 * 60 * 1000).due, true);
  }
});

test('un perfil antes vacío vuelve a Actualizado cuando publica un diseño', async () => {
  const config = await storage.readConfig();
  const profile = config.crealityFavorites[1];
  assert.equal(profile.indexStatus, 'empty');
  const h = harness();
  assert.equal((await h.context.queueFavoriteProfileSync(profile, { full: false })).ok, true);
  const saved = (await storage.readConfig()).crealityFavorites[1];
  assert.equal(saved.indexStatus, 'ready');
  assert.equal(saved.indexedModelCount, 1);
});
