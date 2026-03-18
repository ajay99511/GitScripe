import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAppStore } from '../store/appStore';

export function useChat(repoId: string | null) {
  const appendMessage = useAppStore((s) => s.appendMessage);

  return useMutation({
    mutationFn: (question: string) => {
      if (!repoId) throw new Error('No active repository');
      return api.chat.query(question, repoId);
    },
    onMutate: (question) => {
      if (repoId) {
        appendMessage(repoId, { role: 'user', content: question });
      }
    },
    onSuccess: (data) => {
      if (repoId) {
        appendMessage(repoId, {
          role: 'assistant',
          content: data.answer,
          citedCommits: data.citedCommits,
        });
      }
    },
  });
}
