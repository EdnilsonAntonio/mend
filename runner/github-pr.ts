import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Octokit } from '@octokit/rest';
import type { HealAssessment } from '../agent/loop/confidence.js';
import { assertPrEligible } from '../agent/loop/confidence.js';
import {
  buildBranchName,
  buildCommitMessage,
  buildPatch,
  buildPrBody,
  buildPrTitle,
  type PatchFailureCode,
} from './pr-content.js';

export const DEFAULT_BASE_BRANCH = 'main';
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export class GitHubConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubConfigError';
  }
}

export interface GitHubConfig {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly baseBranch: string;
}

/**
 * Resolve GitHub configuration from environment variables.
 * Returns null if GITHUB_TOKEN is unset or empty (delivery disabled).
 * Throws GitHubConfigError on malformed config.
 */
export function resolveGitHubConfig(env: NodeJS.ProcessEnv): GitHubConfig | null {
  const token = (env.GITHUB_TOKEN ?? '').trim();
  if (token === '') {
    return null;
  }

  const repository = (env.GITHUB_REPOSITORY ?? '').trim();
  if (repository === '') {
    throw new GitHubConfigError('GITHUB_REPOSITORY is not set; expected "owner/repo"');
  }

  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new GitHubConfigError('GITHUB_REPOSITORY must be "owner/repo"');
  }

  const parts = repository.split('/');
  const owner = parts[0] ?? '';
  const repo = parts[1] ?? '';

  const baseBranch = (env.GITHUB_BASE_BRANCH ?? '').trim() || DEFAULT_BASE_BRANCH;

  return { token, owner, repo, baseBranch };
}

/**
 * Read the spec file from disk, never clamped. Throws on error.
 */
export async function readSpecFileFromDisk(specFile: string): Promise<string> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  return readFile(resolve(repoRoot, specFile), 'utf8');
}

/** The narrow GitHub surface this project uses. Six calls, no more. */
export interface GitHubApi {
  getRef(input: {
    readonly owner: string;
    readonly repo: string;
    /** e.g. 'heads/main' */
    readonly ref: string;
  }): Promise<{ readonly sha: string }>;

  getCommit(input: {
    readonly owner: string;
    readonly repo: string;
    readonly commitSha: string;
  }): Promise<{ readonly treeSha: string }>;

  createTree(input: {
    readonly owner: string;
    readonly repo: string;
    readonly baseTreeSha: string;
    /** Repository-relative, forward slashes. */
    readonly path: string;
    readonly content: string;
  }): Promise<{ readonly sha: string }>;

  createCommit(input: {
    readonly owner: string;
    readonly repo: string;
    readonly message: string;
    readonly treeSha: string;
    readonly parentSha: string;
  }): Promise<{ readonly sha: string }>;

  createRef(input: {
    readonly owner: string;
    readonly repo: string;
    /** e.g. 'refs/heads/mend/heal/login-submit-0f9c1a2b' */
    readonly ref: string;
    readonly sha: string;
  }): Promise<void>;

  createPullRequest(input: {
    readonly owner: string;
    readonly repo: string;
    readonly title: string;
    readonly body: string;
    /** Branch name only: no 'refs/heads/' prefix, no 'owner:' prefix. */
    readonly head: string;
    readonly base: string;
  }): Promise<{ readonly url: string; readonly number: number }>;
}

/**
 * The only function in the repository that imports @octokit/rest.
 */
export function createOctokitApi(config: GitHubConfig): GitHubApi {
  const octokit = new Octokit({ auth: config.token });

  return {
    async getRef({ owner, repo, ref }) {
      const res = await octokit.rest.git.getRef({ owner, repo, ref });
      return { sha: res.data.object.sha };
    },

    async getCommit({ owner, repo, commitSha }) {
      const res = await octokit.rest.git.getCommit({ owner, repo, commit_sha: commitSha });
      return { treeSha: res.data.tree.sha };
    },

    async createTree({ owner, repo, baseTreeSha, path, content }) {
      const res = await octokit.rest.git.createTree({
        owner,
        repo,
        base_tree: baseTreeSha,
        tree: [{ path, mode: '100644', type: 'blob' as const, content }],
      });
      return { sha: res.data.sha };
    },

    async createCommit({ owner, repo, message, treeSha, parentSha }) {
      const res = await octokit.rest.git.createCommit({
        owner,
        repo,
        message,
        tree: treeSha,
        parents: [parentSha],
      });
      return { sha: res.data.sha };
    },

    async createRef({ owner, repo, ref, sha }) {
      await octokit.rest.git.createRef({ owner, repo, ref, sha });
    },

    async createPullRequest({ owner, repo, title, body, head, base }) {
      const res = await octokit.rest.pulls.create({
        owner,
        repo,
        title,
        body,
        head,
        base,
      });
      return { url: res.data.html_url, number: res.data.number };
    },
  };
}

