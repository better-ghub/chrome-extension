// Regression tests for issues found in code review (content-script side).
import { RowLoader } from '../src/features/pr-list/loader';
import { attachToaster, _toastElements } from '../src/features/pr-page/toast';

type SendMessage = (msg: unknown) => Promise<unknown>;
const runtime = (globalThis as unknown as { chrome: { runtime: { sendMessage: SendMessage; id?: string } } }).chrome.runtime;

describe('RowLoader wakes itself up to retry', () => {
  const original = runtime.sendMessage;
  afterEach(() => {
    runtime.sendMessage = original;
    jest.useRealTimers();
  });

  test('failed rows trigger a rescan after the backoff even without DOM mutations', async () => {
    jest.useFakeTimers();
    runtime.sendMessage = () => Promise.resolve({ ok: false, error: 'network: offline' });
    const ctl = new AbortController();
    const onUpdate = jest.fn();
    const loader = new RowLoader({ signal: ctl.signal, viewer: 'me', withLabels: false, onUpdate });
    loader.request({ owner: 'o', repo: 'r', number: 1, key: 'o/r#1' });
    // flush microtask queue + the fake background response
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(loader.get('o/r#1')?.status).toBe('error');

    await jest.advanceTimersByTimeAsync(16_000);
    expect(onUpdate).toHaveBeenCalledTimes(2); // the wake-up → controller rescans → retry
    ctl.abort();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  test('a rate-limit pause schedules a wake-up at its end', async () => {
    jest.useFakeTimers();
    const reset = Math.floor(Date.now() / 1000) + 120;
    runtime.sendMessage = () => Promise.resolve({ ok: false, rateLimited: true, rateLimit: { remaining: 0, limit: 5000, reset } });
    const ctl = new AbortController();
    const onUpdate = jest.fn();
    const loader = new RowLoader({ signal: ctl.signal, viewer: 'me', withLabels: false, onUpdate });
    loader.request({ owner: 'o', repo: 'r', number: 2, key: 'o/r#2' });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(loader.rateLimitedUntil).toBe(reset * 1000);
    await jest.advanceTimersByTimeAsync(119_000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(onUpdate).toHaveBeenCalledTimes(2);
    ctl.abort();
  });
});

describe('toaster after navigation', () => {
  test('show() from a late caller is ignored once the mount is aborted', async () => {
    const ctl = new AbortController();
    const toaster = attachToaster(ctl.signal);
    ctl.abort();
    await Promise.resolve();
    toaster.show('late toast');
    expect(_toastElements()).toHaveLength(0);
    expect(document.querySelector('[class*="bghub-toast"]')).toBeNull();
  });
});
