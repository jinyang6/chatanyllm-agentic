/**
 * Message Input Area Component
 * Handles message input with streaming state and workspace footer
 */

import { forwardRef, useRef, useImperativeHandle } from 'react'
import MessageInput from '@/components/MessageInput'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Folder, ExternalLink, MoreVertical, FolderOpen, X, Archive } from 'lucide-react'
import { isElectron } from '@/lib/electron'

export const MessageInputArea = forwardRef(function MessageInputArea({
  // Message handlers
  onSendMessage,
  onStopGeneration,

  // Streaming state
  isCurrentStreaming,
  isAnyOtherStreaming,
  isCompacting,

  // Workspace
  workspaceName,
  workspaceType,
  hasMessages,
  onOpenWorkspaceFolder,
  onChangeWorkspace,
  onUnlinkWorkspace,
  onTriggerCompaction
}, ref) {
  const messageInputRef = useRef(null)

  // Expose handleFileDrop method to parent
  useImperativeHandle(ref, () => ({
    handleFileDrop: (files) => {
      if (messageInputRef.current) {
        messageInputRef.current.handleFileDrop(files)
      }
    }
  }), [])
  // Determine input state based on streaming/compacting status
  const getInputState = () => {
    if (isCompacting) {
      return {
        disabled: true,
        isStreaming: false,
        disabledTooltip: 'Compacting conversation'
      }
    }

    if (isAnyOtherStreaming) {
      return {
        disabled: true,
        isStreaming: false,
        disabledTooltip: 'Another conversation is streaming'
      }
    }

    return {
      disabled: false,
      isStreaming: isCurrentStreaming,
      disabledTooltip: undefined
    }
  }

  const inputState = getInputState()

  return (
    <>
      {/* Message Input */}
      <MessageInput
        ref={messageInputRef}
        onSendMessage={onSendMessage}
        isStreaming={inputState.isStreaming}
        onStopGeneration={onStopGeneration}
        disabled={inputState.disabled}
        disabledTooltip={inputState.disabledTooltip}
      />

      {/* Workspace Footer - Only show in Electron with messages */}
      {isElectron() && hasMessages && (
        <div className="px-6 py-2 border-t border-border/50 bg-muted/10">
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenWorkspaceFolder}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors group"
              title="Click to open workspace folder in explorer"
            >
              <Folder className="w-3.5 h-3.5" />
              <span className="font-medium">Workspace:</span>
              <span className="group-hover:underline">{workspaceName}</span>
              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 -ml-1">
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={onOpenWorkspaceFolder}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in Explorer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onChangeWorkspace}>
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Change Folder
                </DropdownMenuItem>
                {workspaceType === 'linked' && (
                  <DropdownMenuItem onClick={onUnlinkWorkspace}>
                    <X className="h-4 w-4 mr-2" />
                    Return to Default Workspace
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onTriggerCompaction}>
                  <Archive className="h-4 w-4 mr-2" />
                  Summarize Old Messages
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </>
  )
})
