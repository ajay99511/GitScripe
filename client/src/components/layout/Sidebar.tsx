import { NavLink } from 'react-router-dom';
import { useRepos } from '../../hooks/useRepos';
import { StatusBadge } from '../repos/StatusBadge';

export function Sidebar() {
  const { data } = useRepos();
  const repos = data?.repos ?? [];

  return (
    <nav className="flex flex-col h-full bg-[#161b22] border-r border-[#30363d]">
      {/* Wordmark */}
      <div className="px-4 py-4 border-b border-[#30363d]">
        <span className="text-[#e6edf3] font-bold text-lg">GitScripe</span>
      </div>

      {/* Discover link */}
      <div className="px-2 py-2">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center px-3 py-2 rounded text-sm min-h-[44px] transition-colors ${
              isActive
                ? 'bg-[#1f3a5f] text-[#58a6ff] border-l-2 border-[#58a6ff]'
                : 'text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d]'
            }`
          }
        >
          Discover
        </NavLink>
      </div>

      {/* Registered repos */}
      {repos.length > 0 && (
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <p className="px-3 py-1 text-xs text-[#8b949e] uppercase tracking-wider">Repositories</p>
          <ul>
            {repos.map((repo) => (
              <li key={repo.id}>
                <NavLink
                  to={`/repos/${repo.id}`}
                  className={({ isActive }) =>
                    `flex items-center justify-between px-3 py-2 rounded text-sm min-h-[44px] transition-colors ${
                      isActive
                        ? 'bg-[#1f3a5f] text-[#e6edf3] border-l-2 border-[#58a6ff]'
                        : 'text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d]'
                    }`
                  }
                >
                  <span className="truncate">{repo.owner}/{repo.name}</span>
                  <StatusBadge status={repo.status} />
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
