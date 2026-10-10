import type { SqlStorage } from '@cloudflare/workers-types';
import type { Classification, GptzeroUsage } from '../src/shared';
import { type Limits, periods } from './limits';

type StoredResult = Extract<Classification, { status: 'ok' | 'unrated' }>;
type Reservation =
  | { kind: 'reserved'; ticket: string; usage: GptzeroUsage }
  | { kind: 'cached'; result: StoredResult; usage: GptzeroUsage }
  | { kind: 'blocked'; result: Classification; usage: GptzeroUsage };

// All reads/checks/increments run in one synchronous SQLite transaction in one
// Durable Object. Concurrent Workers cannot spend the same remaining allowance.
export class QuotaStore {
  constructor(
    private sql: SqlStorage,
    private transaction: <T>(fn: () => T) => T,
  ) {
    sql.exec(
      'CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL)',
    );
    sql.exec('CREATE INDEX IF NOT EXISTS entries_expiry ON entries(expires)');
  }
  private get<T>(key: string, now: number): T | undefined {
    const row = this.sql
      .exec<{ value: string }>('SELECT value FROM entries WHERE key = ? AND expires > ?', key, now)
      .toArray()[0];
    return row ? JSON.parse(row.value) : undefined;
  }
  private set(key: string, value: unknown, expires: number) {
    this.sql.exec(
      'INSERT INTO entries (key,value,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires=excluded.expires',
      key,
      JSON.stringify(value),
      expires,
    );
  }
  usage(installation: string, limits: Limits, now: number): GptzeroUsage {
    const resetsAt = periods(now).week;
    const used = this.get<number>(`user:${installation}:${resetsAt}`, now) ?? 0;
    return { limit: limits.weekly, used, remaining: Math.max(0, limits.weekly - used), resetsAt };
  }
  reserve(
    installation: string,
    ip: string,
    textHash: string,
    characters: number,
    limits: Limits,
    now: number,
  ): Reservation {
    return this.transaction(() => {
      const usage = this.usage(installation, limits, now);
      const cached = this.get<StoredResult>(`result:${textHash}`, now);
      if (cached) return { kind: 'cached', result: cached, usage };
      const wait = this.get<{ until: number }>('cooldown', now);
      if (wait)
        return {
          kind: 'blocked',
          result: {
            status: 'error',
            code: 'rate_limit',
            message: 'GPTZero is temporarily unavailable. Please try later or switch to Jev.',
            retryAfter: wait.until - now,
          },
          usage,
        };
      if (this.get(`lock:${textHash}`, now))
        return { kind: 'blocked', result: { status: 'busy', retryAfter: 2000 }, usage };
      const end = periods(now);
      const counters: Array<{
        key: string;
        max: number;
        amount: number;
        until: number;
        weekly?: boolean;
      }> = [
        {
          key: `user:${installation}:${end.week}`,
          max: limits.weekly,
          amount: 1,
          until: end.week,
          weekly: true,
        },
        {
          key: `minute:${installation}:${end.minute}`,
          max: limits.perMinute,
          amount: 1,
          until: end.minute,
        },
        { key: `ip:${ip}:${end.day}`, max: limits.ipDaily, amount: 1, until: end.day },
        { key: `day:${end.day}`, max: limits.globalDaily, amount: 1, until: end.day },
        { key: `month:${end.month}`, max: limits.globalMonthly, amount: 1, until: end.month },
        {
          key: `characters:${end.month}`,
          max: limits.monthlyCharacters,
          amount: characters,
          until: end.month,
        },
      ];
      const values = counters.map((c) => ({ ...c, used: this.get<number>(c.key, now) ?? 0 }));
      for (const [i, c] of values.entries()) {
        if (c.used + c.amount > c.max)
          return {
            kind: 'blocked',
            usage,
            result: {
              status: 'error',
              code: i === 1 ? 'rate_limit' : 'quota',
              message: c.weekly
                ? 'Your weekly GPTZero allowance is used up. Wait for the reset or switch to Jev with your own key.'
                : i === 1
                  ? 'GPTZero checks are being paced. They will resume shortly.'
                  : 'The free GPTZero allowance is currently unavailable. Try after the reset or switch to Jev with your own key.',
              retryAfter: c.until - now,
            },
          };
      }
      for (const c of values) this.set(c.key, c.used + c.amount, c.until);
      const ticket = crypto.randomUUID();
      this.set(`lock:${textHash}`, ticket, now + 60000);
      return {
        kind: 'reserved',
        ticket,
        usage: { ...usage, used: usage.used + 1, remaining: Math.max(0, usage.remaining - 1) },
      };
    });
  }
  finish(
    textHash: string,
    ticket: string,
    result: StoredResult | undefined,
    now: number,
    cooldownMs = 0,
  ) {
    this.transaction(() => {
      if (this.get(`lock:${textHash}`, now) !== ticket) return;
      if (result)
        this.set(`result:${textHash}`, result, now + (result.status === 'ok' ? 86400000 : 3600000));
      this.sql.exec('DELETE FROM entries WHERE key = ?', `lock:${textHash}`);
      if (cooldownMs) {
        const until = Math.max(
          now + cooldownMs,
          this.get<{ until: number }>('cooldown', now)?.until ?? 0,
        );
        this.set('cooldown', { until }, until);
      }
    });
  }
  cleanup(now: number) {
    // Bounded cleanup prevents an idle deployment accumulating expired counters.
    this.sql.exec(
      'DELETE FROM entries WHERE key IN (SELECT key FROM entries WHERE expires <= ? LIMIT 500)',
      now,
    );
  }
}
