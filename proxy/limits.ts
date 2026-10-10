// These are protective defaults, not a promise of GPTZero sponsorship.
export type Limits = {
  weekly: number;
  perMinute: number;
  ipDaily: number;
  globalDaily: number;
  globalMonthly: number;
  monthlyCharacters: number;
};
export function readLimits(env: Record<string, unknown>): Limits {
  const value = (key: string, fallback: number) => {
    if (env[key] === undefined) return fallback;
    const n = Number(env[key]);
    if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000_000)
      throw new Error('Invalid quota configuration');
    return n;
  };
  return {
    weekly: value('INSTALL_WEEKLY_LIMIT', 1000),
    perMinute: value('INSTALL_MINUTE_LIMIT', 20),
    ipDaily: value('IP_DAILY_LIMIT', 2000),
    globalDaily: value('GLOBAL_DAILY_LIMIT', 5000),
    globalMonthly: value('GLOBAL_MONTHLY_LIMIT', 100000),
    monthlyCharacters: value('GLOBAL_MONTHLY_CHARACTER_LIMIT', 5000000),
  };
}
export function periods(now: number) {
  const date = new Date(now);
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const week = day - ((date.getUTCDay() + 6) % 7) * 86400000;
  return {
    minute: Math.floor(now / 60000) * 60000 + 60000,
    day: day + 86400000,
    week: week + 7 * 86400000,
    month: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  };
}
