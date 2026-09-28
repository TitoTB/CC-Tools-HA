import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { actionInfo, chooseCandidates, compareIncentiveProgress, isCollectionControlActive } from '../src/modelActionTask.js';

const source = fs.readFileSync(new URL('../src/modelActionTask.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function extract(name) {
  const start = source.indexOf(`async function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

function workflow({ saved = false, credited = true, completed = false, failRequest = false, records } = {}) {
  const designs = records || [{ id: 'model', url: 'https://example.test/model' }];
  const writes = [];
  let calls = 0;
  let active = saved;
  const control = { waitFor: async () => {} };
  const page = { locator: () => ({ first: () => control }), reload: async () => {}, waitForTimeout: async () => {} };
  const progress = done => ({ found: true, title: 'Collection Models', done, valid: 1, completed: done === 1 });
  const context = vm.createContext({
    ACTIONS: { add_to_collection: actionInfo('add_to_collection') },
    readDesigns: async () => designs, chooseCandidates,
    withAutomationBrowser: async (_, callback) => callback({ pages: () => [page] }),
    observeCrealityPage: () => ({ snapshot: async () => {}, mark: () => 0, captureSince: async () => ({ responses: [], failedRequests: [] }), stop() {} }),
    readIncentiveProgress: async () => progress(completed ? 1 : 0),
    waitForIncentiveProgress: async () => progress(credited ? 1 : 0),
    compareIncentiveProgress,
    prepareActionPage: async () => ({ modelId: 'observed-model', authenticationHeaders: { __cxy_uid_: 'current-user' } }),
    readModelOwnership: async () => ({}), updateDesignOwnership: async () => null, isOwnModel: () => false,
    inspectControlState: async () => ({ visible: true, ariaPressed: String(active) }), isCollectionControlActive,
    collectCatalogCandidates: async () => designs,
    appendDesign: async record => ({ record: designs.find(design => design.id === record.id) || record }),
    updateDesignAction: async (id, key, outcome, verification) => {
      writes.push(outcome);
      Object.assign(designs.find(record => record.id === id), { collectionActionState: outcome, collectionCompleted: ['credited', 'already_applied'].includes(outcome) });
      return designs.find(record => record.id === id);
    },
    captureDiagnosticImage: async () => null, inspectCrealityPage: async () => null,
    addModelToDefaultCollection: async () => {
      calls++;
      assert.equal(writes.at(-1), 'ambiguous', 'persiste el intento antes de enviarlo');
      if (failRequest) throw Object.assign(Error('Respuesta incierta'), { code: 'COLLECTION_OUTCOME_UNKNOWN' });
      active = true;
      return { accepted: true, http: 200, code: 0 };
    },
    analyzeActionTrace: () => ({ systemic: false }),
    rewardDiagnostic: () => ({ systemic: false }), rewardMessage: verification => verification.status,
    saveActionImages: async () => [], captureDiagnosticScreenshot: async () => null,
    failureFromDiagnostic: diagnostic => diagnostic,
    diagnoseTaskError: async error => ({ code: error.code, systemic: false }),
    attachFailedAction: async () => {},
    taskError: (code, category, message) => Object.assign(Error(message), { code, category })
  });
  vm.runInContext(`${extract('runModelAction')}\n${extract('performAction')}`, context);
  return { run: () => context.runModelAction('add_to_collection'), writes, calls: () => calls };
}

test('colección se completa solo después de acreditar el punto', async () => {
  const flow = workflow();
  const result = await flow.run();
  assert.equal(result.success, true);
  assert.equal(result.details.acted.length, 1);
  assert.deepEqual(flow.writes, ['ambiguous', 'credited']);
  assert.equal(flow.calls(), 1);
});

test('guardado aceptado sin punto queda pendiente de recompensa y sin reintento ese día', async () => {
  const flow = workflow({ credited: false });
  const result = await flow.run();
  assert.equal(result.success, false);
  assert.equal(result.details.retryableToday, false);
  assert.deepEqual(flow.writes, ['ambiguous', 'applied_uncredited']);
  assert.equal(result.details.acted.length, 0);
});

test('tras respuesta incierta una nueva ejecución tampoco recupera el modelo desde Explorar', async () => {
  const flow = workflow({ failRequest: true });
  assert.equal((await flow.run()).success, false);
  assert.deepEqual(flow.writes, ['ambiguous']);
  assert.equal((await flow.run()).skipped, true);
  assert.equal(flow.calls(), 1);
});

test('omite un guardado previo y una recompensa diaria ya completada sin enviar altas', async () => {
  for (const options of [{ saved: true }, { completed: true }]) {
    const flow = workflow(options);
    assert.equal((await flow.run()).skipped, true);
    assert.equal(flow.calls(), 0);
  }
});
