/** User-facing CLI failure. Message goes to stderr; never include tokens. */
export class CliError extends Error {
  /**
   * @param {string} message
   * @param {number} [exitCode]
   */
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

const SECRETISH =
  /sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|e2b_[A-Za-z0-9_]+|https?:\/\/[^/@\s]+:[^/@\s]+@/gi;

/** Strip credential-shaped substrings from an error string before printing. */
export function safeErrorText(value) {
  const raw = value instanceof Error ? value.message : String(value ?? 'failed');
  return raw.replace(SECRETISH, '[redacted]');
}
