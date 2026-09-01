import { CliError } from './errors.mjs';
import { MAX_PATCH_BYTES } from './limits.mjs';
import { runGit } from './git.mjs';

/**
 * Snapshot the worktree vs HEAD as a binary patch without mutating the user's index.
 * Temp `GIT_INDEX_FILE`: read-tree HEAD → add -A → write-tree → diff --binary -M.
 *
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} opts.indexFile
 * @param {typeof runGit} [opts.git]
 * @param {NodeJS.ProcessEnv} [opts.baseEnv]
 * @returns {Promise<Buffer>}
 */
export async function snapshotDirtyWorktree(opts) {
  const git = opts.git ?? runGit;
  const env = { ...(opts.baseEnv ?? process.env), GIT_INDEX_FILE: opts.indexFile };
  const cwd = opts.cwd;

  await git(['read-tree', 'HEAD'], { cwd, env });
  await git(['add', '-A'], { cwd, env });
  const treeRes = await git(['write-tree'], { cwd, env });
  const tree = String(treeRes.stdout).trim();
  if (!/^[0-9a-f]{40}$/i.test(tree)) {
    throw new CliError('git write-tree did not return a tree');
  }

  let diffRes;
  try {
    diffRes = await git(['diff', '--binary', '-M', 'HEAD', tree], {
      cwd,
      env,
      encoding: 'buffer',
      allowExit: [0, 1],
      maxBuffer: MAX_PATCH_BYTES + 65536,
    });
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new CliError('dirty patch exceeds 16MiB');
    }
    throw err;
  }

  const patch = toBuffer(diffRes.stdout);
  if (patch.length > MAX_PATCH_BYTES) {
    throw new CliError('dirty patch exceeds 16MiB');
  }
  return patch;
}

/**
 * @param {string | Buffer} value
 * @returns {Buffer}
 */
function toBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}
