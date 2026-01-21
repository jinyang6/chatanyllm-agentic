/**
 * Custom hook for managing streaming message operations
 * Consolidates message sending, retrying, and editing logic with streaming support
 */

import { useRef, useCallback } from 'react'
import { useConversation } from '@/contexts/ConversationContext'
import { useProvider } from '@/contexts/ProviderContext'
import { useError } from '@/contexts/ErrorContext'
import { sendStreamingMessage } from '@/services/chat/chatClient'
import { formatMessageForAPI, formatMessagesForAPI } from '@/utils/messageFormatters'
import { getModalitiesForModel, isThinkingModel } from '@/utils/modelHelpers'
import { handleStreamingError } from '@/utils/errorHandlers'
import { createStreamingCallbacks } from '@/utils/streamingHelpers'
import { getProviderById, getFallbackModels } from '@/config/providers'

/**
 * Hook for handling streaming message operations
 * @param {Object} config - Configuration object
 * @param {string} config.conversationId - Current conversation ID
 * @param {Function} config.onCompletionCheck - Optional callback after message completion
 * @returns {Object} Streaming operations and state
 */
export function useStreamingMessage({ conversationId, onCompletionCheck = null }) {
  const {
    messages,
    isConversationStreaming,
    startStreaming,
    stopStreaming,
    addMessage,
    updateLastMessage,
    updateLastMessageReasoning,
    markReasoningComplete,
    replaceMessages,
    getConversationById,
    currentConversationId,
    addOpencodeEvent,
    setOpencodeStatus,
    clearOpencodeActivity,
    setOpencodeProcessingText,
    setOpencodePendingPermission
  } = useConversation()

  const {
    provider,
    model,
    apiKeys,
    customProviders,
    getModelsForProvider
  } = useProvider()

  const {
    showFetchErrorAlert,
    showInvalidApiKeyAlert,
    showMissingApiKeyAlert
  } = useError()

  // Use refs to track the absolutely latest model/provider selections
  // This solves the issue where React state updates are async
  const latestModelRef = useRef(model)
  const latestProviderRef = useRef(provider)

  // Keep refs in sync with state
  latestModelRef.current = model
  latestProviderRef.current = provider

  /**
   * Get modalities for a model (wrapper for the utility function with currentModels)
   */
  const getModalitiesForCurrentModel = useCallback((modelId, providerId = null) => {
    const targetProvider = providerId || provider
    const fetchedModels = getModelsForProvider(targetProvider)
    const fallbackModels = getFallbackModels(targetProvider)
    const models = fetchedModels.length > 0 ? fetchedModels : fallbackModels
    return getModalitiesForModel(modelId, models)
  }, [provider, getModelsForProvider])

  /**
   * Check if model is a thinking model
   */
  const isModelThinkingWrapper = useCallback((modelId, providerId = null) => {
    const targetProvider = providerId || provider
    const fetchedModels = getModelsForProvider(targetProvider)
    const fallbackModels = getFallbackModels(targetProvider)
    const models = fetchedModels.length > 0 ? fetchedModels : fallbackModels
    return isThinkingModel(modelId, models)
  }, [provider, getModelsForProvider])

  /**
   * Create OpenCode callbacks for a specific message
   */
  const createOpencodeCallbacks = useCallback((messageId) => ({
    addOpencodeEvent: (event) => addOpencodeEvent(messageId, event),
    setOpencodeStatus: (status) => setOpencodeStatus(messageId, status),
    clearOpencodeActivity: () => clearOpencodeActivity(messageId),
    setOpencodeProcessingText: (text) => setOpencodeProcessingText(messageId, text),
    setOpencodePendingPermission: (permission) => setOpencodePendingPermission(messageId, permission)
  }), [addOpencodeEvent, setOpencodeStatus, clearOpencodeActivity, setOpencodeProcessingText, setOpencodePendingPermission])

  /**
   * Get provider info for error handling
   */
  const getProviderInfo = useCallback((providerId) => {
    return getProviderById(providerId) || customProviders.find(p => p.id === providerId) || {}
  }, [customProviders])

  /**
   * Build streaming callbacks configuration
   */
  const buildCallbacks = useCallback((targetConversationId, currentProvider, currentModel, onOpenSettings) => {
    const providerInfo = getProviderInfo(currentProvider)

    const metadata = {
      timestamp: new Date().toISOString(),
      model: currentModel,
      provider: currentProvider
    }

    return createStreamingCallbacks({
      conversationId: targetConversationId,
      updateLastMessage,
      updateLastMessageReasoning,
      markReasoningComplete,
      getConversationById,
      stopStreaming,
      metadata,
      onCompletionCheck,
      onError: (error) => {
        handleStreamingError({
          error,
          providerName: providerInfo.name,
          errorHandlers: { showFetchErrorAlert, showInvalidApiKeyAlert, showMissingApiKeyAlert },
          onOpenSettings
        })
      }
    })
  }, [
    getProviderInfo,
    updateLastMessage,
    updateLastMessageReasoning,
    markReasoningComplete,
    getConversationById,
    stopStreaming,
    onCompletionCheck,
    showFetchErrorAlert,
    showInvalidApiKeyAlert,
    showMissingApiKeyAlert
  ])

  /**
   * Send a streaming message
   */
  const sendMessage = useCallback(async (messageContent, attachments = [], onOpenSettings) => {
    // Use refs to get the absolutely latest model/provider selection
    const currentModel = latestModelRef.current
    const currentProvider = latestProviderRef.current

    // Check if we have an API key
    const apiKey = apiKeys[currentProvider]
    if (!apiKey) {
      const providerInfo = getProviderInfo(currentProvider)
      showMissingApiKeyAlert(providerInfo.name, () => {
        if (onOpenSettings) onOpenSettings()
      })
      return
    }

    // Capture conversation ID at the very start (before any async operations)
    const targetConversationId = currentConversationId

    // Don't allow sending if this conversation is already streaming
    if (isConversationStreaming(targetConversationId)) {
      return
    }

    let assistantMessageId
    try {
      // Add user message with attachments to the captured conversation
      await addMessage({
        role: 'user',
        content: messageContent,
        model: currentModel,
        provider: currentProvider,
        attachments: attachments.length > 0 ? attachments : undefined
      }, targetConversationId)

      // Create placeholder for assistant message in the same conversation
      const assistantMessage = await addMessage({
        role: 'assistant',
        content: '',
        model: currentModel,
        provider: currentProvider
      }, targetConversationId)

      // Store the assistant message ID for OpenCode activity tracking
      assistantMessageId = assistantMessage.id
    } catch (error) {
      console.error('Error adding messages:', error)
      const providerInfo = getProviderInfo(currentProvider)
      showFetchErrorAlert(providerInfo.name, 'Failed to save message. Please try again.')
      return
    }

    // Build messages array for API call
    const currentUserMessage = formatMessageForAPI(
      { role: 'user', content: messageContent },
      attachments
    )

    const messagesForApi = [
      ...formatMessagesForAPI(messages),
      currentUserMessage
    ]

    // Start streaming for this conversation
    const abortSignal = startStreaming(targetConversationId)

    // Create streaming callbacks
    const streamingCallbacks = buildCallbacks(targetConversationId, currentProvider, currentModel, onOpenSettings)

    try {
      // Create OpenCode callbacks that use the assistant message ID
      const opencodeCallbacks = createOpencodeCallbacks(assistantMessageId)

      await sendStreamingMessage({
        providerId: currentProvider,
        providerConfig: customProviders.find(p => p.id === currentProvider),
        apiKey,
        model: currentModel,
        messages: messagesForApi,
        ...streamingCallbacks,
        abortSignal,
        modalities: getModalitiesForCurrentModel(currentModel, currentProvider),
        reasoning: isModelThinkingWrapper(currentModel, currentProvider) ? { effort: 'high' } : null,
        conversationId: targetConversationId,
        useOpenCode: true,
        ...opencodeCallbacks
      })
    } catch (error) {
      console.error('Unexpected error:', error)
      stopStreaming(targetConversationId)
    }
  }, [
    apiKeys,
    currentConversationId,
    isConversationStreaming,
    addMessage,
    messages,
    startStreaming,
    customProviders,
    stopStreaming,
    getProviderInfo,
    showMissingApiKeyAlert,
    showFetchErrorAlert,
    buildCallbacks,
    createOpencodeCallbacks
  ])

  /**
   * Retry a failed assistant message
   */
  const retryMessage = useCallback(async (assistantMessage, onOpenSettings) => {
    if (isConversationStreaming(currentConversationId)) return

    // Find the user message that triggered this assistant response
    const messageIndex = messages.findIndex(m => m.id === assistantMessage.id)
    if (messageIndex <= 0) return

    // Get the user message before the assistant message
    const userMessage = messages[messageIndex - 1]
    if (userMessage.role !== 'user') return

    // Use refs to get the absolutely latest model/provider selection
    const currentModel = latestModelRef.current
    const currentProvider = latestProviderRef.current

    // Check if we have an API key
    const apiKey = apiKeys[currentProvider]
    if (!apiKey) {
      const providerInfo = getProviderInfo(currentProvider)
      showMissingApiKeyAlert(providerInfo.name, () => {
        if (onOpenSettings) onOpenSettings()
      })
      return
    }

    // Build messages for API call (all messages up to but not including this assistant response)
    const messagesForApi = formatMessagesForAPI(messages.slice(0, messageIndex))

    // Clear the assistant message content for regeneration
    const clearMetadata = {
      timestamp: new Date().toISOString(),
      model: currentModel,
      provider: currentProvider,
      reasoning: '',
      isReasoningComplete: false
    }
    updateLastMessage('', false, clearMetadata)

    // Capture conversation ID at start of streaming
    const retryConversationId = currentConversationId

    // Start streaming
    const abortSignal = startStreaming(retryConversationId)

    // Create metadata for streaming updates (without reasoning fields to avoid overwrites)
    const streamingMetadata = {
      timestamp: new Date().toISOString(),
      model: currentModel,
      provider: currentProvider
    }

    // Create streaming callbacks
    const streamingCallbacks = buildCallbacks(retryConversationId, currentProvider, currentModel, onOpenSettings)

    try {
      const modalities = getModalitiesForCurrentModel(currentModel, currentProvider)
      const reasoning = isModelThinkingWrapper(currentModel, currentProvider) ? { effort: 'high' } : null

      // Create OpenCode callbacks that use the assistant message ID
      const opencodeCallbacks = createOpencodeCallbacks(assistantMessage.id)

      await sendStreamingMessage({
        providerId: currentProvider,
        providerConfig: customProviders.find(p => p.id === currentProvider),
        apiKey,
        model: currentModel,
        messages: messagesForApi,
        ...streamingCallbacks,
        abortSignal,
        modalities,
        reasoning,
        conversationId: retryConversationId,
        useOpenCode: true,
        ...opencodeCallbacks
      })
    } catch (error) {
      console.error('Unexpected retry error:', error)
      stopStreaming(retryConversationId)
    }
  }, [
    isConversationStreaming,
    currentConversationId,
    messages,
    apiKeys,
    updateLastMessage,
    startStreaming,
    customProviders,
    stopStreaming,
    getProviderInfo,
    showMissingApiKeyAlert,
    buildCallbacks,
    createOpencodeCallbacks
  ])

  /**
   * Edit a user message and regenerate response
   */
  const editMessage = useCallback(async (userMessage, newContent, onOpenSettings) => {
    if (isConversationStreaming(currentConversationId)) return

    // Capture conversation ID at the very start (before any async operations)
    const editConversationId = currentConversationId

    // Use refs to get the absolutely latest model/provider selection
    const currentModel = latestModelRef.current
    const currentProvider = latestProviderRef.current

    // Find the index of the user message
    const messageIndex = messages.findIndex(m => m.id === userMessage.id)
    if (messageIndex < 0) return

    // Check if we have an API key
    const apiKey = apiKeys[currentProvider]
    if (!apiKey) {
      const providerInfo = getProviderInfo(currentProvider)
      showMissingApiKeyAlert(providerInfo.name, () => {
        if (onOpenSettings) onOpenSettings()
      })
      return
    }

    let messagesForApi
    let editAssistantMessageId
    try {
      // Update the user message content in state
      const updatedMessages = [...messages]
      updatedMessages[messageIndex] = {
        ...updatedMessages[messageIndex],
        content: newContent,
        timestamp: new Date().toISOString()
      }

      // Remove all messages after this user message (assistant response and any following)
      const messagesUpToEdit = updatedMessages.slice(0, messageIndex + 1)

      // Update state and storage immediately
      await replaceMessages(messagesUpToEdit)

      // Build messages for API call
      messagesForApi = formatMessagesForAPI(messagesUpToEdit)

      // Add new assistant placeholder to the captured conversation
      const assistantMessage = await addMessage({
        role: 'assistant',
        content: '',
        reasoning: '',
        isReasoningComplete: false,
        model: currentModel,
        provider: currentProvider
      }, editConversationId)

      // Store the assistant message ID for OpenCode activity tracking
      editAssistantMessageId = assistantMessage.id
    } catch (error) {
      console.error('Error editing message:', error)
      const providerInfo = getProviderInfo(currentProvider)
      showFetchErrorAlert(providerInfo.name, 'Failed to edit message. Please try again.')
      return
    }

    // Start streaming the new response
    const abortSignal = startStreaming(editConversationId)

    // Create streaming callbacks
    const streamingCallbacks = buildCallbacks(editConversationId, currentProvider, currentModel, onOpenSettings)

    try {
      const modalities = getModalitiesForCurrentModel(currentModel, currentProvider)
      const reasoning = isModelThinkingWrapper(currentModel, currentProvider) ? { effort: 'high' } : null

      // Create OpenCode callbacks that use the assistant message ID
      const opencodeCallbacks = createOpencodeCallbacks(editAssistantMessageId)

      await sendStreamingMessage({
        providerId: currentProvider,
        providerConfig: customProviders.find(p => p.id === currentProvider),
        apiKey,
        model: currentModel,
        messages: messagesForApi,
        ...streamingCallbacks,
        abortSignal,
        modalities,
        reasoning,
        conversationId: editConversationId,
        useOpenCode: true,
        ...opencodeCallbacks
      })
    } catch (error) {
      console.error('Unexpected edit error:', error)
      stopStreaming(editConversationId)
    }
  }, [
    isConversationStreaming,
    currentConversationId,
    messages,
    apiKeys,
    replaceMessages,
    addMessage,
    startStreaming,
    customProviders,
    stopStreaming,
    getProviderInfo,
    showMissingApiKeyAlert,
    showFetchErrorAlert,
    buildCallbacks,
    createOpencodeCallbacks
  ])

  /**
   * Stop streaming for current conversation
   */
  const stopCurrentStreaming = useCallback(() => {
    if (isConversationStreaming(currentConversationId)) {
      stopStreaming(currentConversationId)
    }
  }, [isConversationStreaming, currentConversationId, stopStreaming])

  return {
    sendMessage,
    retryMessage,
    editMessage,
    stopStreaming: stopCurrentStreaming,
    isStreaming: isConversationStreaming(currentConversationId)
  }
}
