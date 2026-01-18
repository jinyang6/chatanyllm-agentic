import { MessageSquare, FolderOpen } from 'lucide-react'
import { Button } from './ui/button'
import { useConversation } from '@/contexts/ConversationContext'
import { isElectron } from '@/lib/electron'

export function EmptyStatePrompt({ conversationId }) {
  const { updateWorkingDirectory } = useConversation()

  const handleLinkFolder = async () => {
    if (!isElectron()) return

    try {
      const result = await window.electronAPI.dialog.selectDirectory()
      if (result.success && !result.canceled && result.filePath) {
        await updateWorkingDirectory(conversationId, result.filePath, 'linked')
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16">
      <MessageSquare className="w-16 h-16 text-muted-foreground mb-6" />

      <h2 className="text-2xl font-semibold mb-4">
        Start a conversation
      </h2>

      {isElectron() && (
        <>
          <p className="text-muted-foreground mb-8 max-w-lg text-base">
            Select a folder to work on your existing project, or just start chatting to use a default workspace
          </p>

          <Button
            variant="outline"
            size="lg"
            onClick={handleLinkFolder}
            className="gap-2"
          >
            <FolderOpen className="w-5 h-5" />
            Choose Project Folder
          </Button>
        </>
      )}
      {!isElectron() && (
        <p className="text-muted-foreground mb-6 max-w-md">
          Each conversation has its own isolated workspace for files.
        </p>
      )}
    </div>
  )
}
