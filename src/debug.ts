// Gated debug logger: on in dev builds, or at runtime via localStorage['bghub-debug'] = '1'.
const ENABLED: boolean = (() => {
  try {
    if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
    return typeof localStorage !== 'undefined' && localStorage.getItem('bghub-debug') === '1';
  } catch {
    return false;
  }
})();

export function debug(...args: unknown[]): void {
  if (ENABLED) console.debug(...args);
}
