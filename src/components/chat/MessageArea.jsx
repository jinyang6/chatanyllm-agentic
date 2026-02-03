/**
 * Message Area Component
 * Displays messages or empty state, plus compacting indicator
 */

import MessageList from '@/components/MessageList'
import { EmptyStatePrompt } from '@/components/EmptyStatePrompt'
import { Loader } from 'lucide-react'

export function MessageArea({
  // Message data
  messages,
  currentConversationId,

  // Message handlers
  onRetry,
  onEditUserMessage,
  onDeleteMessage,

  // State
  isStreaming,
  isCompacting,

  // OpenCode/Workspace
  getOpencodeActivity,
  getWorkingDirectory
}) {
  return (
    <>
      {/* Main content area - show empty state or messages */}
      {messages.length === 0 ? (
        <EmptyStatePrompt conversationId={currentConversationId} />
      ) : (
        <>
          <MessageList
            messages={messages}
            onRetry={onRetry}
            onEditUserMessage={onEditUserMessage}
            onDeleteMessage={onDeleteMessage}
            isStreaming={isStreaming}
            getOpencodeActivity={getOpencodeActivity}
            currentConversationId={currentConversationId}
            getWorkingDirectory={getWorkingDirectory}
          />

          {/* Compacting indicator */}
          {isCompacting && (
            <div className="flex items-center justify-center gap-3 py-6 text-muted-foreground">
              <div className="flex-1 h-px bg-border"></div>
              <div className="flex items-center gap-2">
                <Loader className="w-4 h-4 animate-spin" />
                <span className="text-sm">Compacting conversation</span>
              </div>
              <div className="flex-1 h-px bg-border"></div>
            </div>
          )}
        </>
      )}
    </>
  )
}
