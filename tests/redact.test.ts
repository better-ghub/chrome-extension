import { redactSecrets } from '../src/redact';

describe('redactSecrets', () => {
  test('redacts fine-grained PATs', () => {
    const input = 'error for github_pat_11ABCDEFG0abcdefghij_KLMNOPqrstuvwxyz0123456789ABCDEF while fetching';
    const out = redactSecrets(input);
    expect(out).not.toContain('github_pat_');
    expect(out).toContain('[REDACTED]');
  });

  test('redacts classic ghp_/gho_/ghs_ tokens', () => {
    expect(redactSecrets('ghp_abcDEF1234567890abcDEF1234567890abcd')).toBe('[REDACTED]');
    expect(redactSecrets('token gho_ABCdef1234 here')).toBe('token [REDACTED] here');
    expect(redactSecrets('ghs_XYZ0000000000')).toBe('[REDACTED]');
  });

  test('leaves ordinary text untouched', () => {
    const input = 'GitHub API error: 404 not found';
    expect(redactSecrets(input)).toBe(input);
  });

  test('redacts multiple tokens in one string', () => {
    const out = redactSecrets('ghp_aaaaaaaaaa and ghp_bbbbbbbbbb');
    expect(out).toBe('[REDACTED] and [REDACTED]');
  });
});
