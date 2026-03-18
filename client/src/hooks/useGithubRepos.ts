import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useGithubRepos() {
  return useQuery({
    queryKey: ['github-repos'],
    queryFn: () => api.github.listRepos(),
    staleTime: 30_000,
  });
}

export function useRegisterRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fullName, branch }: { fullName: string; branch?: string }) =>
      api.github.register(fullName, branch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['github-repos'] });
      qc.invalidateQueries({ queryKey: ['repos'] });
    },
  });
}
