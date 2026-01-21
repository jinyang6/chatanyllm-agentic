/**
 * Custom hook for managing workspace operations
 * Handles working directory changes, folder operations, and compaction
 */

import { useState, useCallback } from 'react'
import { useConversation } from '@/contexts/ConversationContext'
import { isElectron } from '@/lib/electron'
import { compactConversation } from '@/utils/compaction'
import { COMPACTION_CONFIG, WORKSPACE_CONFIG, PATHS } from '@/config/constants'

/**
 * Hook for workspace management operations
 * @param {string} conversationId - Current conversation ID
 * @param {Function} summarizeFn - Optional function to summarize messages (required for compaction)
 * @returns {Object} Workspace operations and state
 */
export function useWorkspaceManagement(conversationId, summarizeFn = null) {
  const {
    getWorkingDirectory,
    updateWorkingDirectory,
    replaceMessages,
    messages
  } = useConversation()

  const [isCompacting, setIsCompacting] = useState(false)

  /**
   * Get the display name for the current workspace
   */
  const getWorkspaceName = useCallback(() => {
    const workingDir = getWorkingDirectory(conversationId)
    if (!workingDir) return WORKSPACE_CONFIG.SAFE_WORKSPACE_NAME

    if (workingDir.type === WORKSPACE_CONFIG.TYPE_ISOLATED) {
      return WORKSPACE_CONFIG.SAFE_WORKSPACE_NAME
    }

    // For linked folders, extract folder name
    const parts = workingDir.path.split(/[/\\]/)
    return parts[parts.length - 1] || parts[parts.length - 2] || WORKSPACE_CONFIG.DEFAULT_PROJECT_NAME
  }, [conversationId, getWorkingDirectory])

  /**
   * Open workspace folder in file explorer
   */
  const openWorkspaceFolder = useCallback(async () => {
    if (!isElectron()) return

    const workingDir = getWorkingDirectory(conversationId)
    if (workingDir?.path) {
      try {
        await window.electronAPI.shell.revealInFileExplorer(workingDir.path)
      } catch (error) {
        console.error('Failed to open folder:', error)
      }
    }
  }, [conversationId, getWorkingDirectory])

  /**
   * Change workspace folder
   */
  const changeWorkspace = useCallback(async () => {
    if (!isElectron()) return

    try {
      const result = await window.electronAPI.dialog.selectDirectory()
      if (result.success && !result.canceled && result.filePath) {
        await updateWorkingDirectory(conversationId, result.filePath, 'linked')
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
    }
  }, [conversationId, updateWorkingDirectory])

  /**
   * Unlink workspace (return to safe workspace)
   */
  const unlinkWorkspace = useCallback(async () => {
    if (!isElectron()) return

    try {
      const appDataPath = await window.electronAPI.getAppDataPath()
      const isolatedPath = `${appDataPath}\\userfiles\\workspaces\\${conversationId}`
      await updateWorkingDirectory(conversationId, isolatedPath, 'isolated')
    } catch (error) {
      console.error('Failed to unlink workspace:', error)
    }
  }, [conversationId, updateWorkingDirectory])

  /**
   * Trigger compaction manually (user-initiated)
   */
  const triggerCompaction = useCallback(async () => {
    if (!summarizeFn) {
      console.error('Cannot compact: summarizeFn not provided')
      return
    }

    try {
      console.log('🔵 Manually triggering client-side compaction...')

      // Check if there are enough messages to compact
      if (messages.length < COMPACTION_CONFIG.MIN_MESSAGES_FOR_COMPACTION) {
        console.log(`❌ Need at least ${COMPACTION_CONFIG.MIN_MESSAGES_FOR_COMPACTION} messages to compact`)
        return
      }

      setIsCompacting(true)

      // Force compaction - keep only last 2 messages to maximize compression
      const result = await compactConversation(messages, summarizeFn, {
        keepLast: COMPACTION_CONFIG.MANUAL_KEEP_LAST
      })

      if (result.compactedMessages) {
        console.log('🗜️ Manual compaction completed:', result.stats)
        await replaceMessages(result.compactedMessages)
      }

      setIsCompacting(false)
    } catch (error) {
      console.error('Failed to trigger compaction:', error)
      setIsCompacting(false)
    }
  }, [messages, replaceMessages, summarizeFn])

  /**
   * Get workspace type
   */
  const getWorkspaceType = useCallback(() => {
    const workingDir = getWorkingDirectory(conversationId)
    return workingDir?.type || 'isolated'
  }, [conversationId, getWorkingDirectory])

  /**
   * Get workspace path
   */
  const getWorkspacePath = useCallback(() => {
    const workingDir = getWorkingDirectory(conversationId)
    return workingDir?.path || null
  }, [conversationId, getWorkingDirectory])

  return {
    workspaceName: getWorkspaceName(),
    workspaceType: getWorkspaceType(),
    workspacePath: getWorkspacePath(),
    openWorkspaceFolder,
    changeWorkspace,
    unlinkWorkspace,
    triggerCompaction,
    isCompacting
  }
}