/**
 * Replace occurrences of token with asterisks.
 */
function redactToken(text: string, token: string): string {
  return token.length === 0 ? text : text.split(token).join('***');
}

/**
 * Extract message from error object.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type PullRequestFailureCode =
  | 'not-pr-eligible'
  | 'spec-unreadable'
  | PatchFailureCode
  | 'github-api-error';

export interface PullRequestRequest {
  readonly attemptId: string;
  readonly assessment: HealAssessment;
}

export type PullRequestOutcome =
  | {
      readonly ok: true;
      readonly prUrl: string;
      readonly prNumber: number;
      readonly branch: string;
      readonly headSha: string;
    }
  | {
      readonly ok: false;
      readonly code: PullRequestFailureCode;
      /** Token-redacted. Safe to log and to store in failure_reason. */
      readonly message: string;
    };

/** Never throws. Always resolves with an outcome. */
export type PullRequestOpener = (
  request: PullRequestRequest,
) => Promise<PullRequestOutcome>;

export interface PullRequestOpenerDeps {
  readonly config: GitHubConfig;
  readonly api: GitHubApi;
  readonly readSpecFile: (specFile: string) => Promise<string>;
  readonly logger?: (line: string) => void;
}

/**
 * Create a pull request opener that never throws and always resolves with an outcome.
 */
export function createPullRequestOpener(deps: PullRequestOpenerDeps): PullRequestOpener {
  return async (request): Promise<PullRequestOutcome> => {
    // 1. Gate check
    try {
      assertPrEligible(request.assessment);
    } catch (error) {
      return {
        ok: false,
        code: 'not-pr-eligible',
        message: messageOf(error),
      };
    }

    // 2. Read spec file
    let originalSource: string;
    try {
      originalSource = await deps.readSpecFile(request.assessment.result.specFile);
    } catch (error) {
      return {
        ok: false,
        code: 'spec-unreadable',
        message: messageOf(error),
      };
    }

    // 3. Build patch
    const patch = buildPatch(request.assessment, originalSource);
    if (!patch.ok) {
      return {
        ok: false,
        code: patch.code,
        message: patch.message,
      };
    }

    // 4. Build branch name
    const branch = buildBranchName(
      request.assessment.result.specFile,
      request.attemptId,
    );

    // 5. GitHub API calls
    try {
      const { owner, repo, baseBranch } = deps.config;

      // Get base branch ref
      const base = await deps.api.getRef({
        owner,
        repo,
        ref: `heads/${baseBranch}`,
      });

      // Get base commit to find tree
      const baseCommit = await deps.api.getCommit({
        owner,
        repo,
        commitSha: base.sha,
      });

      // Create tree with patched spec
      const tree = await deps.api.createTree({
        owner,
        repo,
        baseTreeSha: baseCommit.treeSha,
        path: request.assessment.result.specFile,
        content: patch.proposedSource,
      });

      // Create commit
      const commit = await deps.api.createCommit({
        owner,
        repo,
        message: buildCommitMessage(request.assessment),
        treeSha: tree.sha,
        parentSha: base.sha,
      });

      // Create ref (branch)
      await deps.api.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
      });

      // Create PR
      const pr = await deps.api.createPullRequest({
        owner,
        repo,
        title: buildPrTitle(request.assessment),
        body: buildPrBody({
          assessment: request.assessment,
          diff: patch.diff,
          changedLines: patch.changedLines,
          branch,
          baseBranch,
        }),
        head: branch,
        base: baseBranch,
      });

      deps.logger?.(`[pr] created ${pr.url}`);

      return {
        ok: true,
        prUrl: pr.url,
        prNumber: pr.number,
        branch,
        headSha: commit.sha,
      };
    } catch (error) {
      return {
        ok: false,
        code: 'github-api-error',
        message: redactToken(messageOf(error), deps.config.token),
      };
    }
  };
}
