import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { packSeedBundle } from './bundle.mjs';
import { cloudSessionUrl, loadToken, writeLink } from './config.mjs';
import { snapshotDirtyWorktree } from './dirty.mjs';
import { CliError } from './errors.mjs';
import {
  currentWorkBranch,
  headSha,
  originGithubRepo,
  syncWorkBranch,
} from './git.mjs';
import { putGzip, requestJson, throwApi } from './http.mjs';
import { transformJsonl } from './jsonl.mjs';
import { MAX_JSONL_BYTES } from './limits.mjs';
import { uploadSeed } from './seed.mjs';
import { resolveShareSession } from './session.mjs';

/**
 * @param {object} opts
 * @param {string} [opts.sessionId]
 * @param {string} [opts.cwd]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.homedir]
 * @param {(url: string) => void} [opts.writeStdout]
 * @param {boolean} [opts.allowPush]
 * @param {boolean} [opts.allowPull]
 * @returns {Promise<string>} session URL
 */
export async function runShare(opts = {}) {
  const env = opts.env ?? process.env;
  const homedir = opts.homedir ?? os.homedir();
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const writeStdout = opts.writeStdout ?? ((url) => process.stdout.write(`${url}\n`));

  const token = await loadToken(homedir);
  if (!token) throw new CliError('run zoku login');

  const resolved = await resolveShareSession({
    sessionId: opts.sessionId,
    cwd,
    env,
    homedir,
  });

  const origin = await originGithubRepo(cwd);
  const reposRes = await requestJson('GET', '/api/cli/repos', { token, env });
  if (reposRes.status === 401) throw new CliError('run zoku login');
  if (!reposRes.ok) throwApi(reposRes, 'failed to list repos');

  const repos = reposRes.json && Array.isArray(reposRes.json.repos) ? reposRes.json.repos : [];
  const hit = repos.find(
    (row) => row && typeof row === 'object' && row.fullName === origin.fullName,
  );
  if (!hit || typeof hit !== 'object') {
    const installUrl =
      reposRes.json && typeof reposRes.json.installUrl === 'string' ? reposRes.json.installUrl : '';
    throw new CliError(
      installUrl
        ? `GitHub App is not installed for ${origin.fullName}. Install: ${installUrl}`
        : `GitHub App is not installed for ${origin.fullName}. Connect repositories in Zoku Cloud.`,
    );
  }
  if (typeof hit.installationId !== 'number' || !Number.isFinite(hit.installationId)) {
    throw new CliError(`no installationId for ${origin.fullName}`);
  }
  const baseBranch = typeof hit.defaultBranch === 'string' ? hit.defaultBranch.trim() : '';
  if (!baseBranch) throw new CliError(`no default branch for ${origin.fullName}`);

  const jsonlStat = await stat(resolved.transcriptPath);
  if (jsonlStat.size > MAX_JSONL_BYTES) {
    throw new CliError('session jsonl exceeds 48MiB');
  }
  const jsonlRaw = await readFile(resolved.transcriptPath, 'utf8');
  const sandboxCwd = `/workspace/${origin.repo}`;
  const prepared = transformJsonl(jsonlRaw, { localCwd: cwd, sandboxCwd });
  const jsonlBytes = Buffer.byteLength(prepared.text, 'utf8');
  if (jsonlBytes > MAX_JSONL_BYTES) {
    throw new CliError('session jsonl exceeds 48MiB');
  }

  const workBranch = await currentWorkBranch(cwd);
  await syncWorkBranch({
    cwd,
    workBranch,
    allowPush: Boolean(opts.allowPush),
    allowPull: Boolean(opts.allowPull),
  });

  const sha = await headSha(cwd);

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'zoku-share-'));
  try {
    const indexFile = path.join(tmp, 'index');
    const bundleDir = path.join(tmp, 'bundle');
    await mkdir(bundleDir);
    const patch = await snapshotDirtyWorktree({ cwd, indexFile });

    /** @type {import('./bundle.mjs').BundleManifest} */
    const manifest = {
      v: 1,
      resumeId: resolved.sessionId,
      localCwd: cwd,
      sandboxCwd,
      jsonlBytes,
      patchBytes: patch.length,
      headSha: sha,
    };

    const gzip = await packSeedBundle({
      dir: bundleDir,
      outFile: path.join(tmp, 'seed.tar.gz'),
      manifest,
      jsonl: prepared.text,
      patch,
    });

    /** @type {Record<string, unknown>} */
    const importBody = {
      repoFullName: origin.fullName,
      baseBranch,
      workBranch,
      installationId: hit.installationId,
      resumeId: resolved.sessionId,
    };
    if (prepared.title) importBody.title = prepared.title;
    if (prepared.model) importBody.model = prepared.model;

    const imported = await requestJson('POST', '/api/cli/sessions/import', {
      token,
      env,
      body: importBody,
    });
    if (imported.status === 401) throw new CliError('run zoku login');
    if (!imported.ok || !imported.json) throwApi(imported, 'import failed');

    const cloudId = typeof imported.json.id === 'string' ? imported.json.id : '';
    const seedUrl = typeof imported.json.seedUrl === 'string' ? imported.json.seedUrl : '';
    const seedToken = typeof imported.json.seedToken === 'string' ? imported.json.seedToken : '';
    if (!cloudId || !seedUrl || !seedToken) {
      throw new CliError('import did not return a seed target');
    }

    await uploadSeed({
      seedUrl,
      seedToken,
      gzip,
      sessionId: cloudId,
      put: putGzip,
      reseed: async () => {
        const again = await requestJson('POST', `/api/cli/sessions/${cloudId}/reseed`, {
          token,
          env,
        });
        if (!again.ok || !again.json) throwApi(again, 'reseed failed');
        const nextToken = typeof again.json.seedToken === 'string' ? again.json.seedToken : '';
        if (!nextToken) throw new CliError('reseed did not return a token');
        const nextUrl = typeof again.json.seedUrl === 'string' ? again.json.seedUrl : seedUrl;
        return { seedToken: nextToken, seedUrl: nextUrl };
      },
    });

    await pollUntilRunning(cloudId, token, env);

    const url = cloudSessionUrl(cloudId, env);
    await writeLink(
      resolved.sessionId,
      { cloudId, workBranch, repo: origin.fullName },
      homedir,
    );
    writeStdout(url);
    return url;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * @param {string} cloudId
 * @param {string} token
 * @param {NodeJS.ProcessEnv} env
 */
async function pollUntilRunning(cloudId, token, env) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const st = await requestJson('GET', `/api/cli/sessions/${cloudId}`, { token, env });
      const status = st.json && typeof st.json.status === 'string' ? st.json.status : '';
      if (status === 'running') return;
      if (status === 'dead') throw new CliError('session died during import');
    } catch (err) {
      if (err instanceof CliError) throw err;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new CliError('session did not become ready');
}
