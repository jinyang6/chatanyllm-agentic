import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { ChatHeader } from './chat/ChatHeader'
import { MessageArea } from './chat/MessageArea'
import { MessageInputArea } from './chat/MessageInputArea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { SearchableSelect } from './SearchableSelect'
import { PROVIDERS, getAllModels, getFallbackModels, getProviderById } from '@/config/providers'
import { useProvider } from '@/contexts/ProviderContext'
import { useConversation } from '@/contexts/ConversationContext'
import { useModelFetcher, ERROR_TYPES } from '@/hooks/useModelFetcher'
import { useError } from '@/contexts/ErrorContext'
import { useStreamingMessage } from '@/hooks/useStreamingMessage'
import { useWorkspaceManagement } from '@/hooks/useWorkspaceManagement'
import { useMessageOperations } from '@/hooks/useMessageOperations'
import { sendStreamingMessage } from '@/services/chat/chatClient'
import { RefreshCw as RefreshCwIcon, AlertTriangle as AlertTriangleIcon, WifiOff as WifiOffIcon, Key as KeyIcon, PanelLeftClose as ChevronsLeftIcon, PanelLeftOpen as ChevronsRightIcon, Bot, Folder, ExternalLink, MoreVertical, FolderOpen, X, Archive, Upload as UploadIcon } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { isThinkingModel, isImageGenerationModel, getModalitiesForModel } from '@/utils/modelHelpers'
import { autoCompact, compactConversation } from '@/utils/compaction'
import { isElectron } from '@/lib/electron'
import { Loader } from 'lucide-react'
import { COMPACTION_CONFIG } from '@/config/constants'

