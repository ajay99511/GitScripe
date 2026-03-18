import type { ChatMessage as ChatMessageType } from '../../store/appStore';
import { CitedCommitChip } from './CitedCommitChip';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex flex-col mb-3 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
          isUser
            ? 'bg-[#1f3a5f] text-[#e6edf3] ml-auto'
            : 'bg-[#21262d] text-[#e6edf3]'
        }`}
      >
        {message.content}
      </div>

      {!isUser && message.citedCommits && message.citedCommits.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 max-w-[80%]">
          {message.citedCommits.map((commit) => (
            <CitedCommitChip key={commit.sha} commit={commit} />
          ))}
        </div>
      )}
    </div>
  );
}
