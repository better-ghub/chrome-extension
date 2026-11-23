// Better GHub - PR page: visit tracking across remounts.
//
// The router remounts every feature on a settings change (unmount + mount in
// the same task). Those remounts must not count as a new visit: no second
// "mark seen" message, no hint entrance animation replay. A visit ends when
// the last mount for a PR aborts and nothing re-mounts in the same task.

let activeKey: string | null = null;
let live = 0;

/** Register a mount for PR `key`; returns true when it starts a new visit. */
export function beginVisit(key: string, signal: AbortSignal): boolean {
  const fresh = key !== activeKey;
  activeKey = key;
  live++;
  signal.addEventListener(
    'abort',
    () => {
      live--;
      queueMicrotask(() => {
        if (live === 0) activeKey = null;
      });
    },
    { once: true }
  );
  return fresh;
}
