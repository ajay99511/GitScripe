import { Octokit } from '@octokit/rest';
import pino from 'pino';
import type { CommitInfo } from '../models/types.js';

const logger = pino({ name: 'GitHubConnector' });

export interface AccessibleRepo {
  owner: string;
  name: string;
  fullName: string;       // "owner/name"
  defaultBranch: string;
  private: boolean;
  description: string | null;
  htmlUrl: string;
}

export interface RepoMetadata {
  defaultBranch: string;
  description: string | null;
  private: boolean;
  htmlUrl: string;
}

export class GitHubConnector {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Paginate all commits for a repo/branch, optionally since a given SHA.
   * Returns commits in chronological order (oldest first).
   * Checks rate limit before starting to avoid mid-sync failures.
   */
  async getCommits(
    owner: string,
    repo: string,
    branch: string,
    sinceSha?: string
  ): Promise<CommitInfo[]> {
    // Guard: check rate limit before paginating — a large sync can exhaust it mid-way
    const { remaining, reset } = await this.getRateLimit();
    if (remaining < 100) {
      const waitMs = reset.getTime() - Date.now();
      const waitMins = Math.ceil(waitMs / 60000);
      throw new Error(
        `GitHub rate limit too low to start sync: ${remaining} requests remaining. Resets in ~${waitMins} minute(s) at ${reset.toISOString()}.`
      );
    }

    logger.debug({ remaining, owner, repo }, 'Rate limit check passed');
    const commits: CommitInfo[] = [];
    let foundSince = !sinceSha; // if no sinceSha, include everything

    try {
      const iterator = this.octokit.paginate.iterator(
        this.octokit.rest.repos.listCommits,
        {
          owner,
          repo,
          sha: branch,
          per_page: 100,
        }
      );

      for await (const response of iterator) {
        for (const item of response.data) {
          // If we've hit the last-synced SHA, stop — we've caught up
          if (sinceSha && item.sha === sinceSha) {
            foundSince = true;
            break;
          }

          commits.push({
            sha: item.sha,
            repoId: '', // filled by caller
            authorName: item.commit.author?.name ?? 'Unknown',
            authorEmail: item.commit.author?.email ?? '',
            message: item.commit.message,
            committedAt: new Date(item.commit.author?.date ?? Date.now()),
            filesChanged: [], // populated later from diff
            additions: item.stats?.additions ?? 0,
            deletions: item.stats?.deletions ?? 0,
          });
        }

        if (foundSince) break;
      }
    } catch (error) {
      logger.error({ error, owner, repo, branch }, 'Failed to fetch commits');
      throw error;
    }

    // Return oldest first for chronological processing
    return commits.reverse();
  }

  /**
   * Fetch the raw diff text for a single commit.
   */
  async getDiff(owner: string, repo: string, sha: string): Promise<string> {
    try {
      const response = await this.octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: sha,
        mediaType: { format: 'diff' },
      });

      // When requesting diff format, the response data is a string
      return response.data as unknown as string;
    } catch (error) {
      logger.error({ error, owner, repo, sha }, 'Failed to fetch diff');
      throw error;
    }
  }

  /**
   * Get current rate limit status.
   */
  async getRateLimit(): Promise<{ remaining: number; reset: Date }> {
    const { data } = await this.octokit.rest.rateLimit.get();
    return {
      remaining: data.rate.remaining,
      reset: new Date(data.rate.reset * 1000),
    };
  }

  /**
   * List all repositories accessible to the authenticated token.
   * Checks rate limit first — throws if fewer than 10 requests remain.
   * Paginates through all results and returns a flat array.
   */
  async listAccessibleRepos(): Promise<AccessibleRepo[]> {
    const { remaining, reset } = await this.getRateLimit();
    if (remaining < 10) {
      throw new Error(
        `GitHub rate limit too low: ${remaining} remaining, resets at ${reset.toISOString()}`
      );
    }

    const repos: AccessibleRepo[] = [];

    const iterator = this.octokit.paginate.iterator(
      this.octokit.rest.repos.listForAuthenticatedUser,
      {
        per_page: 100,
        affiliation: 'owner,collaborator,organization_member',
      }
    );

    for await (const response of iterator) {
      for (const item of response.data) {
        repos.push({
          owner: item.owner?.login ?? '',
          name: item.name,
          fullName: item.full_name,
          defaultBranch: item.default_branch,
          private: item.private,
          description: item.description ?? null,
          htmlUrl: item.html_url,
        });
      }
    }

    return repos;
  }

  /**
   * Fetch metadata for a single repository.
   * Throws a descriptive error if the repo is not found (404).
   */
  async getRepoMetadata(owner: string, repo: string): Promise<RepoMetadata> {
    try {
      const { data } = await this.octokit.rest.repos.get({ owner, repo });
      return {
        defaultBranch: data.default_branch,
        description: data.description ?? null,
        private: data.private,
        htmlUrl: data.html_url,
      };
    } catch (error: unknown) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        throw new Error(`Repository ${owner}/${repo} not found or not accessible`);
      }
      throw error;
    }
  }

  /**
   * Get list of files changed in a commit (with their stats).
   */
  async getCommitFiles(
    owner: string,
    repo: string,
    sha: string
  ): Promise<{ filename: string; additions: number; deletions: number }[]> {
    const { data } = await this.octokit.rest.repos.getCommit({
      owner,
      repo,
      ref: sha,
    });

    return (data.files ?? []).map((f) => ({
      filename: f.filename ?? '',
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
    }));
  }
}
