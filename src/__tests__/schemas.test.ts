import { describe, it, expect } from 'vitest';
import {
  DiscoveredRepoSchema,
  RegisterDiscoveredRepoSchema,
} from '../models/schemas.js';

describe('DiscoveredRepoSchema', () => {
  it('parses a valid discovered repo', () => {
    const input = {
      owner: 'octocat',
      name: 'hello-world',
      fullName: 'octocat/hello-world',
      defaultBranch: 'main',
      private: false,
      description: 'A test repo',
      htmlUrl: 'https://github.com/octocat/hello-world',
      isRegistered: false,
    };
    const result = DiscoveredRepoSchema.parse(input);
    expect(result.fullName).toBe('octocat/hello-world');
    expect(result.isRegistered).toBe(false);
  });

  it('accepts null description', () => {
    const input = {
      owner: 'octocat',
      name: 'hello-world',
      fullName: 'octocat/hello-world',
      defaultBranch: 'main',
      private: true,
      description: null,
      htmlUrl: 'https://github.com/octocat/hello-world',
      isRegistered: true,
    };
    const result = DiscoveredRepoSchema.parse(input);
    expect(result.description).toBeNull();
    expect(result.isRegistered).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(() => DiscoveredRepoSchema.parse({ owner: 'octocat' })).toThrow();
  });
});

describe('RegisterDiscoveredRepoSchema', () => {
  it('parses valid owner/repo fullName', () => {
    const result = RegisterDiscoveredRepoSchema.parse({ fullName: 'octocat/hello-world' });
    expect(result.fullName).toBe('octocat/hello-world');
    expect(result.branch).toBeUndefined();
  });

  it('accepts optional branch override', () => {
    const result = RegisterDiscoveredRepoSchema.parse({
      fullName: 'octocat/hello-world',
      branch: 'develop',
    });
    expect(result.branch).toBe('develop');
  });

  it('rejects fullName without slash', () => {
    expect(() =>
      RegisterDiscoveredRepoSchema.parse({ fullName: 'noslash' })
    ).toThrow();
  });

  it('rejects fullName with spaces', () => {
    expect(() =>
      RegisterDiscoveredRepoSchema.parse({ fullName: 'owner/repo name' })
    ).toThrow();
  });

  it('rejects empty branch', () => {
    expect(() =>
      RegisterDiscoveredRepoSchema.parse({ fullName: 'owner/repo', branch: '' })
    ).toThrow();
  });
});
