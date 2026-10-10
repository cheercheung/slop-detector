export function mockPermissions(origins: string[]) {
  const granted = new Set(origins);
  const added: Array<(permissions: { origins: string[] }) => void> = [];
  const removed: typeof added = [];
  return {
    granted,
    grant(origin: string) {
      granted.add(origin);
      added.forEach((listener) => {
        listener({ origins: [origin] });
      });
    },
    contains: async ({ origins }: { origins: string[] }) =>
      origins.every((origin) => granted.has(origin)),
    remove: async ({ origins }: { origins: string[] }) => {
      const changed = origins.filter((origin) => granted.delete(origin));
      if (changed.length)
        removed.forEach((listener) => {
          listener({ origins: changed });
        });
      return true;
    },
    onAdded: {
      addListener: (listener: (typeof added)[number]) => {
        added.push(listener);
      },
    },
    onRemoved: {
      addListener: (listener: (typeof removed)[number]) => {
        removed.push(listener);
      },
    },
  };
}
