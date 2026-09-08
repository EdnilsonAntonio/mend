import { test, expect } from '@playwright/test';
import type { HealResult } from '../../agent/loop/types.js';
import {
  assessHealResult,
  type HealAssessment,
  type VerifiedFixMeasurement,
} from '../../agent/loop/confidence.js';
import {
  createPullRequestOpener,
  resolveGitHubConfig,
  type GitHubApi,
  type GitHubConfig,
} from '../github-pr.js';
import { buildBranchName } from '../pr-content.js';

// Helper to build a HealResult
function createHealResult(overrides: Partial<HealResult> = {}): HealResult {
  return {
    originalSelector: '#login-btn',
    proposedSelector: '#signin-button',
    specFile: 'tests/login-submit.spec.ts',
    testName: 'submits the login form',
    verified: true,
    verification: {
      candidateSelector: '#signin-button',
      executed: true,
      passed: true,
      rejected: null,
      changedLines: [{ lineNumber: 5, before: "  await page.click('#login-btn');", after: "  await page.click('#signin-button');" }],
      durationMs: 1234,
      output: 'Test passed',
    },
    outcome: 'healed',
    stopReason: 'verified-fix',
    toolCallCount: 1,
    capReached: false,
    modelTurnCount: 1,
    model: 'gpt-4',
    startedAt: '2024-01-01T00:00:00Z',
    durationMs: 5000,
    errorMessage: null,
    transcript: {
      bootstrapSnapshot: null,
      bootstrapSpecSource: 'source',
      messages: [],
      toolCalls: [
        {
          index: 1,
          toolCallId: 'call1',
          tool: 'get_dom_snapshot',
          rawArguments: '{}',
          arguments: { specFile: 'tests/login-submit.spec.ts' },
          ok: true,
          result: { kind: 'dom-snapshot', url: 'http://localhost', html: '<body></body>', estimatedTokens: 100, elementCount: 0, truncated: false },
          resultSummary: 'found button',
          startedAt: '2024-01-01T00:00:00Z',
          durationMs: 100,
        },
      ],
      modelRequests: [
        { turn: 1, finishReason: 'tool_calls', usage: null, contentPreview: '', requestedTools: [] },
      ],
    },
    ...overrides,
  };
}

// Helper to build a high-confidence HealAssessment
function createHighAssessment(overrides: Partial<HealResult> = {}): HealAssessment {
  const result = createHealResult(overrides);
  const measurement: VerifiedFixMeasurement = {
    selector: result.proposedSelector!,
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: '2024-01-01T00:00:00Z',
    durationMs: 100,
  };
  return assessHealResult(result, measurement);
}

// Helper to create a low-confidence assessment
function createLowAssessment(): HealAssessment {
  const result = createHealResult({ toolCallCount: 5 }); // Exceeds the cap
  const measurement: VerifiedFixMeasurement = {
    selector: result.proposedSelector!,
    matchCount: 1,
    measured: true,
    error: null,
    measuredAt: '2024-01-01T00:00:00Z',
    durationMs: 100,
  };
  return assessHealResult(result, measurement);
}

// Helper to create a none-confidence assessment (verified must be false for none confidence)
function createNoneAssessment(): HealAssessment {
  const result = createHealResult({
    proposedSelector: null,
    verified: false,
    verification: null,
  });
  return assessHealResult(result, null);
}

// Fake GitHub API that records calls
interface FakeApiCall {
  method: string;
  args: unknown;
}

