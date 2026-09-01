import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { CliError, safeErrorText } from './errors.mjs';
import { isWorkBranch } from './limits.mjs';

const execFile = promisify(execFileCb);

/**
 * @typedef {object} GitRunResult
 * @property {string | Buffer} stdout
 * @property {string | Buffer} stderr
 * @property {number} status
 */

/**
 * @typedef {object} GitRunOpts
 * @property {string} [cwd]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {number} [maxBuffer]
 * @property {'utf8' | 'buffer'} [encoding]
 * @property {number[]} [allowExit]
 */

/**
 * `git` via argv only — never a shell string.
 *
 * @param {string[]} args
 * @param {GitRunOpts} [opts]
 * @returns {Promise<GitRunResult>}
 */
export async function runGit(args, opts = {}) {
  const encoding = opts.encoding ?? 'utf8';
  const allowExit = opts.allowExit ?? [0];
  const execOpts = {
    cwd: opts.cwd,
    env: opts.env,
    maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
    encoding: encoding === 'buffer' ? 'buffer' : 'utf8',
  };
  try {
    const result = await execFile('git', args, execOpts);
    return { stdout: result.stdout, stderr: result.stderr, status: 0 };
  } catch (err) {
    const status = typeof err.code === 'number' ? err.code : -1;
    if (allowExit.includes(status)) {
      const empty = encoding === 'buffer' ? Buffer.alloc(0) : '';
      return {
        stdout: err.stdout ?? empty,
        stderr: err.stderr ?? empty,
        status,
      };
    }
    if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw err;
    }
    throw new CliError(`git ${args[0]} failed: ${safeErrorText(stderrOf(err))}`);
  }
}

/**
 * Parse `git remote get-url origin` into `owner/repo` when the host is github.com.
 * @param {string} remoteUrl
 * @returns {{ owner: string, repo: string, fullName: string } | null}
 */
export function parseGithubRepoFullName(remoteUrl) {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  const sshScp = trimmed.match(/^git@github\.com:(.+)$/i);
  if (sshScp) return splitOwnerRepo(sshScp[1]);

  let parsed;
  try {
    const withProto = /:\/\//.test(trimmed) ? trimmed : `ssh://${trimmed}`;
    parsed = new URL(withProto);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./i, '');
  if (host.toLowerCase() !== 'github.com') return null;
  return splitOwnerRepo(parsed.pathname);
}

/**
 * @param {string} pathish
 * @returns {{ owner: string, repo: string, fullName: string } | null}
 */
function splitOwnerRepo(pathish) {
  const parts = pathish
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1];
  if (!owner || !repo) return null;
  return { owner, repo, fullName: `${owner}/${repo}` };
}

/**
 * Checked-out branch name. Share continues this ref instead of minting `zoku/<hex>`.
 *
 * @param {string} cwd
 * @param {typeof runGit} [git]
 * @returns {Promise<string>}
 */
export async function currentWorkBranch(cwd, git = runGit) {
  const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  const name = String(stdout).trim();
  if (!name || name === 'HEAD') {
    throw new CliError('not on a branch (detached HEAD)');
  }
  if (!isWorkBranch(name)) {
    throw new CliError('invalid work branch');
  }
  return name;
}

/**
 * @param {string} cwd
 * @param {typeof runGit} [git]
 */
export async function originGithubRepo(cwd, git = runGit) {
  const { stdout } = await git(['remote', 'get-url', 'origin'], { cwd });
  const parsed = parseGithubRepoFullName(String(stdout));
  if (!parsed) {
    throw new CliError('origin is not a github.com remote');
  }
  return parsed;
}

/**
 * @param {string} cwd
 * @param {typeof runGit} [git]
 * @returns {Promise<string>}
 */
export async function headSha(cwd, git = runGit) {
  const { stdout } = await git(['rev-parse', 'HEAD'], { cwd });
  const sha = String(stdout).trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new CliError('could not resolve HEAD');
  }
  return sha.toLowerCase();
}

/**
 * @param {string} cwd
 * @param {string} branch
 * @param {typeof runGit} [git]
 */
export async function remoteBranchExists(cwd, branch, git = runGit) {
  const { stdout } = await git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], {
    cwd,
    env: gitNetEnv(),
  });
  return String(stdout).trim().length > 0;
}

/**
 * @param {string} cwd
 * @param {string} branch
 * @param {typeof runGit} [git]
 * @returns {Promise<{ kind: 'even' | 'ahead' | 'behind' | 'diverged', ahead: number, behind: number }>}
 */
