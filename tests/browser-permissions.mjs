import assert from 'node:assert/strict';

export const providerOrigins = [
  'https://direct.evolink.ai/*',
  'https://openrouter.ai/*',
  'https://api.typesafe.ai/*',
];

export async function mockPermissionPrompts(
  context,
  worker,
  extensionId,
  origins = providerOrigins,
) {
  const installed = await worker.evaluate(() => chrome.permissions.getAll());
  assert.ok(
    origins.every((origin) => !installed.origins.includes(origin)),
    'Fresh installation must not have provider permissions',
  );
  await worker.evaluate((origins) => {
    globalThis.__providerGrants = new Set();
    globalThis.__permissionRequests = [];
    globalThis.__denyNextPermission = false;
    const contains = chrome.permissions.contains.bind(chrome.permissions);
    const remove = chrome.permissions.remove.bind(chrome.permissions);
    chrome.permissions.contains = async (request) =>
      request.origins?.every((origin) => origins.includes(origin))
        ? request.origins.every((origin) => globalThis.__providerGrants.has(origin))
        : contains(request);
    chrome.permissions.remove = async (request) => {
      if (!request.origins?.every((origin) => origins.includes(origin))) return remove(request);
      request.origins.forEach((origin) => {
        globalThis.__providerGrants.delete(origin);
      });
      return true;
    };
  }, origins);
  await context.exposeBinding('__respondToPermissionPrompt', async (_source, request) => {
    assert.equal(request.origins.length, 1, 'Request only one provider per user action');
    assert.ok(origins.includes(request.origins[0]));
    return worker.evaluate((request) => {
      globalThis.__permissionRequests.push(request);
      if (globalThis.__denyNextPermission) {
        globalThis.__denyNextPermission = false;
        return false;
      }
      request.origins.forEach((origin) => {
        globalThis.__providerGrants.add(origin);
      });
      return true;
    }, request);
  });
  await context.addInitScript((id) => {
    if (location.origin !== `chrome-extension://${id}`) return;
    chrome.permissions.request = (request) => {
      if (!navigator.userActivation.isActive)
        return Promise.reject(new Error('Permission requested outside a user gesture'));
      return globalThis.__respondToPermissionPrompt(request);
    };
  }, extensionId);
}