function fakeGitHubApi(overrides?: { [key: string]: (args: unknown) => unknown }): {
  api: GitHubApi;
  calls: FakeApiCall[];
} {
  const calls: FakeApiCall[] = [];

  const api: GitHubApi = {
    async getRef(args) {
      calls.push({ method: 'getRef', args });
      if (overrides?.getRef) {
        const result = overrides.getRef(args);
        if (result instanceof Error) throw result;
        return result as { readonly sha: string };
      }
      return { sha: 'basesha123' };
    },

    async getCommit(args) {
      calls.push({ method: 'getCommit', args });
      if (overrides?.getCommit) {
        const result = overrides.getCommit(args);
        if (result instanceof Error) throw result;
        return result as { readonly treeSha: string };
      }
      return { treeSha: 'treesha456' };
    },

    async createTree(args) {
      calls.push({ method: 'createTree', args });
      if (overrides?.createTree) {
        const result = overrides.createTree(args);
        if (result instanceof Error) throw result;
        return result as { readonly sha: string };
      }
      return { sha: 'newtreesha789' };
    },

    async createCommit(args) {
      calls.push({ method: 'createCommit', args });
      if (overrides?.createCommit) {
        const result = overrides.createCommit(args);
        if (result instanceof Error) throw result;
        return result as { readonly sha: string };
      }
      return { sha: 'commitsha000' };
    },

    async createRef(args) {
      calls.push({ method: 'createRef', args });
      if (overrides?.createRef) {
        const result = overrides.createRef(args);
        if (result instanceof Error) throw result;
      }
    },

    async createPullRequest(args) {
      calls.push({ method: 'createPullRequest', args });
      if (overrides?.createPullRequest) {
        const result = overrides.createPullRequest(args);
        if (result instanceof Error) throw result;
        return result as { readonly url: string; readonly number: number };
      }
      return { url: 'https://github.com/o/r/pull/7', number: 7 };
    },
  };

  return { api, calls };
}

const ORIGINAL_SPEC = "test('x', () => { page.click('#login-btn'); });";

test('resolveGitHubConfig should return null when GITHUB_TOKEN is empty', async () => {
  expect(resolveGitHubConfig({})).toBeNull();
  expect(resolveGitHubConfig({ GITHUB_TOKEN: '  ' })).toBeNull();
});

test('resolveGitHubConfig should throw when GITHUB_TOKEN is set but GITHUB_REPOSITORY is not', async () => {
  expect(() => {
    resolveGitHubConfig({ GITHUB_TOKEN: 't' });
  }).toThrow(/GITHUB_REPOSITORY/);
});

test('resolveGitHubConfig should throw on malformed GITHUB_REPOSITORY', async () => {
  expect(() => {
    resolveGitHubConfig({ GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'not-a-repo' });
  }).toThrow(/must be "owner\/repo"/);
});

test('resolveGitHubConfig should parse valid config', async () => {
  const config = resolveGitHubConfig({
    GITHUB_TOKEN: 't',
    GITHUB_REPOSITORY: 'o/r',
  });
  expect(config).toEqual({
    token: 't',
    owner: 'o',
    repo: 'r',
    baseBranch: 'main',
  });
});

test('resolveGitHubConfig should respect GITHUB_BASE_BRANCH', async () => {
  const config = resolveGitHubConfig({
    GITHUB_TOKEN: 't',
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_BASE_BRANCH: 'develop',
  });
  expect(config?.baseBranch).toBe('develop');
});

test('happy path: opener makes six API calls in order and returns success', async () => {
  const { api, calls } = fakeGitHubApi();
  const config: GitHubConfig = {
    token: 'token',
    owner: 'o',
    repo: 'r',
    baseBranch: 'main',
  };

  const opener = createPullRequestOpener({
    config,
    api,
    readSpecFile: async () => ORIGINAL_SPEC,
  });

  const assessment = createHighAssessment();
  const outcome = await opener({
    attemptId: '00000000-0000-0000-0000-000000000000',
    assessment,
  });

  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.prUrl).toBe('https://github.com/o/r/pull/7');
    expect(outcome.prNumber).toBe(7);
  }

  // Check call order
  expect(calls).toHaveLength(6);
  expect(calls[0]?.method).toBe('getRef');
  expect(calls[1]?.method).toBe('getCommit');
  expect(calls[2]?.method).toBe('createTree');
  expect(calls[3]?.method).toBe('createCommit');
  expect(calls[4]?.method).toBe('createRef');
  expect(calls[5]?.method).toBe('createPullRequest');
});

