import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface SummaryParams {
  page?: number;
  limit?: number;
  riskLevel?: string;
  tag?: string;
}

export function useSummaries(repoId: string | null, params: SummaryParams = {}) {
  return useQuery({
    queryKey: ['summaries', repoId, params],
    queryFn: () => api.summaries.list(repoId!, params),
    enabled: !!repoId,
    // Keep polling while any summaries are still pending/processing
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasPending = data.summaries.some(
        (s) => s.status === 'pending' || s.status === 'processing'
      );
      return hasPending ? 3000 : false;
    },
  });
}
