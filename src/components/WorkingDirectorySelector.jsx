import { useState } from 'react'
import { Folder, FolderOpen, X, ExternalLink } from 'lucide-react'
import { Button } from './ui/button'
import { useConversation } from '@/contexts/ConversationContext'
import { isElectron } from '@/lib/electron'
import path from 'path-browserify'

export function WorkingDirectorySelector({ conversationId, className = '' }) {
  const { getWorkingDirectory, updateWorkingDirectory, unlinkWorkingDirectory } = useConversation()
  const [isChanging, setIsChanging] = useState(false)

  // Only show in Electron mode
  if (!isElectron()) {
    return null
  }

  const workingDir = getWorkingDirectory(conversationId)

  // Don't render if no working directory info
  if (!workingDir) {
    return null
  }

  const handleLinkFolder = async () => {
    setIsChanging(true)
    try {
      const result = await window.electronAPI.dialog.selectDirectory()
      if (result.success && !result.canceled && result.filePath) {
        await updateWorkingDirectory(conversationId, result.filePath, 'linked')
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
    } finally {
      setIsChanging(false)
    }
  }

  const handleUnlink = async () => {
    await unlinkWorkingDirectory(conversationId)
  }

  const handleRevealInExplorer = async () => {
    try {
      await window.electronAPI.shell.revealInFileExplorer(workingDir.path)
    } catch (error) {
      console.error('Failed to reveal in explorer:', error)
    }
  }

  const getDisplayPath = () => {
    // Show last folder name from the path
    const parts = workingDir.path.split(/[/\\]/)
    const folderName = parts[parts.length - 1] || parts[parts.length - 2] || 'workspace'

    if (workingDir.type === 'isolated') {
      return `${folderName} (Safe Workspace)`
    }

    // For linked folders, just show the folder name
    return folderName
  }

  return (
    <div className={`flex items-center gap-2 text-sm ${className}`}>
      <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />

      <button
        onClick={handleRevealInExplorer}
        className="font-mono hover:underline flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        title={workingDir.path}
      >
        {getDisplayPath()}
        <ExternalLink className="w-3 h-3" />
      </button>

      <Button
        variant="outline"
        size="sm"
        onClick={handleLinkFolder}
        disabled={isChanging}
        title={workingDir.type === 'isolated' ? 'Link to a project folder' : 'Change linked folder'}
      >
        <FolderOpen className="w-3 h-3 mr-1" />
        {workingDir.type === 'isolated' ? 'Link Folder' : 'Change'}
      </Button>

      {workingDir.type === 'linked' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleUnlink}
          title="Unlink - return to safe workspace"
        >
          <X className="w-3 h-3" />
        </Button>
      )}
    </div>
  )
}
