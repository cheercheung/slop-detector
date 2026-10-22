import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

// Every suite uses its own managed browser/profile and a finite whole-suite deadline.
export async function launchTestBrowser(prefix, options) {
  const profile = await mkdtemp(path.join(tmpdir(), prefix));
  let context;
  const matches = () =>
    execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.includes(`--user-data-dir=${profile}`));
  const cleanup = async () => {
    for (const line of matches()) {
      const pid = Number(line.trim().split(/\s/)[0]);
      try {
        process.kill(pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    for (let i = 0; i < 20 && matches().length; i++) await delay(100);
    for (const line of matches()) {
      const pid = Number(line.trim().split(/\s/)[0]);
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    assert.deepEqual(matches(), [], 'Browser processes must exit');
    await rm(profile, { recursive: true, force: true });
  };
  const timer = setTimeout(() => {
    console.error('Browser suite exceeded 180 seconds; cleaning up its profile and processes.');
    void cleanup().finally(() => process.exit(124));
  }, 180_000);
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    if (executablePath?.includes('/Google Chrome.app/'))
      throw new Error('Daily Chrome is not allowed for tests');
    context = await chromium.launchPersistentContext(profile, {
      ...options,
      executablePath,
      timeout: 20_000,
      locale: 'en-US',
    });
    const close = context.close.bind(context);
    context.close = async (...args) => {
      try {
        await close(...args);
      } finally {
        clearTimeout(timer);
        await cleanup();
      }
    };
    return { context, profile };
  } catch (error) {
    clearTimeout(timer);
    await cleanup();
    throw error;
  }
}
