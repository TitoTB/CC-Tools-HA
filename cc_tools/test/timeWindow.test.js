import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDownloadPlan } from '../src/timeWindow.js';

const task = {
  windowStart: '08:00',
  windowEnd: '19:00',
  timezone: 'Europe/Madrid',
  dailyLimit: 30,
  minIntervalMinutes: 20
};

test('la planificación de descargas nunca salta al día siguiente', () => {
  const now = new Date(2026, 8, 21, 20, 0, 0);
  const generated = generateDownloadPlan(task, now);

  assert.deepEqual(generated.plan, []);
  assert.equal(generated.nextRunAt, '');
});

test('la planificación conserva al menos el intervalo y tiempo de ejecución', () => {
  const now = new Date(2026, 8, 21, 7, 0, 0);
  const generated = generateDownloadPlan(task, now, { remainingCount: 30 });

  assert.equal(generated.plan.length, 30);
  for (let index = 1; index < generated.plan.length; index += 1) {
    const gap = new Date(generated.plan[index]).getTime() - new Date(generated.plan[index - 1]).getTime();
    assert.ok(gap >= 22 * 60 * 1000);
  }
});

test('la planificación admite una separación mayor para impresiones largas', () => {
  const now = new Date(2026, 8, 21, 7, 0, 0);
  const generated = generateDownloadPlan(
    { ...task, dailyLimit: 3 },
    now,
    { remainingCount: 3, minimumSlotMinutes: 55 }
  );

  assert.equal(generated.plan.length, 3);
  for (let index = 1; index < generated.plan.length; index += 1) {
    const gap = new Date(generated.plan[index]).getTime() - new Date(generated.plan[index - 1]).getTime();
    assert.ok(gap >= 55 * 60 * 1000);
  }
});