const ChatWindow = forwardRef(function ChatWindow({ conversationId, onOpenSettings, sidebarOpen, onToggleSidebar }, ref) {
  const messageInputRef = useRef(null)

  // Expose handleFileDrop to parent
  useImperativeHandle(ref, () => ({
    handleFileDrop: (files) => {
      if (messageInputRef.current) {
        messageInputRef.current.handleFileDrop(files)
      }
    }
  }), [])
  const {
    provider,
    setProvider,
    model,
    setModel,
    getModelsForProvider,
    modelsFetchStatus,
    apiKeys,
    customProviders,
    isLoading
  } = useProvider()

  const {
    isConversationStreaming,
    streamingConversationIds,
    currentConversationId,
    getCurrentConversation,
    getOpencodeActivity,
    getWorkingDirectory,
    replaceMessages
  } = useConversation()

  // Use custom hooks for cleaner code organization
  const { messages, deleteMessage } = useMessageOperations(currentConversationId)

  const { showMissingApiKeyAlert, showFetchErrorAlert, showInvalidApiKeyAlert } = useError()

  // Summarize messages using LLM - defined early so it can be passed to hooks
  const summarizeWithLLM = useCallback(async (summaryPrompt) => {
    return new Promise((resolve) => {
      // console.log('🔵 Calling LLM to summarize conversation...')
      let summary = ''

      // Get current provider API key
      const currentApiKey = apiKeys[provider]
      if (!currentApiKey) {
        console.error('No API key available for summarization')
        resolve('Earlier conversation (summary unavailable - no API key)')
        return
      }

      try {
        sendStreamingMessage({
          providerId: provider,
          apiKey: currentApiKey,
          model,
          messages: [{ role: 'user', content: summaryPrompt }],
          onChunk: (chunk, fullContent) => {
            summary = fullContent
          },
          onComplete: (fullContent) => {
            // console.log('✓ Summary generated:', fullContent?.substring(0, 100) + '...')
            resolve(fullContent || summary || 'Earlier conversation (summary unavailable)')
          },
          onError: (err) => {
            console.error('Summarization failed:', err)
            resolve('Earlier conversation (summary unavailable)')
          },
          abortSignal: null,
          conversationId: currentConversationId
        })
      } catch (error) {
        console.error('Failed to generate summary:', error)
        resolve('Earlier conversation (summary unavailable)')
      }
    })
  }, [apiKeys, provider, model, currentConversationId])

  // Check and perform auto-compaction after message completes
  const checkAndCompactConversation = useCallback(async () => {
    try {
      const result = await autoCompact(messages, summarizeWithLLM, {
        messageThreshold: COMPACTION_CONFIG.MESSAGE_THRESHOLD,
        tokenThreshold: COMPACTION_CONFIG.TOKEN_THRESHOLD,
        keepLast: COMPACTION_CONFIG.KEEP_LAST_MESSAGES
      })

      if (result.compacted) {
        // console.log('🗜️ Auto-compaction completed:', result.stats)
        // Replace messages with compacted version
        await replaceMessages(result.messages)
      }
    } catch (error) {
      console.error('Auto-compaction failed:', error)
    }
  }, [messages, summarizeWithLLM, replaceMessages])

  // Initialize workspace management hook with summarize function
  const {
    workspaceName,
    workspaceType,
    openWorkspaceFolder,
    changeWorkspace,
    unlinkWorkspace,
    triggerCompaction,
    isCompacting
  } = useWorkspaceManagement(currentConversationId, summarizeWithLLM)

  // Initialize streaming message hook
  const {
    sendMessage,
    retryMessage,
    editMessage,
    stopStreaming: stopCurrentStreaming,
    isStreaming: hookIsStreaming
  } = useStreamingMessage({
    conversationId: currentConversationId,
    onCompletionCheck: checkAndCompactConversation
  })

  // Listen for OpenCode compaction events and sync messages
  useEffect(() => {
    const handleCompaction = async (event) => {
      const { conversationId, messages: opencodeMessages } = event.detail

      // Only sync if this is the current conversation
      if (conversationId !== currentConversationId) return

      // console.log('🗜️ Syncing conversation with OpenCode compacted state')

      try {
        // Convert OpenCode messages to ChatAnyLLM format
        const syncedMessages = []

        for (const opencodeMsg of opencodeMessages) {
          // Check if any part is a compaction
          const compactionPart = opencodeMsg.parts.find(p => p.type === 'compaction')

          if (compactionPart) {
            // Add compaction as a special message
            syncedMessages.push({
              id: compactionPart.id,
              role: 'system',
              type: 'compaction',
              content: 'Earlier messages summarized',
              timestamp: new Date().toISOString(),
              compactedBy: 'opencode'
            })
          }

          // Add text parts as regular messages
          const textParts = opencodeMsg.parts.filter(p => p.type === 'text')
          if (textParts.length > 0 && opencodeMsg.info) {
            const content = textParts.map(p => p.text).join('\n')
            syncedMessages.push({
              id: opencodeMsg.info.id,
              role: opencodeMsg.info.role,
              content,
              timestamp: new Date(opencodeMsg.info.time.created).toISOString()
            })
          }
        }

        // Replace conversation messages with OpenCode's state
        await replaceMessages(syncedMessages)
        // console.log('✓ Conversation synced with OpenCode:', syncedMessages.length, 'messages')
      } catch (error) {
        console.error('Failed to sync compacted messages:', error)
      }
    }

    window.addEventListener('opencode:compacted', handleCompaction)
    return () => window.removeEventListener('opencode:compacted', handleCompaction)
  }, [currentConversationId, replaceMessages])

  // Update window title based on workspace
  useEffect(() => {
    if (!window.electronAPI?.window) return

    const workingDir = getWorkingDirectory(currentConversationId)
    if (!workingDir) {
      window.electronAPI.window.setTitle('ChatAnyLLM')
      return
    }

    if (workingDir.type === 'isolated') {
      window.electronAPI.window.setTitle('ChatAnyLLM - Default Workspace')
    } else {
      // Extract folder name from path for linked workspaces
      const parts = workingDir.path.split(/[/\\]/)
      const folderName = parts[parts.length - 1] || parts[parts.length - 2] || 'Project'
      window.electronAPI.window.setTitle(`ChatAnyLLM - ${folderName}`)
    }
  }, [currentConversationId, getWorkingDirectory])

  const { fetchModels } = useModelFetcher()

  // Combine built-in and custom providers
  const allProviders = [...PROVIDERS, ...customProviders]

  // Get provider info
  const providerInfo = getProviderById(provider) || customProviders.find(p => p.id === provider)
  const hasApiKey = Boolean(apiKeys[provider])
  const needsApiKey = providerInfo && providerInfo.supportsDynamicFetch !== false

  const fetchStatus = modelsFetchStatus[provider] || { loading: false, error: null, errorType: null }

  // Get models - conditionally based on error type
  const fetchedModels = getModelsForProvider(provider)
  const fallbackModels = getFallbackModels(provider)

  // Determine which models to show based on error type
  let currentModels = fetchedModels
  let usingFallback = false

  if (fetchedModels.length === 0) {
    // If no API key configured or invalid key, show empty array (no models)
    if (fetchStatus.errorType === ERROR_TYPES.NO_API_KEY ||
        fetchStatus.errorType === ERROR_TYPES.INVALID_KEY ||
        (needsApiKey && !hasApiKey)) {
      currentModels = []
    }
    // For network errors or other errors, show fallback models
    else if (fetchStatus.errorType === ERROR_TYPES.NETWORK_ERROR ||
             fetchStatus.errorType === ERROR_TYPES.OTHER_ERROR) {
      currentModels = fallbackModels
      usingFallback = true
    }
    // No error yet, use fallback as default
    else {
      currentModels = fallbackModels
    }
  }

  // Auto-fetch models when provider changes
  useEffect(() => {
    const autoFetchModels = async () => {
      // Wait for initial data to load before showing alerts
      if (isLoading) return

      // Check if provider needs API key
      if (needsApiKey && !hasApiKey) {
        // Show alert for missing API key
        showMissingApiKeyAlert(
          providerInfo.name,
          () => {
            if (onOpenSettings) {
              onOpenSettings()
            }
          }
        )
        return
      }

      // Don't auto-fetch if we already have models
      if (fetchedModels.length > 0) return

      try {
        await fetchModels(provider, false)
      } catch (error) {
        // Categorize error and show appropriate alert
        if (error.message.includes('API key not configured')) {
          showMissingApiKeyAlert(providerInfo.name, () => {
            if (onOpenSettings) onOpenSettings()
          })
        } else if (error.message.includes('401') || error.message.includes('Invalid API key')) {
          showInvalidApiKeyAlert(
            providerInfo.name,
            error.message,
            () => {
              if (onOpenSettings) onOpenSettings()
            }
          )
        } else {
          showFetchErrorAlert(
            providerInfo.name,
            error.message,
            () => handleRefreshModels()
          )
        }
      }
    }

    autoFetchModels()
  }, [provider, hasApiKey, isLoading]) // Run when provider, API key, or loading state changes

  // Get modalities for a model (wrapper for the utility function with currentModels)
  const getModalitiesForCurrentModel = (modelId, providerId = null) => {
    // Use provided providerId or fall back to current provider
    const targetProvider = providerId || provider
    const fetchedModels = getModelsForProvider(targetProvider)
    const fallbackModels = getFallbackModels(targetProvider)
    const models = fetchedModels.length > 0 ? fetchedModels : fallbackModels
    return getModalitiesForModel(modelId, models)
  }

  const isModelThinking = (modelId, providerId = null) => {
    // Use provided providerId or fall back to current provider
    const targetProvider = providerId || provider
    const fetchedModels = getModelsForProvider(targetProvider)
    const fallbackModels = getFallbackModels(targetProvider)
    const models = fetchedModels.length > 0 ? fetchedModels : fallbackModels

    return isThinkingModel(modelId, models)
  }

  // Restore conversation's last used model when switching conversations
  // Note: Provider restoration is handled by Sidebar.handleSelectConversation
  useEffect(() => {
    if (isLoading) return

    // Don't restore model while streaming - user might have manually changed it
    if (isConversationStreaming(currentConversationId)) return

    const conversation = getCurrentConversation()
    if (!conversation) return

    // Check if conversation has saved model
    const savedModel = conversation.model
    if (!savedModel) return

    // Get models for the current provider
    const providerModels = getModelsForProvider(provider)
    const providerFallbackModels = getFallbackModels(provider)
    const allModelsForProvider = [...providerModels, ...providerFallbackModels]

    // Check if saved model exists in current provider's models and restore it
    const modelExists = allModelsForProvider.some(m => m.id === savedModel)
    if (modelExists && model !== savedModel) {
      setModel(savedModel)
    }
  }, [currentConversationId, isLoading]) // Only run when switching conversations, not when user changes provider manually

  const handleRefreshModels = async () => {
    if (needsApiKey && !hasApiKey) {
      showMissingApiKeyAlert(providerInfo.name, () => {
        if (onOpenSettings) onOpenSettings()
      })
      return
    }

    try {
      const models = await fetchModels(provider, true) // Force refresh
      // Auto-select first model if current model is not in the list
      if (models.length > 0 && !models.find(m => m.id === model)) {
        setModel(models[0].id)
      }
    } catch (error) {
      // Show appropriate error alert
      if (error.message.includes('401') || error.message.includes('Invalid API key')) {
        showInvalidApiKeyAlert(
          providerInfo.name,
          error.message,
          () => {
            if (onOpenSettings) onOpenSettings()
          }
        )
      } else {
        showFetchErrorAlert(
          providerInfo.name,
          error.message,
          () => handleRefreshModels()
        )
      }
    }
  }

  // Wrapper handlers that delegate to the hooks
  const handleSendMessage = async (messageContent, attachments = []) => {
    await sendMessage(messageContent, attachments, onOpenSettings)
  }

  const handleStopGeneration = () => {
    stopCurrentStreaming()
  }

  const handleRetry = async (assistantMessage) => {
    await retryMessage(assistantMessage, onOpenSettings)
  }

  const handleEditUserMessage = async (userMessage, newContent) => {
    await editMessage(userMessage, newContent, onOpenSettings)
  }

  const handleOpenWorkspaceFolder = async () => {
    await openWorkspaceFolder()
  }

  const handleChangeWorkspace = async () => {
    await changeWorkspace()
  }

  const handleUnlinkWorkspace = async () => {
    await unlinkWorkspace()
  }

  const handleTriggerCompaction = async () => {
    await triggerCompaction()
  }

  // Show loading state while initial data loads
  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Header skeleton */}
        <div className="border-b px-4 py-3">
          <div className="border rounded-lg p-2 flex items-center gap-2 w-fit">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-5 w-1" />
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </div>

        {/* Messages area with centered spinner */}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Spinner className="size-8" />
            <p className="text-sm text-muted-foreground">Loading configuration...</p>
          </div>
        </div>

        {/* Input skeleton */}
        <div className="border-t p-4">
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  // Provider change handler with model auto-selection
  const handleProviderChange = (value) => {
    setProvider(value)
    // Auto-select first model when cached models load
    const cached = getModelsForProvider(value)
    const fallback = getFallbackModels(value)
    const models = cached.length > 0 ? cached : fallback
    if (models.length > 0) {
      setModel(models[0].id)
    }
  }

  // Model change handler
  const handleModelChange = (value) => {
    setModel(value)
  }

  // Streaming state calculations
  const isCurrentStreaming = isConversationStreaming(currentConversationId)
  const isAnyOtherStreaming = Array.from(streamingConversationIds).some(id => id !== currentConversationId)

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <ChatHeader
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
        provider={provider}
        model={model}
        allProviders={allProviders}
        currentModels={currentModels}
        onProviderChange={handleProviderChange}
        onModelChange={handleModelChange}
        fetchStatus={fetchStatus}
        usingFallback={usingFallback}
        onRefreshModels={handleRefreshModels}
      />

      <MessageArea
        messages={messages}
        currentConversationId={currentConversationId}
        onRetry={handleRetry}
        onEditUserMessage={handleEditUserMessage}
        onDeleteMessage={deleteMessage}
        isStreaming={isCurrentStreaming}
        isCompacting={isCompacting}
        getOpencodeActivity={getOpencodeActivity}
        getWorkingDirectory={getWorkingDirectory}
      />

      <MessageInputArea
        ref={messageInputRef}
        onSendMessage={handleSendMessage}
        onStopGeneration={handleStopGeneration}
        isCurrentStreaming={isCurrentStreaming}
        isAnyOtherStreaming={isAnyOtherStreaming}
        isCompacting={isCompacting}
        workspaceName={workspaceName}
        workspaceType={workspaceType}
        hasMessages={messages.length > 0}
        onOpenWorkspaceFolder={handleOpenWorkspaceFolder}
        onChangeWorkspace={handleChangeWorkspace}
        onUnlinkWorkspace={handleUnlinkWorkspace}
        onTriggerCompaction={handleTriggerCompaction}
      />
    </div>
  )
})

export default ChatWindow
