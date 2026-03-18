import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DiscoveredRepo, RepositoryInfo } from '../../lib/api';
import { useRegisterRepo } from '../../hooks/useGithubRepos';
import { api } from '../../lib/api';

interface RepoRowProps {
  repo: DiscoveredRepo;
  registeredRepo?: RepositoryInfo;
  onSyncStarted?: (repoId: string) => void;
}

export function RepoRow({ repo, registeredRepo, onSyncStarted }: RepoRowProps) {
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const registerMutation = useRegisterRepo();

  const handleRegister = async () => {
    setError(null);
    try {
      await registerMutation.mutateAsync({ fullName: repo.fullName });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  const handleSync = async () => {
    if (!registeredRepo) return;
    setError(null);
    try {
      await api.repos.sync(registeredRepo.id);
      onSyncStarted?.(registeredRepo.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  const status = registeredRepo?.status;

  return (
    <li className="border-b border-[#30363d] last:border-0">
      <div className="flex items-center justify-between px-4 py-3 min-h-[44px] hover:bg-[#161b22] transition-colors">
        <div className="flex-1 min-w-0 mr-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[#e6edf3] font-medium text-sm">{repo.fullName}</span>
            <code className="text-[#8b949e] text-xs font-mono bg-[#21262d] px-1.5 py-0.5 rounded">
              {repo.defaultBranch}
            </code>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                repo.private
                  ? 'bg-[#3d2a1f] text-[#d29922]'
                  : 'bg-[#1f3a2a] text-[#3fb950]'
              }`}
            >
              {repo.private ? 'Private' : 'Public'}
            </span>
            {repo.isRegistered && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-[#1f3a5f] text-[#58a6ff]">
                Registered
              </span>
            )}
          </div>
          {repo.description && (
            <p className="text-[#8b949e] text-xs mt-1 truncate">{repo.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!repo.isRegistered && (
            <button
              onClick={handleRegister}
              disabled={registerMutation.isPending}
              className="px-3 py-1.5 text-sm bg-[#238636] hover:bg-[#2ea043] text-white rounded min-h-[44px] min-w-[44px] disabled:opacity-50 transition-colors"
            >
              {registerMutation.isPending ? 'Registering…' : 'Register'}
            </button>
          )}

          {repo.isRegistered && registeredRepo && (
            <>
              {status === 'idle' && (
                <>
                  <button
                    onClick={handleSync}
                    className="px-3 py-1.5 text-sm bg-[#1f3a5f] hover:bg-[#2d4f7c] text-[#58a6ff] rounded min-h-[44px] min-w-[44px] transition-colors"
                  >
                    Sync Now
                  </button>
                  <button
                    onClick={() => navigate(`/repos/${registeredRepo.id}`)}
                    className="px-3 py-1.5 text-sm bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] rounded min-h-[44px] min-w-[44px] transition-colors"
                  >
                    View
                  </button>
                </>
              )}
              {status === 'syncing' && (
                <button
                  disabled
                  className="px-3 py-1.5 text-sm bg-[#21262d] text-[#8b949e] rounded min-h-[44px] min-w-[44px] opacity-70 cursor-not-allowed flex items-center gap-1"
                >
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  Syncing…
                </button>
              )}
              {status === 'error' && (
                <button
                  onClick={handleSync}
                  className="px-3 py-1.5 text-sm bg-[#3d1f1f] hover:bg-[#5a2a2a] text-[#f85149] rounded min-h-[44px] min-w-[44px] transition-colors"
                >
                  Retry Sync
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="px-4 pb-2 text-xs text-[#f85149]">{error}</p>
      )}
    </li>
  );
}
