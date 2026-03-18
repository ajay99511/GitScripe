import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '../../store/appStore';
import { useChat } from '../../hooks/useChat';
import { ChatMessage } from './ChatMessage';

interface ChatPanelProps {
  repoId: string;
  repoName: string;
}

export function ChatPanel({ repoId, repoName }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatHistory = useAppStore((s) => s.chatHistory[repoId] ?? []);
  const clearHistory = useAppStore((s) => s.clearHistory);
  const chatMutation = useChat(repoId);

  const handleSubmit = useCallback(async () => {
    const question = input.trim();
    if (!question || chatMutation.isPending) return;
    setInput('');
    await chatMutation.mutateAsync(question);
  }, [input, chatMutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory.length]);

  return (
    <div className="flex flex-col h-full bg-[#0f1117] border-l border-[#30363d]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363d] bg-[#161b22]">
        <span className="text-[#e6edf3] text-sm font-medium truncate">{repoName}</span>
        <button
          onClick={() => clearHistory(repoId)}
          className="text-xs text-[#8b949e] hover:text-[#e6edf3] px-2 py-1 min-h-[44px] min-w-[44px] transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Message history */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3"
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {chatHistory.length === 0 && (
          <p className="text-[#8b949e] text-sm text-center mt-8">
            Ask a question about {repoName}
          </p>
        )}
        {chatHistory.map((msg, i) => (
          <ChatMessage key={i} message={msg} />
        ))}

        {/* Typing indicator */}
        {chatMutation.isPending && (
          <div className="flex items-center gap-1 mb-3">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-2 h-2 bg-[#58a6ff] rounded-full animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="px-4 py-3 border-t border-[#30363d] bg-[#161b22]">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={chatMutation.isPending}
            placeholder="Ask about this repository… (Ctrl+Enter to send)"
            rows={2}
            className="flex-1 bg-[#21262d] border border-[#30363d] text-[#e6edf3] text-sm rounded px-3 py-2 resize-none focus:outline-none focus:border-[#58a6ff] disabled:opacity-50 placeholder-[#8b949e]"
          />
          <button
            onClick={handleSubmit}
            disabled={chatMutation.isPending || !input.trim()}
            className="px-4 py-2 bg-[#238636] hover:bg-[#2ea043] text-white text-sm rounded min-h-[44px] min-w-[44px] disabled:opacity-50 transition-colors self-end"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
