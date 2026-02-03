/**
 * Custom hook for message CRUD operations
 * Provides memoized callbacks for message operations from ConversationContext
 */

import { useCallback, useMemo } from 'react'
import { useConversation } from '@/contexts/ConversationContext'

/**
 * Hook for message operations with proper memoization
 * @param {string} conversationId - Current conversation ID (optional, uses current from context if not provided)
 * @returns {Object} Message operations and state
 */
export function useMessageOperations(conversationId = null) {
  const {
    messages,
    addMessage: contextAddMessage,
    updateMessage: contextUpdateMessage,
    updateLastMessage: contextUpdateLastMessage,
    updateLastMessageReasoning: contextUpdateLastMessageReasoning,
    markReasoningComplete: contextMarkReasoningComplete,
    deleteMessage: contextDeleteMessage,
    replaceMessages: contextReplaceMessages,
    currentConversationId
  } = useConversation()

  // Use provided conversationId or fall back to current
  const targetConversationId = conversationId || currentConversationId

  /**
   * Add a new message to the conversation
   */
  const addMessage = useCallback(async (message, convId = null) => {
    return await contextAddMessage(message, convId || targetConversationId)
  }, [contextAddMessage, targetConversationId])

  /**
   * Update an existing message
   */
  const updateMessage = useCallback(async (messageId, updates, convId = null) => {
    return await contextUpdateMessage(messageId, updates, convId || targetConversationId)
  }, [contextUpdateMessage, targetConversationId])

  /**
   * Update the last message in the conversation
   */
  const updateLastMessage = useCallback((content, isComplete = false, metadata = null, convId = null) => {
    return contextUpdateLastMessage(content, isComplete, metadata, convId || targetConversationId)
  }, [contextUpdateLastMessage, targetConversationId])

  /**
   * Update reasoning for the last message
   */
  const updateLastMessageReasoning = useCallback((reasoning, isComplete = false, convId = null) => {
    return contextUpdateLastMessageReasoning(reasoning, isComplete, convId || targetConversationId)
  }, [contextUpdateLastMessageReasoning, targetConversationId])

  /**
   * Mark reasoning as complete for the last message
   */
  const markReasoningComplete = useCallback((convId = null) => {
    return contextMarkReasoningComplete(convId || targetConversationId)
  }, [contextMarkReasoningComplete, targetConversationId])

  /**
   * Delete a message from the conversation
   */
  const deleteMessage = useCallback(async (messageId, convId = null) => {
    return await contextDeleteMessage(messageId, convId || targetConversationId)
  }, [contextDeleteMessage, targetConversationId])

  /**
   * Replace all messages in the conversation
   */
  const replaceMessages = useCallback(async (newMessages, convId = null) => {
    return await contextReplaceMessages(newMessages, convId || targetConversationId)
  }, [contextReplaceMessages, targetConversationId])

  /**
   * Get message count for current conversation
   */
  const messageCount = useMemo(() => {
    return messages.length
  }, [messages.length])

  /**
   * Check if conversation has messages
   */
  const hasMessages = useMemo(() => {
    return messages.length > 0
  }, [messages.length])

  /**
   * Get last message
   */
  const lastMessage = useMemo(() => {
    return messages.length > 0 ? messages[messages.length - 1] : null
  }, [messages])

  /**
   * Get messages by role
   */
  const getMessagesByRole = useCallback((role) => {
    return messages.filter(m => m.role === role)
  }, [messages])

  return {
    // Message operations
    addMessage,
    updateMessage,
    updateLastMessage,
    updateLastMessageReasoning,
    markReasoningComplete,
    deleteMessage,
    replaceMessages,

    // Message state
    messages,
    messageCount,
    hasMessages,
    lastMessage,

    // Utilities
    getMessagesByRole
  }
}
