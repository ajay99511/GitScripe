import { create } from 'zustand';
import type { ChatResponse } from '../lib/api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citedCommits?: ChatResponse['citedCommits'];
}

interface AppState {
  activeRepoId: string | null;
  setActiveRepoId: (id: string | null) => void;
  chatHistory: Record<string, ChatMessage[]>;
  appendMessage: (repoId: string, message: ChatMessage) => void;
  clearHistory: (repoId: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeRepoId: null,
  setActiveRepoId: (id) => set({ activeRepoId: id }),
  chatHistory: {},
  appendMessage: (repoId, message) =>
    set((state) => ({
      chatHistory: {
        ...state.chatHistory,
        [repoId]: [...(state.chatHistory[repoId] ?? []), message],
      },
    })),
  clearHistory: (repoId) =>
    set((state) => ({
      chatHistory: {
        ...state.chatHistory,
        [repoId]: [],
      },
    })),
}));
