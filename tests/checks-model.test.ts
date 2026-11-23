import { checksTabUrl, clearChecksCache, loadChecks, parseChecks, parsePrUrl, safeGitHubUrl } from '../src/core/checks-model';

const wrap = (nodes: unknown[]) => ({
  repository: { pullRequest: { commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes } } } }] } } },
});
const run = (name: string, conclusion: string | null, extra: Record<string, unknown> = {}) => ({
  __typename: 'CheckRun',
  name,
  conclusion,
  status: conclusion ? 'COMPLETED' : 'IN_PROGRESS',
  detailsUrl: `https://github.com/o/r/actions/runs/1/job/${name}`,
  checkSuite: { workflowRun: { workflow: { name: 'CI' } } },
  ...extra,
});

describe('parseChecks', () => {
  test('classifies failed, pending and passed', () => {
    const res = parseChecks(
      wrap([
        run('lint', 'FAILURE'),
        run('build', 'TIMED_OUT'),
        run('e2e', 'CANCELLED'),
        run('deploy', 'ACTION_REQUIRED'),
        run('boot', 'STARTUP_FAILURE'),
        run('unit', 'SUCCESS'),
        run('opt', 'SKIPPED'),
        run('neutral', 'NEUTRAL'),
        run('slow', null),
        { __typename: 'StatusContext', context: 'ci/legacy', state: 'ERROR', targetUrl: 'https://github.com/x' },
        { __typename: 'StatusContext', context: 'ci/other', state: 'FAILURE', targetUrl: 'https://evil.example/x' },
        { __typename: 'StatusContext', context: 'ci/ok', state: 'SUCCESS' },
        { __typename: 'StatusContext', context: 'ci/wait', state: 'PENDING' },
      ])
    );
    expect(res?.failed.map((f) => f.name)).toEqual(['lint', 'build', 'e2e', 'deploy', 'boot', 'ci/legacy', 'ci/other']);
    expect(res?.passed).toBe(4);
    expect(res?.pending).toBe(2);
    expect(res?.failed[0]).toMatchObject({ workflow: 'CI', url: 'https://github.com/o/r/actions/runs/1/job/lint' });
    expect(res?.failed[6].url).toBeNull();
  });

  test('dedupes by name + workflow', () => {
    const other = run('lint', 'FAILURE', { checkSuite: { workflowRun: { workflow: { name: 'Other' } } } });
    const res = parseChecks(wrap([run('lint', 'FAILURE'), run('lint', 'FAILURE'), other]));
    expect(res?.failed).toHaveLength(2);
  });

  test('returns null without a rollup', () => {
    expect(parseChecks(null)).toBeNull();
    expect(parseChecks({ repository: { pullRequest: null } })).toBeNull();
    expect(parseChecks({ repository: { pullRequest: { commits: { nodes: [{ commit: { statusCheckRollup: null } }] } } } })).toBeNull();
  });
});

describe('helpers', () => {
  test('safeGitHubUrl allows only https github.com', () => {
    expect(safeGitHubUrl('https://github.com/a/b')).toBe('https://github.com/a/b');
    expect(safeGitHubUrl('http://github.com/a')).toBeNull();
    expect(safeGitHubUrl('javascript:alert(1)')).toBeNull();
    expect(safeGitHubUrl(null)).toBeNull();
  });
  test('parsePrUrl / checksTabUrl', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/12/files')).toEqual({ owner: 'o', repo: 'r', number: 12 });
    expect(parsePrUrl('https://github.com/o/r/issues/1')).toBeNull();
    expect(checksTabUrl('https://github.com/o/r/pull/12/files?x=1')).toBe('https://github.com/o/r/pull/12/checks');
  });
});

describe('loadChecks', () => {
  beforeEach(clearChecksCache);
  const url = 'https://github.com/o/r/pull/1';

  test('fetches once per PR and caches', async () => {
    const send = jest.fn().mockResolvedValue({ ok: true, data: wrap([run('lint', 'FAILURE')]) });
    const [a, b] = await Promise.all([loadChecks(url, send), loadChecks(url, send)]);
    await loadChecks(url, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toEqual({ owner: 'o', repo: 'r', number: 1 });
    expect(send.mock.calls[0][2]).toBe('o');
    expect(a?.failed).toHaveLength(1);
    expect(b).toBe(a);
  });

  test('does not cache failures and expires entries', async () => {
    const send = jest.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, data: wrap([]) });
    expect(await loadChecks(url, send, '', 0)).toBeNull();
    expect(await loadChecks(url, send, '', 1)).not.toBeNull();
    await loadChecks(url, send, '', 2);
    expect(send).toHaveBeenCalledTimes(2);
    await loadChecks(url, send, '', 10 * 60_000);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
