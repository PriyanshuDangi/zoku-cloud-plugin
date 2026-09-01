import { CliError } from './errors.mjs';

/**
 * @param {string[]} argv
 * @returns {{
 *   command: string | null,
 *   sessionId: string | undefined,
 *   help: boolean,
 *   allowPush: boolean,
 *   allowPull: boolean,
 * }}
 */
export function parseArgs(argv) {
  /** @type {{
   *   command: string | null,
   *   sessionId: string | undefined,
   *   help: boolean,
   *   allowPush: boolean,
   *   allowPull: boolean,
   * }}
   */
  const out = {
    command: null,
    sessionId: undefined,
    help: false,
    allowPush: false,
    allowPull: false,
  };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) {
    out.command = rest.shift() ?? null;
  }
  while (rest.length) {
    const a = rest.shift();
    if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (a === '--session-id' || a === '-s') {
      const value = rest.shift();
      if (!value || value.startsWith('-')) {
        throw new CliError('missing --session-id value');
      }
      out.sessionId = value;
    } else if (a && a.startsWith('--session-id=')) {
      out.sessionId = a.slice('--session-id='.length);
    } else if (a === '--push') {
      out.allowPush = true;
    } else if (a === '--pull') {
      out.allowPull = true;
    } else if (a === '--sync') {
      out.allowPush = true;
      out.allowPull = true;
    } else {
      throw new CliError(`unknown argument: ${a}`);
    }
  }
  return out;
}