export async function aheadBehind(cwd, branch, git = runGit) {
  const { stdout } = await git(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`], {
    cwd,
  });
  const parts = String(stdout).trim().split(/\s+/);
  const ahead = Number(parts[0]);
  const behind = Number(parts[1]);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
    throw new CliError('could not compare to origin');
  }
  if (ahead === 0 && behind === 0) return { kind: 'even', ahead, behind };
  if (ahead > 0 && behind === 0) return { kind: 'ahead', ahead, behind };
  if (ahead === 0 && behind > 0) return { kind: 'behind', ahead, behind };
  return { kind: 'diverged', ahead, behind };
}

/**
 * Push local HEAD to `refs/heads/<workBranch>` on origin. Never `--force`.
 *
 * @param {string} cwd
 * @param {string} workBranch
 * @param {typeof runGit} [git]
 */
export async function pushWorkBranch(cwd, workBranch, git = runGit) {
  if (!isWorkBranch(workBranch)) {
    throw new CliError('invalid work branch');
  }
  await git(['push', 'origin', `HEAD:refs/heads/${workBranch}`], {
    cwd,
    env: gitNetEnv(),
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * @param {string} cwd
 * @param {string} workBranch
 * @param {typeof runGit} [git]
 * @param {boolean} [ffOnly]
 */
export async function pullWorkBranch(cwd, workBranch, git = runGit, ffOnly = true) {
  if (!isWorkBranch(workBranch)) {
    throw new CliError('invalid work branch');
  }
  const args = ffOnly
    ? ['pull', '--ff-only', 'origin', workBranch]
    : ['pull', '--no-rebase', '--no-edit', 'origin', workBranch];
  await git(args, {
    cwd,
    env: gitNetEnv(),
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * Fetch origin, then push/pull only when the user already confirmed
 * (`--push` / `--pull` / `--sync`). Otherwise exit 2 so Claude Code can ask.
 *
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} opts.workBranch
 * @param {boolean} [opts.allowPush]
 * @param {boolean} [opts.allowPull]
 * @param {typeof runGit} [opts.git]
 */
export async function syncWorkBranch(opts) {
  const { cwd, workBranch, git = runGit } = opts;
  const allowPush = Boolean(opts.allowPush);
  const allowPull = Boolean(opts.allowPull);
  if (!isWorkBranch(workBranch)) {
    throw new CliError('invalid work branch');
  }

  const exists = await remoteBranchExists(cwd, workBranch, git);
  if (!exists) {
    if (!allowPush) {
      needConfirm(
        `origin/${workBranch} does not exist yet. Push this branch and continue sharing?`,
        '--push',
      );
    }
    await pushWorkBranch(cwd, workBranch, git);
    return;
  }

  await git(['fetch', 'origin', workBranch], {
    cwd,
    env: gitNetEnv(),
    maxBuffer: 16 * 1024 * 1024,
  });
  const rel = await aheadBehind(cwd, workBranch, git);

  if (rel.kind === 'even') return;

  if (rel.kind === 'ahead') {
    if (!allowPush) {
      needConfirm(
        `Local is ${commitsPhrase(rel.ahead)} ahead of origin/${workBranch}. Push and continue sharing?`,
        '--push',
      );
    }
    await pushWorkBranch(cwd, workBranch, git);
    return;
  }

  if (rel.kind === 'behind') {
    if (!allowPull) {
      needConfirm(
        `Local is ${commitsPhrase(rel.behind)} behind origin/${workBranch}. Pull and continue sharing?`,
        '--pull',
      );
    }
    await pullWorkBranch(cwd, workBranch, git, true);
    return;
  }

  if (!allowPush || !allowPull) {
    needConfirm(
      `Local and origin/${workBranch} have diverged (${rel.ahead} ahead, ${rel.behind} behind). Pull, then push, and continue sharing?`,
      '--sync',
    );
  }
  await pullWorkBranch(cwd, workBranch, git, false);
  await pushWorkBranch(cwd, workBranch, git);
}

/**
 * @param {string} question
 * @param {string} flag
 * @returns {never}
 */
function needConfirm(question, flag) {
  throw new CliError(`${question}\nconfirm: ${flag}`, 2);
}

/** @param {number} n */
function commitsPhrase(n) {
  return n === 1 ? '1 commit' : `${n} commits`;
}

/** @returns {NodeJS.ProcessEnv} */
export function gitNetEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function stderrOf(err) {
  if (err && typeof err === 'object' && 'stderr' in err && err.stderr) {
    const s = err.stderr;
    if (Buffer.isBuffer(s)) return s.toString('utf8');
    return String(s);
  }
  if (err instanceof Error) return err.message;
  return 'git failed';
}
