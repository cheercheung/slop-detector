import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { QuotaStore } from '../proxy/quota';
import { periods, readLimits } from '../proxy/limits';
import { parseGptzeroResponse, validUsage } from '../src/gptzero-schema';
import { DEFAULT_SETTINGS, detectionChanged, postContentKey, type Classification } from '../src/shared';

const now = Date.UTC(2026, 8, 30, 12);
const sample = { documents: [{ predicted_class: 'mixed', class_probabilities: { human: 0.1, ai: 0.2, mixed: 0.7 }, confidence_category: 'high', inputText: 'never persist this', completely_generated_prob: 0.01 }] };
const verdict = parseGptzeroResponse(sample, now - 100, now);
const ok: Extract<Classification, { status: 'ok' }> = { status: 'ok', verdict, cached: false };
function database() {
  const db = new DatabaseSync(':memory:');
  const sql = { exec(query: string, ...bindings: any[]) { return { toArray: () => db.prepare(query).all(...bindings) }; } };
  // Real SQLite executes immediately, as does the Durable Object API.
  const adapter = { exec(query: string, ...bindings: any[]) { const rows = sql.exec(query, ...bindings).toArray(); return { toArray: () => rows }; } };
  const transaction = <T>(fn: () => T) => {
    db.exec('BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const store = () => new QuotaStore(adapter as any, transaction);
  return { db, store: store(), restart: store };
}

test('GPTZero uses documented three-class probabilities, sanitizes output and isolates Jev prompts', () => {
  assert.ok(Math.abs(verdict.probability - 0.9) < 0.00001);
  assert.equal(verdict.gptzero?.classification, 'mixed');
  assert.equal(JSON.stringify(verdict).includes('never persist'), false);
  for (const data of [{}, { documents: [{}] }, { documents: [{ ...sample.documents[0], class_probabilities: { human: -1, mixed: 1, ai: 1 } }] }, { documents: [{ ...sample.documents[0], class_probabilities: { human: 0.2, mixed: 0.2, ai: 0.2 } }] }]) assert.throws(() => parseGptzeroResponse(data, now, now));
  const post = { id: '1', text: 'Some readable post.', hasMedia: false, truncated: false };
  assert.equal(DEFAULT_SETTINGS.detector, 'gptzero');
  assert.equal(postContentKey(post), postContentKey(post, { ...DEFAULT_SETTINGS, prompt: 'Is this an ad?' }));
  assert.notEqual(postContentKey(post), postContentKey(post, { ...DEFAULT_SETTINGS, detector: 'jev' }));
  assert.equal(detectionChanged(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, prompt: 'Is this an ad?' }), false);
  assert.equal(detectionChanged(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, detector: 'jev' }), true);
  assert.ok(validUsage({ limit: 0, remaining: 0, used: 1, resetsAt: now }));
  assert.equal(validUsage({ limit: 1000, used: 5, remaining: 1000, resetsAt: now }), false);
});

test('quota reservation is atomic, persists across instances, and resets at Monday UTC', async () => {
  const { db, store, restart } = database();
  try {
    const limits = { ...readLimits({}), weekly: 2 };
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => Promise.resolve().then(() => store.reserve('user', 'ip', `hash-${i}`, 100, limits, now))));
    assert.equal(results.filter(r => r.kind === 'reserved').length, 2);
    assert.equal(store.usage('user', limits, now).remaining, 0);
    assert.equal(restart().usage('user', limits, now).used, 2);
    assert.equal(periods(now).week, Date.UTC(2026, 9, 5));
    assert.equal(restart().reserve('user', 'ip', 'next-week', 10, limits, periods(now).week).kind, 'reserved');
  } finally { db.close(); }
});

test('cached and concurrent duplicates do not spend twice, including across installations', () => {
  const { db, store } = database(); const limits = readLimits({});
  try {
    const first = store.reserve('one', 'ip', 'same-text', 100, limits, now);
    assert.equal(first.kind, 'reserved'); if (first.kind !== 'reserved') return;
    const waiting = store.reserve('two', 'ip', 'same-text', 100, limits, now + 1);
    assert.equal(waiting.kind, 'blocked');
    if (waiting.kind === 'blocked') assert.equal(waiting.result.status, 'busy');
    store.finish('same-text', first.ticket, ok, now + 100);
    assert.equal(store.reserve('one', 'ip', 'same-text', 100, limits, now + 200).kind, 'cached');
    assert.equal(store.reserve('two', 'ip', 'same-text', 100, limits, now + 200).kind, 'cached');
    assert.equal(store.usage('one', limits, now).used, 1);
    assert.equal(store.usage('two', limits, now).used, 0);
  } finally { db.close(); }
});

test('global/IP/character limits stop new installations, and failed reservations spend nothing', () => {
  for (const patch of [{ globalDaily: 1 }, { globalMonthly: 1 }, { monthlyCharacters: 100 }, { ipDaily: 1 }]) {
    const { db, store } = database(); const limits = { ...readLimits({}), ...patch };
    try {
      assert.equal(store.reserve('one', 'shared-ip', 'a', 100, limits, now).kind, 'reserved');
      const denied = store.reserve('new-install', 'shared-ip', 'b', 1, limits, now);
      assert.equal(denied.kind, 'blocked');
      assert.equal(store.usage('new-install', limits, now).used, 0);
    } finally { db.close(); }
  }
});

test('provider cooldown survives restarts and stale completions cannot overwrite new work', () => {
  const { db, store, restart } = database(); const limits = readLimits({});
  try {
    const first = store.reserve('one', 'ip', 'text', 10, limits, now);
    if (first.kind !== 'reserved') throw new Error('Expected reservation');
    store.finish('text', first.ticket, undefined, now, 120000);
    const blocked = restart().reserve('other', 'ip', 'other-text', 10, limits, now + 500);
    assert.equal(blocked.kind, 'blocked');
    if (blocked.kind === 'blocked') assert.equal(blocked.result.status, 'error');
    const second = store.reserve('one', 'ip', 'text', 10, limits, now + 120001);
    if (second.kind !== 'reserved') throw new Error('Expected fresh reservation');
    store.finish('text', first.ticket, ok, now + 120002);
    assert.equal(store.reserve('one', 'ip', 'text', 10, limits, now + 120003).kind, 'blocked');
    store.finish('text', second.ticket, ok, now + 120004);
    assert.equal(store.reserve('one', 'ip', 'text', 10, limits, now + 120005).kind, 'cached');
    assert.equal(store.usage('one', limits, now + 120005).used, 2, 'Uncertain failures remain charged against the safety allowance');
    assert.throws(() => readLimits({ GLOBAL_DAILY_LIMIT: 'unlimited' }));
  } finally { db.close(); }
});