test('createTree receives the proposed source with new selector', async () => {
  const { api, calls } = fakeGitHubApi();
  const config: GitHubConfig = {
    token: 'token',
    owner: 'o',
    repo: 'r',
    baseBranch: 'main',
  };

  const opener = createPullRequestOpener({
    config,
    api,
    readSpecFile: async () => ORIGINAL_SPEC,
  });

  const assessment = createHighAssessment();
  await opener({
    attemptId: '00000000-0000-0000-0000-000000000000',
    assessment,
  });

  const createTreeCall = calls.find((c) => c.method === 'createTree');
  expect(createTreeCall).toBeDefined();
  if (createTreeCall?.args) {
    const args = createTreeCall.args as Record<string, unknown>;
    expect(args.path).toBe('tests/login-submit.spec.ts');
    const content = args.content as string;
    expect(content).toContain('#signin-button');
    expect(content).not.toContain('#login-btn');
  }
});

test('createRef uses correct branch name', async () => {
  const { api, calls } = fakeGitHubApi();
  const config: GitHubConfig = {
    token: 'token',
    owner: 'o',
    repo: 'r',
    baseBranch: 'main',
  };

  const opener = createPullRequestOpener({
    config,
    api,
    readSpecFile: async () => ORIGINAL_SPEC,
  });

  const assessment = createHighAssessment();
  const attemptId = '0f9c1a2b-3d4e-5f60-7a8b-9c0d1e2f3a4b';
  await opener({ attemptId, assessment });

  const createRefCall = calls.find((c) => c.method === 'createRef');
  expect(createRefCall).toBeDefined();
  if (createRefCall) {
    const args = createRefCall.args as Record<string, unknown>;
    const expectedBranch = buildBranchName(assessment.result.specFile, attemptId);
    expect(args.ref).toBe(`refs/heads/${expectedBranch}`);
  }
});

test('createPullRequest uses branch name without refs/heads prefix', async () => {
  const { api, calls } = fakeGitHubApi();
  const config: GitHubConfig = {
    token: 'token',
    owner: 'o',
    repo: 'r',
    baseBranch: 'main',
  };

  const opener = createPullRequestOpener({
    config,
    api,
    readSpecFile: async () => ORIGINAL_SPEC,
  });

  const assessment = createHighAssessment();
  const attemptId = '0f9c1a2b-3d4e-5f60-7a8b-9c0d1e2f3a4b';
  await opener({ attemptId, assessment });

  const createPrCall = calls.find((c) => c.method === 'createPullRequest');
  expect(createPrCall).toBeDefined();
  if (createPrCall) {
    const args = createPrCall.args as Record<string, unknown>;
    expect(args.base).toBe('main');
    const expectedBranch = buildBranchName(assessment.result.specFile, attemptId);
    expect(args.head).toBe(expectedBranch);
  }
});

test('low-confidence assessment returns not-pr-eligible and makes zero API calls', async () => {
  const { api, calls } = fakeGitHubApi();
  const config: GitHubConfig = {
    token: 'token',
    owner: 'o',
    repo: 'r',
    baseBranch: 'main',
  };

  const opener = createPullRequestOpener({
    config,
    api,
    readSpecFile: async () => ORIGINAL_SPEC,
  });

  const assessment = createLowAssessment();
  const outcome = await opener({
    attemptId: '00000000-0000-0000-0000-000000000000',
    assessment,
  });

  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    expect(outcome.code).toBe('not-pr-eligible');
  }
  expect(calls).toHaveLength(0);
});

test('none-confidence assessment returns not-pr-eligible and makes zero API calls', async () => {
  const { api, calls } = fakeGitHubApi();
  const config: GitHubConfig = {
    token: 'token',
    owner: 'o',
    repo: 'r',
    baseBranch: 'main',
  };

  const opener = createPullRequestOpener({
    config,
    api,
    readSpecFile: async () => ORIGINAL_SPEC,
  });

  const assessment = createNoneAssessment();
  const outcome = await opener({
    attemptId: '00000000-0000-0000-0000-000000000000',
    assessment,
  });

  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    expect(outcome.code).toBe('not-pr-eligible');
  }
  expect(calls).toHaveLength(0);
});

