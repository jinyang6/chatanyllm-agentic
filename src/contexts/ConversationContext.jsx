import { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react'
import { conversations as conversationStorage, isElectron } from '@/lib/electron'
import { v4 as uuidv4 } from 'uuid'
import { STREAMING_CONSTANTS } from '@/constants/streaming'
import { cleanupSession } from '@/services/chat/adapters/openCodeAdapter'

const ConversationContext = createContext(null)

export function ConversationProvider({ children }) {
  const [conversations, setConversations] = useState([])
  const [currentConversationId, setCurrentConversationId] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [streamingConversationIds, setStreamingConversationIds] = useState(new Set())
  const [opencodeActivity, setOpencodeActivity] = useState(new Map()) // Map of messageId -> { isActive, currentAction, events, processingText, etc }
  const saveOperationsRef = useRef(new Map()) // Map of conversationId -> { timeout, cancelled } for debounced saves
  const initializedRef = useRef(false) // Prevent duplicate initialization in React Strict Mode
  const abortControllersRef = useRef(new Map()) // Map of conversationId -> AbortController
  const abortedConversationIdsRef = useRef(new Set()) // Track recently aborted conversations to prevent stale updates
  const stateUpdateQueueRef = useRef(Promise.resolve()) // Queue to serialize state updates and prevent race conditions
  const uiUpdateThrottleRef = useRef(new Map()) // Map of conversationId -> { timeout, pendingData } for throttling UI updates
  const conversationsRef = useRef(conversations) // Ref to always have latest conversations state

  // Keep conversationsRef in sync with conversations state
  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  // Derive messages from conversations - single source of truth
  const messages = useMemo(() => {
    if (!currentConversationId) return []
    const current = conversations.find(c => c.id === currentConversationId)
    return current?.messages || []
  }, [conversations, currentConversationId])

  // Queued setConversations to serialize updates and prevent race conditions
  const queuedSetConversations = (updater) => {
    return new Promise((resolve) => {
      stateUpdateQueueRef.current = stateUpdateQueueRef.current.then(() => {
        return new Promise((innerResolve) => {
          setConversations(prev => {
            const result = updater(prev)
            // Wait for React to process the state update
            setTimeout(() => {
              innerResolve()
              resolve()
            }, 0)
            return result
          })
        })
      })
    })
  }

  // Streaming helper functions
  const isConversationStreaming = (conversationId) => {
    return streamingConversationIds.has(conversationId)
  }

  const startStreaming = (conversationId) => {
    const controller = new AbortController()
    abortControllersRef.current.set(conversationId, controller)
    setStreamingConversationIds(prev => new Set([...prev, conversationId]))
    return controller.signal
  }

  const stopStreaming = (conversationId) => {
    // Clean up reasoning state BEFORE marking as aborted
    // If there's any reasoning content that's not marked complete, mark it now
    queuedSetConversations(prev => {
      const conversation = prev.find(c => c.id === conversationId)
      if (!conversation) return prev

      const messages = conversation.messages || []
      if (messages.length === 0) return prev

      const lastMessage = messages[messages.length - 1]

      // If last message has reasoning that's not marked complete, mark it now
      if (lastMessage.reasoning && !lastMessage.isReasoningComplete) {
        const updatedMessages = [...messages]
        updatedMessages[updatedMessages.length - 1] = {
          ...lastMessage,
          isReasoningComplete: true
        }

        const updated = {
          ...conversation,
          messages: updatedMessages
        }

        // Save immediately
        conversationStorage.save(updated).catch(error => {
          console.error('Failed to save reasoning cleanup on abort:', error)
        })

        return prev.map(c => c.id === conversationId ? updated : c)
      }

      return prev
    })

    // Mark conversation as aborted AFTER cleaning up reasoning
    abortedConversationIdsRef.current.add(conversationId)

    const controller = abortControllersRef.current.get(conversationId)
    if (controller) {
      controller.abort()
      abortControllersRef.current.delete(conversationId)
    }

    // Cancel any pending debounced saves for this conversation
    const pendingOperation = saveOperationsRef.current.get(conversationId)
    if (pendingOperation) {
      clearTimeout(pendingOperation.timeout)
      pendingOperation.cancelled = true // Mark as cancelled to prevent execution
      saveOperationsRef.current.delete(conversationId)
    }

    // Cancel any pending throttled UI updates
    const pendingUIUpdate = uiUpdateThrottleRef.current.get(conversationId)
    if (pendingUIUpdate) {
      clearTimeout(pendingUIUpdate.timeout)
      uiUpdateThrottleRef.current.delete(conversationId)
    }

    setStreamingConversationIds(prev => {
      const next = new Set(prev)
      next.delete(conversationId)
      return next
    })

    // Clear abort flag after short delay to allow legitimate new streams
    // Reduced from 1000ms to 100ms to minimize blocking window
    setTimeout(() => {
      abortedConversationIdsRef.current.delete(conversationId)
    }, 100)
  }

  const getAbortSignal = (conversationId) => {
    return abortControllersRef.current.get(conversationId)?.signal || null
  }

  // Create a new conversation (defined before useEffect to avoid hoisting issues)
  const createNewConversation = async () => {
    const conversationId = uuidv4()
    const appDataPath = await window.electronAPI.getAppDataPath()

    // Use path.join equivalent for browser - create consistent path separators
    const workspacePath = isElectron()
      ? `${appDataPath}\\userfiles\\workspaces\\${conversationId}`
      : `${appDataPath}/userfiles/workspaces/${conversationId}`

    const newConversation = {
      id: conversationId,
      title: 'New Conversation',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: null, // Will be set when first message is sent
      provider: null,
      workingDirectory: {
        type: 'isolated',
        path: workspacePath
      }
    }

    try {
      // Save to storage
      await conversationStorage.save(newConversation)
    } catch (error) {
      console.error('Failed to save new conversation to storage:', error)
      // Continue anyway - state will be updated
    }

    // Update state
    setConversations(prev => [newConversation, ...prev])

    return newConversation
  }

  // Migration: Add working directory to existing conversations
  const migrateConversations = async (conversations) => {
    const appDataPath = await window.electronAPI.getAppDataPath()
    let needsMigration = false

    const migrated = conversations.map(conv => {
      let updated = { ...conv }
      let changed = false

      // Add working directory if missing
      if (!conv.workingDirectory) {
        needsMigration = true
        changed = true
        const workspacePath = isElectron()
          ? `${appDataPath}\\userfiles\\workspaces\\${conv.id}`
          : `${appDataPath}/userfiles/workspaces/${conv.id}`
        updated.workingDirectory = {
          type: 'isolated',
          path: workspacePath
        }
      }
      // Fix mixed path separators in existing working directories
      else if (isElectron() && conv.workingDirectory.path && conv.workingDirectory.path.includes('/')) {
        needsMigration = true
        changed = true
        // Normalize to use backslashes on Windows
        updated.workingDirectory = {
          ...conv.workingDirectory,
          path: conv.workingDirectory.path.replace(/\//g, '\\')
        }
      }

      return changed ? updated : conv
    })

    // Save migrated conversations
    if (needsMigration) {
      console.log('🔄 Migrating conversations to include working directory...')
      for (const conversation of migrated) {
        if (!conversations.find(c => c.id === conversation.id)?.workingDirectory) {
          await conversationStorage.save(conversation)
        }
      }
      console.log('✓ Migration complete')
    }

    return migrated
  }

  // Load all conversations on mount
  useEffect(() => {
    // Prevent double initialization in React Strict Mode
    if (initializedRef.current) return
    initializedRef.current = true

    const loadConversations = async () => {
      try {
        const result = await conversationStorage.list()
        if (result.success && result.conversations.length > 0) {
          // Migrate conversations if needed
          const migrated = await migrateConversations(result.conversations)

          // Sort by last updated time (most recent first)
          const sorted = migrated.sort((a, b) =>
            new Date(b.updatedAt) - new Date(a.updatedAt)
          )
          setConversations(sorted)

          // Restore OpenCode activity from persisted messages (using reasoning field)
          const activityMap = new Map()
          sorted.forEach(conv => {
            conv.messages.forEach(msg => {
              if (msg.reasoning && msg.role === 'assistant') {
                activityMap.set(msg.id, {
                  isActive: false,
                  currentAction: null,
                  events: [],
                  processingText: msg.reasoning,
                  pendingPermission: null,
                  isProcessingComplete: true
                })
              }
            })
          })
          setOpencodeActivity(activityMap)

          // Load the most recent conversation
          const mostRecent = sorted[0]
          setCurrentConversationId(mostRecent.id)
        } else {
          // Create a new conversation if none exist
          const newConv = await createNewConversation()
          setCurrentConversationId(newConv.id)
        }
      } catch (error) {
        console.error('Failed to load conversations:', error)
        // Create a new conversation on error
        const newConv = await createNewConversation()
        setCurrentConversationId(newConv.id)
      } finally {
        setIsLoading(false)
      }
    }

    loadConversations()
  }, [])

  // Generate conversation title from first message
  const generateTitle = (firstMessage) => {
    if (!firstMessage || !firstMessage.content) return 'New Conversation'

    const content = firstMessage.content.trim()

    // Take first 50 characters or until first newline
    const firstLine = content.split('\n')[0]
    const title = firstLine.length > 50
      ? firstLine.substring(0, 50) + '...'
      : firstLine

    return title || 'New Conversation'
  }

  // Add a message to the current conversation (or specified conversation)
  const addMessage = async (message, conversationId = null) => {
    // Use provided conversationId or fall back to current
    const targetConversationId = conversationId || currentConversationId

    const newMessage = {
      id: uuidv4(),
      role: message.role,
      content: message.content,
      reasoning: message.reasoning || '',
      isReasoningComplete: message.isReasoningComplete || false,
      timestamp: new Date().toISOString(),
      model: message.model || null,
      provider: message.provider || null,
      attachments: message.attachments || undefined
    }

    // Update conversation - messages will derive automatically
    let conversationToSave = null
    setConversations(prev => {
      const updatedConversation = prev.find(c => c.id === targetConversationId)
      if (!updatedConversation) {
        console.error('Cannot find conversation:', targetConversationId)
        return prev
      }

      const updatedMessages = [...(updatedConversation.messages || []), newMessage]

      // Generate title from first user message if still "New Conversation"
      let title = updatedConversation.title
      if (title === 'New Conversation' && message.role === 'user') {
        title = generateTitle(message)
      }

      const updated = {
        ...updatedConversation,
        messages: updatedMessages,
        title,
        updatedAt: new Date().toISOString(),
        model: message.model || updatedConversation.model,
        provider: message.provider || updatedConversation.provider
      }

      conversationToSave = updated

      return prev.map(c => c.id === targetConversationId ? updated : c)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    })

    // Save to storage after state update
    if (conversationToSave) {
      try {
        await conversationStorage.save(conversationToSave)
      } catch (error) {
        console.error('Failed to save conversation after adding message:', error)
        // Message is already in state, so continue
      }
    }

    return newMessage
  }

  // Update the last message (for streaming) - with debounced save and throttled UI updates
  const updateLastMessage = (content, saveImmediately = false, metadata = null, conversationId = null) => {
    // Use provided conversationId or fall back to current
    const targetConversationId = conversationId || currentConversationId

    // GUARD: Ignore updates for aborted conversations to prevent race conditions
    if (abortedConversationIdsRef.current.has(targetConversationId)) {
      return
    }

    // Store pending update data
    const updateData = { content, saveImmediately, metadata, targetConversationId }

    // If saveImmediately (stream complete), flush throttle and update now
    if (saveImmediately) {
      // Cancel any pending throttled update
      const existing = uiUpdateThrottleRef.current.get(targetConversationId)
      if (existing) {
        clearTimeout(existing.timeout)
        uiUpdateThrottleRef.current.delete(targetConversationId)
      }

      // Update immediately
      performUIUpdate(updateData)
    } else {
      // Throttle UI updates during streaming
      const existing = uiUpdateThrottleRef.current.get(targetConversationId)

      if (existing) {
        // Update pending data but don't create new timeout
        existing.pendingData = updateData
      } else {
        // Schedule throttled update
        const timeout = setTimeout(() => {
          const throttle = uiUpdateThrottleRef.current.get(targetConversationId)
          if (throttle) {
            performUIUpdate(throttle.pendingData)
            uiUpdateThrottleRef.current.delete(targetConversationId)
          }
        }, STREAMING_CONSTANTS.UI_UPDATE_THROTTLE_MS)

        uiUpdateThrottleRef.current.set(targetConversationId, {
          timeout,
          pendingData: updateData
        })
      }
    }
  }

  // Helper function to perform the actual UI update
  const performUIUpdate = ({ content, saveImmediately, metadata, targetConversationId }) => {
    // Update UI with queued state updates to prevent race conditions
    queuedSetConversations(prev => {
      const updatedConversation = prev.find(c => c.id === targetConversationId)
      if (!updatedConversation) return prev

      const currentMessages = [...(updatedConversation.messages || [])]
      if (currentMessages.length === 0) return prev

      // Update the last message with new content and optional metadata
      currentMessages[currentMessages.length - 1] = {
        ...currentMessages[currentMessages.length - 1],
        content,
        ...(metadata ? {
          timestamp: metadata.timestamp || currentMessages[currentMessages.length - 1].timestamp,
          model: metadata.model || currentMessages[currentMessages.length - 1].model,
          provider: metadata.provider || currentMessages[currentMessages.length - 1].provider,
          reasoning: (metadata && 'reasoning' in metadata) ? metadata.reasoning : currentMessages[currentMessages.length - 1].reasoning,
          isReasoningComplete: (metadata && 'isReasoningComplete' in metadata) ? metadata.isReasoningComplete : currentMessages[currentMessages.length - 1].isReasoningComplete
        } : {})
      }

      const updated = {
        ...updatedConversation,
        messages: currentMessages,
        // Update conversation model/provider when metadata is provided (for retry/regenerate)
        ...(metadata && metadata.model ? { model: metadata.model } : {}),
        ...(metadata && metadata.provider ? { provider: metadata.provider } : {}),
        // Only update timestamp when saving immediately (stream complete/abort)
        ...(saveImmediately ? { updatedAt: new Date().toISOString() } : {})
      }

      // Debounce saves during streaming to avoid too many file writes (per conversation)
      const existingOperation = saveOperationsRef.current.get(targetConversationId)
      if (existingOperation) {
        clearTimeout(existingOperation.timeout)
        existingOperation.cancelled = true // Mark as cancelled to prevent execution
      }

      if (saveImmediately) {
        // Save immediately (for when streaming completes)
        conversationStorage.save(updated).catch(error => {
          console.error('Failed to save conversation immediately:', error)
        })
        saveOperationsRef.current.delete(targetConversationId)
      } else {
        // Debounce saves during streaming
        const operation = { cancelled: false, timeout: null }
        operation.timeout = setTimeout(() => {
          // Check if operation was cancelled before saving
          if (!operation.cancelled) {
            conversationStorage.save(updated).catch(error => {
              console.error('Failed to save conversation during streaming:', error)
            })
          }
          saveOperationsRef.current.delete(targetConversationId)
        }, STREAMING_CONSTANTS.SAVE_DEBOUNCE_MS)
        saveOperationsRef.current.set(targetConversationId, operation)
      }

      // Return updated conversations array
      // Only sort if updatedAt changed (saveImmediately=true)
      const updatedArray = prev.map(c => c.id === targetConversationId ? updated : c)

      if (saveImmediately) {
        // Sort only when conversation timestamp changes (stream complete/abort)
        return updatedArray.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      }

      return updatedArray
    })
  }

  // Update the last message's reasoning (for streaming reasoning tokens)
  const updateLastMessageReasoning = (reasoning, saveImmediately = false, conversationId = null) => {
    const targetConversationId = conversationId || currentConversationId

    // GUARD: Ignore updates for aborted conversations to prevent race conditions
    if (abortedConversationIdsRef.current.has(targetConversationId)) {
      return
    }

    queuedSetConversations(prev => {
      const updatedConversation = prev.find(c => c.id === targetConversationId)
      if (!updatedConversation) return prev

      const currentMessages = [...(updatedConversation.messages || [])]
      if (currentMessages.length === 0) return prev

      // Update the last message with new reasoning
      currentMessages[currentMessages.length - 1] = {
        ...currentMessages[currentMessages.length - 1],
        reasoning
      }

      const updated = {
        ...updatedConversation,
        messages: currentMessages
        // Don't update timestamp during reasoning streaming - only on completion
      }

      // Save immediately to avoid race conditions with completion callbacks
      conversationStorage.save(updated).catch(error => {
        console.error('Failed to save conversation after reasoning update:', error)
      })

      // No need to sort - timestamp doesn't change during reasoning updates
      return prev.map(c => c.id === targetConversationId ? updated : c)
    })
  }

  // Mark reasoning as complete
  const markReasoningComplete = (conversationId = null) => {
    const targetConversationId = conversationId || currentConversationId

    // GUARD: Ignore updates for aborted conversations to prevent race conditions
    if (abortedConversationIdsRef.current.has(targetConversationId)) {
      return
    }

    queuedSetConversations(prev => {
      const updatedConversation = prev.find(c => c.id === targetConversationId)
      if (!updatedConversation) return prev

      const currentMessages = [...(updatedConversation.messages || [])]
      if (currentMessages.length === 0) return prev

      // Mark reasoning as complete on the last message
      currentMessages[currentMessages.length - 1] = {
        ...currentMessages[currentMessages.length - 1],
        isReasoningComplete: true
      }

      const updated = {
        ...updatedConversation,
        messages: currentMessages
        // Don't update timestamp - reasoning completion is mid-stream
      }

      conversationStorage.save(updated).catch(error => {
        console.error('Failed to save conversation after marking reasoning complete:', error)
      })

      // No need to sort - timestamp doesn't change when marking reasoning complete
      return prev.map(c => c.id === targetConversationId ? updated : c)
    })
  }

  // Update conversation title
  const updateConversationTitle = async (conversationId, newTitle) => {
    const conversation = conversations.find(c => c.id === conversationId)
    if (!conversation) return

    const updated = {
      ...conversation,
      title: newTitle.trim() || 'New Conversation',
      updatedAt: new Date().toISOString()
    }

    try {
      // Save to storage
      await conversationStorage.save(updated)
    } catch (error) {
      console.error('Failed to save conversation after title update:', error)
      // Continue anyway - state will be updated
    }

    // Update state and sort by most recent
    setConversations(prev =>
      prev.map(c => c.id === conversationId ? updated : c)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    )
  }

  // Delete a conversation
  const deleteConversation = async (conversationId) => {
    console.log('ConversationContext: Starting deletion for:', conversationId)

    // Get conversation before deletion to check working directory
    const conversation = conversations.find(c => c.id === conversationId)

    const result = await conversationStorage.delete(conversationId)
    console.log('ConversationContext: Storage deletion result:', result)

    if (!result.success) {
      console.error('Failed to delete conversation file:', result.error)
      // Still remove from state even if file deletion fails
    } else {
      console.log('ConversationContext: File deletion successful')
    }

    // Delete isolated workspace directory if this conversation used one
    if (conversation?.workingDirectory?.type === 'isolated') {
      try {
        console.log('ConversationContext: Deleting isolated workspace:', conversation.workingDirectory.path)
        if (window.electronAPI?.workspace) {
          const deleteResult = await window.electronAPI.workspace.deleteDirectory(conversation.workingDirectory.path)
          if (deleteResult.success) {
            console.log('ConversationContext: Workspace directory deleted successfully')
          } else {
            console.error('ConversationContext: Failed to delete workspace directory:', deleteResult.error)
          }
        }
      } catch (error) {
        console.error('ConversationContext: Failed to delete workspace directory:', error)
        // Continue with deletion even if workspace cleanup fails
      }
    } else if (conversation?.workingDirectory?.type === 'linked') {
      console.log('ConversationContext: Linked workspace - not deleting user project folder')
    }

    // Cleanup OpenCode session if this conversation used OpenCode provider
    if (conversation && conversation.provider === 'opencode') {
      try {
        await cleanupSession(conversationId)
        console.log('ConversationContext: OpenCode session cleaned up')
      } catch (error) {
        console.error('ConversationContext: Failed to cleanup OpenCode session:', error)
        // Continue with deletion even if OpenCode cleanup fails
      }
    }

    // Stop streaming if conversation was streaming
    if (isConversationStreaming(conversationId)) {
      stopStreaming(conversationId)
    }

    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== conversationId)

      // If we deleted the current conversation, switch to another one
      if (conversationId === currentConversationId) {
        if (filtered.length > 0) {
          setCurrentConversationId(filtered[0].id)
        } else {
          // Create a new conversation if none left
          createNewConversation().then(newConv => {
            setCurrentConversationId(newConv.id)
          })
        }
      }

      return filtered
    })
  }

  // Select a conversation
  const selectConversation = async (conversationId) => {
    // Allow switching to view other conversations
    // Input will be disabled in conversations that aren't streaming
    setCurrentConversationId(conversationId)
    return true
  }

  // Start a new conversation
  const startNewConversation = async () => {
    const newConv = await createNewConversation()
    setCurrentConversationId(newConv.id)
    // messages will automatically be empty via useMemo
  }

  // Get current conversation
  const getCurrentConversation = () => {
    return conversations.find(c => c.id === currentConversationId)
  }

  // Get conversation by ID (avoids stale closure issues by using ref)
  const getConversationById = (conversationId) => {
    return conversationsRef.current.find(c => c.id === conversationId)
  }

  // OpenCode activity management (per message)
  const addOpencodeEvent = (messageId, event) => {
    setOpencodeActivity(prev => {
      const next = new Map(prev)
      const activity = next.get(messageId) || { isActive: false, currentAction: null, events: [] }

      // Add event to the beginning of array (newest first)
      const updatedEvents = [event, ...activity.events].slice(0, 50) // Keep last 50 events

      next.set(messageId, {
        ...activity,
        events: updatedEvents
      })

      return next
    })
  }

  const setOpencodeStatus = (messageId, status) => {
    console.log('🔵 setOpencodeStatus called:', messageId, status)
    setOpencodeActivity(prev => {
      const next = new Map(prev)
      const activity = next.get(messageId) || { isActive: false, currentAction: null, events: [] }

      const updated = {
        ...activity,
        ...status
      }

      console.log('🔵 Updated activity:', updated)
      next.set(messageId, updated)

      return next
    })
  }

  const clearOpencodeActivity = (messageId) => {
    setOpencodeActivity(prev => {
      const next = new Map(prev)
      next.delete(messageId)
      return next
    })
  }

  const getOpencodeActivity = (messageId) => {
    const activity = opencodeActivity.get(messageId)
    // Return a new object to ensure React detects changes
    return activity ? { ...activity } : { isActive: false, currentAction: null, events: [], processingText: '', pendingPermission: null, isProcessingComplete: false }
  }

  const setOpencodePendingPermission = (messageId, permission) => {
    setOpencodeActivity(prev => {
      const next = new Map(prev)
      const activity = next.get(messageId) || { isActive: false, currentAction: null, events: [], processingText: '', pendingPermission: null }

      next.set(messageId, {
        ...activity,
        pendingPermission: permission
      })

      return next
    })
  }

  const setOpencodeProcessingText = (messageId, text) => {
    console.log('🔵 setOpencodeProcessingText called:', messageId, text.substring(0, 100))

    // Update in-memory activity
    setOpencodeActivity(prev => {
      const next = new Map(prev)
      const activity = next.get(messageId) || { isActive: false, currentAction: null, events: [], processingText: '' }

      next.set(messageId, {
        ...activity,
        processingText: text
      })

      return next
    })

    // Also save to message reasoning field for persistence
    setConversations(prev => {
      const conversation = prev.find(c => c.id === currentConversationId)
      if (!conversation) return prev

      const updatedMessages = conversation.messages.map(msg => {
        if (msg.id === messageId) {
          return {
            ...msg,
            reasoning: text
          }
        }
        return msg
      })

      const updated = {
        ...conversation,
        messages: updatedMessages,
        updatedAt: new Date().toISOString()
      }

      // Save to storage asynchronously
      conversationStorage.save(updated).catch(error => {
        console.error('Failed to save processing text:', error)
      })

      return prev.map(c => c.id === currentConversationId ? updated : c)
    })
  }

  // Replace all messages in the current conversation (for editing)
  const replaceMessages = async (newMessages) => {
    // Update conversation - messages will derive automatically
    let conversationToSave = null
    setConversations(prev => {
      const updatedConversation = prev.find(c => c.id === currentConversationId)
      if (!updatedConversation) {
        console.error('Cannot find conversation:', currentConversationId)
        return prev
      }

      const updated = {
        ...updatedConversation,
        messages: newMessages,
        updatedAt: new Date().toISOString()
      }

      conversationToSave = updated

      return prev.map(c => c.id === currentConversationId ? updated : c)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    })

    // Save to storage after state update
    if (conversationToSave) {
      try {
        await conversationStorage.save(conversationToSave)
      } catch (error) {
        console.error('Failed to save conversation after replacing messages:', error)
        // Messages are already in state, so continue
      }
    }
  }

  // Delete a specific message (only that single message)
  const deleteMessage = async (messageId) => {
    console.log('deleteMessage: Deleting message:', messageId)

    // Get the current conversation to update
    const currentConversation = conversations.find(c => c.id === currentConversationId)
    if (!currentConversation) {
      console.error('deleteMessage: Current conversation not found')
      return
    }

    const messageIndex = currentConversation.messages.findIndex(m => m.id === messageId)
    if (messageIndex < 0) {
      console.log('deleteMessage: Message not found in current conversation')
      return
    }

    // Remove only this specific message
    const newMessages = currentConversation.messages.filter(m => m.id !== messageId)
    console.log('deleteMessage: New messages count:', newMessages.length)

    const updatedConversation = {
      ...currentConversation,
      messages: newMessages,
      updatedAt: new Date().toISOString()
    }

    // Update state - messages will derive automatically
    setConversations(prev =>
      prev.map(c => c.id === currentConversationId ? updatedConversation : c)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    )

    // Save to storage
    console.log('deleteMessage: Saving updated conversation to storage')
    try {
      const saveResult = await conversationStorage.save(updatedConversation)
      console.log('deleteMessage: Save result:', saveResult)
    } catch (error) {
      console.error('Failed to save conversation after deleting message:', error)
      // Message is already removed from state, so continue
    }
  }

  // Working directory management
  const getWorkingDirectory = (conversationId) => {
    const conversation = conversations.find(c => c.id === conversationId)
    return conversation?.workingDirectory || null
  }

  const updateWorkingDirectory = async (conversationId, newDirectory, type = 'linked') => {
    const conversation = conversations.find(c => c.id === conversationId)
    if (!conversation) return

    const updated = {
      ...conversation,
      workingDirectory: {
        type,
        path: newDirectory
      },
      updatedAt: new Date().toISOString()
    }

    // Update state
    setConversations(prev =>
      prev.map(c => c.id === conversationId ? updated : c)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    )

    // Save to storage
    try {
      await conversationStorage.save(updated)

      // If OpenCode session exists, recreate with new directory
      if (window.electronAPI?.opencode) {
        const status = await window.electronAPI.opencode.getSessionStatus(conversationId)
        if (status.exists) {
          console.log('🔵 Recreating OpenCode session with new directory')
          await window.electronAPI.opencode.deleteSession(conversationId)
        }
      }
    } catch (error) {
      console.error('Failed to update working directory:', error)
    }
  }

  const unlinkWorkingDirectory = async (conversationId) => {
    const appDataPath = await window.electronAPI.getAppDataPath()
    // Use consistent path separators
    const isolatedPath = isElectron()
      ? `${appDataPath}\\userfiles\\workspaces\\${conversationId}`
      : `${appDataPath}/userfiles/workspaces/${conversationId}`

    await updateWorkingDirectory(conversationId, isolatedPath, 'isolated')
  }

  const value = {
    conversations,
    currentConversationId,
    messages,
    isLoading,
    streamingConversationIds,
    isConversationStreaming,
    startStreaming,
    stopStreaming,
    getAbortSignal,
    addMessage,
    updateLastMessage,
    updateLastMessageReasoning,
    markReasoningComplete,
    updateConversationTitle,
    deleteConversation,
    selectConversation,
    startNewConversation,
    getCurrentConversation,
    getConversationById,
    replaceMessages,
    deleteMessage,
    // Working directory
    getWorkingDirectory,
    updateWorkingDirectory,
    unlinkWorkingDirectory,
    // OpenCode activity
    addOpencodeEvent,
    setOpencodeStatus,
    clearOpencodeActivity,
    getOpencodeActivity,
    setOpencodeProcessingText,
    setOpencodePendingPermission
  }

  return (
    <ConversationContext.Provider value={value}>
      {children}
    </ConversationContext.Provider>
  )
}

export function useConversation() {
  const context = useContext(ConversationContext)
  if (!context) {
    throw new Error('useConversation must be used within a ConversationProvider')
  }
  return context
}
