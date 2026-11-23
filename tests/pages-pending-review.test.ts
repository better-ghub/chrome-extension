import { pendingCommentsFrom } from '../src/features/pr-page/pending-review';

const data = (nodes: unknown) => ({ repository: { pullRequest: { reviews: { nodes } } } });

describe('pendingCommentsFrom', () => {
  test('reads the draft comment count', () => {
    expect(pendingCommentsFrom(data([{ comments: { totalCount: 4 } }]))).toBe(4);
  });
  test.each([[null], [undefined], [{}], [data([])], [data([{ comments: { totalCount: 0 } }])], [data('x')], [{ repository: null }]])(
    'is 0 for %j',
    (value) => expect(pendingCommentsFrom(value)).toBe(0)
  );
});
