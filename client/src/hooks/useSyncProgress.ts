import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useSyncProgress(repoId: string | null) {
  return useQuery({
    queryKey: ['sync-progress', repoId],
    queryFn: () => api.repos.progress(repoId!),
    enabled: !!repoId,
    refetchInterval: (query) => {
      const status = query.state.data?.repo.status;
      return status === 'syncing' ? 3000 : false;
    },
  });
}