test('spec-unreadable returns correct outcome with zero API calls', async () => {
  const { api, calls } = fakeGitHubApi();
  const config: GitHubConfig = {
    token: 'token',
    owner: 'o',
    repo: 'r',
    baseBranch: 'main',
  };

  const opener = createPullRequestOpener({
    config,
    api,
    readSpecFile: async () => {
      throw new Error('file not found');
    },
  });

  const assessment = createHighAssessment();
  const outcome = await opener({
    attemptId: '00000000-0000-0000-0000-000000000000',
    assessment,
  });

  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    expect(outcome.code).toBe('spec-unreadable');
  }
  expect(calls).toHaveLength(0);
});

test('substitution-failed returns correct outcome with zero API calls', async () => {
  const { api, calls } = fakeGitHubApi();
  const config: GitHubConfig = {
    token: 'token',
    owner: 'o',
    repo: 'r',
    baseBranch: 'main',
  };

  // Spec that doesn't contain the original selector
  const badSpec = "test('x', () => { page.click('#not-there'); });";

  const opener = createPullRequestOpener({
    config,
    api,
    readSpecFile: async () => badSpec,
  });

  const assessment = createHighAssessment();
  const outcome = await opener({
    attemptId: '00000000-0000-0000-0000-000000000000',
    assessment,
  });

  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    expect(outcome.code).toBe('substitution-failed');
  }
  expect(calls).toHaveLength(0);
});

test('API error returns github-api-error and resolves (never throws)', async () => {
  const { api, calls } = fakeGitHubApi({
    createRef: () => {
      throw new Error('api error');
    },
  });
  const config: GitHubConfig = {
    token: 'token',
    owner: 'o',
    repo: 'r',
    baseBranch: 'main',
  };

  const opener = createPullRequestOpener({
    config,
    api,
    readSpecFile: async () => ORIGINAL_SPEC,
  });

  const assessment = createHighAssessment();
  const outcome = await opener({
    attemptId: '00000000-0000-0000-0000-000000000000',
    assessment,
  });

  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    expect(outcome.code).toBe('github-api-error');
  }

  // Should have called up to createRef, not createPullRequest
  expect(calls.some((c) => c.method === 'createPullRequest')).toBe(false);
});

test('token is redacted in error messages', async () => {
  const { api } = fakeGitHubApi({
    getRef: () => {
      throw new Error('bad credentials for ghp_SECRETTOKEN');
    },
  });
  const config: GitHubConfig = {
    token: 'ghp_SECRETTOKEN',
    owner: 'o',
    repo: 'r',
    baseBranch: 'main',
  };

  const opener = createPullRequestOpener({
    config,
    api,
    readSpecFile: async () => ORIGINAL_SPEC,
  });

  const assessment = createHighAssessment();
  const outcome = await opener({
    attemptId: '00000000-0000-0000-0000-000000000000',
    assessment,
  });

  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    expect(outcome.message).not.toContain('ghp_SECRETTOKEN');
    expect(outcome.message).toContain('***');
  }
});

test('API error means only one attempt is made (no retry)', async () => {
  let callCount = 0;
  const { api, calls: apiCalls } = fakeGitHubApi({
    createRef: () => {
      callCount++;
      throw new Error('api error');
    },
  });
  const config: GitHubConfig = {
    token: 'token',
    owner: 'o',
    repo: 'r',
    baseBranch: 'main',
  };

  const opener = createPullRequestOpener({
    config,
    api,
    readSpecFile: async () => ORIGINAL_SPEC,
  });

  const assessment = createHighAssessment();
  await opener({
    attemptId: '00000000-0000-0000-0000-000000000000',
    assessment,
  });

  const createRefCalls = apiCalls.filter((c) => c.method === 'createRef');
  expect(createRefCalls).toHaveLength(1);
});
