// Defense-in-depth: strip anything that looks like a GitHub token from a string
// before it is logged or handed back across the messaging boundary. The token
// today only travels in Authorization headers, but this guards against a future
// change accidentally serialising it into an error message.

const TOKEN_PATTERN = /\b(github_pat_[A-Za-z0-9_]+|gh[posru]_[A-Za-z0-9_]+)\b/g;

export function redactSecrets(input: string): string {
  return input.replace(TOKEN_PATTERN, '[REDACTED]');
}
