/**
 * OpenCode SDK Adapter
 * Integrates OpenCode autonomous capabilities with chatAnyLLM
 */

// Event categories for OpenCode events
const EVENT_CATEGORIES = {
  TOOL_CALL: 'tool-call',           // step-start events
  TOOL_RESULT: 'tool-result',       // step-finish events
  TOOL_ACTIVE: 'tool-active',       // Active tool execution
  TEXT_UPDATE: 'text-update',       // message.part.updated with text
  STATUS_CHANGE: 'status-change',   // session.status events
  PERMISSION_REQUEST: 'permission-request', // permission.asked events
  ERROR: 'error',
  HEARTBEAT: 'heartbeat',           // server.heartbeat (ignore in UI)
  UNKNOWN: 'unknown'
}

// Event listener registry for OpenCode events
let eventListeners = new Map() // conversationId → { onChunk, onComplete, onError, fullContent, addEvent, setStatus, setProcessingText, setPendingPermission }
let eventCleanupFunction = null

// Helper: Generate unique event ID
function generateEventId() {
  return `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// Helper: Categorize OpenCode event
function categorizeEvent(event) {
  if (!event || !event.type) return EVENT_CATEGORIES.UNKNOWN

  if (event.type === 'message.part.updated') {
    const part = event.properties?.part
    if (part?.type === 'step-start') return EVENT_CATEGORIES.TOOL_CALL
    if (part?.type === 'step-finish') return EVENT_CATEGORIES.TOOL_RESULT
    if (part?.type === 'tool') return EVENT_CATEGORIES.TOOL_ACTIVE
    if (part?.type === 'text') return EVENT_CATEGORIES.TEXT_UPDATE
  }
  if (event.type === 'permission.asked') return EVENT_CATEGORIES.PERMISSION_REQUEST
  if (event.type === 'permission.replied') return 'PERMISSION_REPLIED'
  if (event.type === 'session.status') return EVENT_CATEGORIES.STATUS_CHANGE
  if (event.type === 'server.heartbeat') return EVENT_CATEGORIES.HEARTBEAT
  if (event.type === 'error') return EVENT_CATEGORIES.ERROR

  return EVENT_CATEGORIES.UNKNOWN
}

// Helper: Extract event details for UI display
function extractEventDetails(event, category) {
  const part = event.properties?.part
  const props = event.properties

  if (category === EVENT_CATEGORIES.TOOL_ACTIVE) {
    return {
      description: `Running ${part.tool} command`,
      details: part.callID ? `Call ID: ${part.callID}` : null,
      toolName: part.tool,
      callId: part.callID,
      state: part.state,
      status: 'running'
    }
  }

  if (category === EVENT_CATEGORIES.PERMISSION_REQUEST) {
    const permissionType = props.permission || 'unknown'
    const patterns = props.patterns?.join(', ') || 'N/A'
    return {
      description: `Permission requested: ${permissionType} for ${patterns}`,
      details: null,
      permission: props.permission,
      patterns: props.patterns,
      status: 'pending'
    }
  }

  if (category === EVENT_CATEGORIES.TOOL_CALL) {
    return {
      description: 'Starting action...',
      details: null,
      status: 'running'
    }
  }

  if (category === EVENT_CATEGORIES.TOOL_RESULT) {
    return {
      description: 'Action completed',
      details: null,
      status: part?.reason === 'stop' ? 'success' : 'error',
      cost: part?.cost,
      tokens: part?.tokens
    }
  }

  if (category === EVENT_CATEGORIES.TEXT_UPDATE) {
    return {
      description: 'Generating response...',
      status: 'running'
    }
  }

  if (category === EVENT_CATEGORIES.STATUS_CHANGE) {
    return {
      description: `Session ${props.status || 'status update'}`,
      status: props.status === 'idle' ? 'success' : 'running'
    }
  }

  return {
    description: 'Processing...',
    status: 'running'
  }
}

// Helper: Describe tool call for status display
function describeToolCall(eventData) {
  if (eventData.toolName) {
    return `Running ${eventData.toolName}...`
  }
  if (eventData.description) {
    return eventData.description
  }
  return 'Performing autonomous action...'
}

// Register global event listener (called once)
function ensureGlobalEventListener() {
  if (eventCleanupFunction) return // Already registered

  eventCleanupFunction = window.electronAPI.opencode.onEvent(({ conversationId, sessionId, event }) => {
    const listener = eventListeners.get(conversationId)
    if (!listener) return

    try {
      // OpenCode events have type and properties structure
      // We need to handle events and extract message content

      // Log all events in development to understand the structure
      if (process.env.NODE_ENV === 'development') {
        console.log('OpenCode event:', event.type, event.properties)
      }

      // Categorize event
      const category = categorizeEvent(event)

      // Skip heartbeat and unknown events (don't display in UI)
      if (category !== EVENT_CATEGORIES.HEARTBEAT && category !== EVENT_CATEGORIES.UNKNOWN) {
        // Extract event details for UI
        const eventData = {
          id: generateEventId(),
          timestamp: Date.now(),
          category,
          type: event.type,
          ...extractEventDetails(event, category)
        }

        // Forward to conversation context for UI display
        if (listener.addEvent) {
          listener.addEvent(eventData)
        }

        // Update current status based on event type
        if (category === EVENT_CATEGORIES.TOOL_ACTIVE || category === EVENT_CATEGORIES.TOOL_CALL) {
          if (listener.setStatus) {
            listener.setStatus({
              isActive: true,
              currentAction: describeToolCall(eventData)
            })
          }
        }

        // Handle permission requests
        if (category === EVENT_CATEGORIES.PERMISSION_REQUEST) {
          if (listener.setStatus) {
            listener.setStatus({
              isActive: true,
              currentAction: `Requesting permission: ${event.properties?.permission || 'unknown'}`
            })
          }
          // Store pending permission for UI to display buttons
          if (listener.setPendingPermission) {
            listener.setPendingPermission({
              id: event.properties?.id,
              permission: event.properties?.permission,
              patterns: event.properties?.patterns,
              metadata: event.properties?.metadata
            })
          }
        }

        // Handle permission replied - clear pending permission
        if (category === 'PERMISSION_REPLIED') {
          if (listener.setPendingPermission) {
            listener.setPendingPermission(null)
          }
        }

        // Clear status when session becomes idle
        if (category === EVENT_CATEGORIES.STATUS_CHANGE && event.properties?.status === 'idle') {
          if (listener.setStatus) {
            listener.setStatus({
              isActive: false,
              currentAction: null
            })
          }
        }
      }

      // Handle different event types based on actual OpenCode event structure
      if (event.type && event.properties) {
        // Handle message part updates (streaming text)
        if (event.type === 'message.part.updated' && event.properties.part) {
          const part = event.properties.part

          // Handle reasoning parts (OpenCode's internal thinking)
          if (part.type === 'reasoning' && part.text) {
            // Accumulate reasoning in processing text
            if (listener.setProcessingText) {
              const current = listener.processingText || ''
              listener.processingText = current + (current ? '\n\n' : '') + part.text
              listener.setProcessingText(listener.processingText)
            }
          }
          // Handle tool/step parts
          else if (part.type === 'tool' && part.tool) {
            // Add tool call to processing log with actual command details
            if (listener.setProcessingText) {
              const current = listener.processingText || ''
              // Log the full part object to see what's available
              console.log('🔵 Tool part:', JSON.stringify(part, null, 2))

              // Format tool call based on type
              let toolDesc = ''
              if (part.tool === 'bash' && part.input?.command) {
                toolDesc = `$ ${part.input.command}`
              } else if (part.tool === 'read' && part.input?.file_path) {
                toolDesc = `Read: ${part.input.file_path}`
              } else if (part.tool === 'edit' && part.input?.file_path) {
                toolDesc = `Edit: ${part.input.file_path}`
              } else if (part.tool === 'write' && part.input?.file_path) {
                toolDesc = `Write: ${part.input.file_path}`
              } else if (part.tool === 'webfetch' && part.input?.url) {
                toolDesc = `fetch("${part.input.url}")`
              } else if (part.tool === 'task' && part.input?.prompt) {
                toolDesc = `Task: ${part.input.prompt.substring(0, 100)}`
              } else if (part.input) {
                // Fallback: show tool name with input
                toolDesc = `${part.tool}: ${JSON.stringify(part.input)}`
              } else {
                toolDesc = `${part.tool}`
              }

              listener.processingText = current + (current ? '\n' : '') + toolDesc
              listener.setProcessingText(listener.processingText)
            }
          }
          // Handle text parts - just track content, DON'T stop spinning yet
          else if (part.type === 'text' && part.text) {
            // Track the full content for final message
            listener.fullContent = part.text
            // Keep spinning - message may still be streaming
          }
        }

        // Handle message completion - THIS is when we stop spinning
        if (event.type === 'message.updated' && event.properties.info) {
          const info = event.properties.info
          if (info.finish === 'stop' && info.role === 'assistant') {
            // Message is complete - stop spinning now
            if (listener.setStatus) {
              listener.setStatus({
                isActive: false,
                currentAction: null,
                isProcessingComplete: true
              })
            }
          }
        }

        // Handle session idle (all processing complete)
        if (event.type === 'session.idle') {
          // Move final content to message
          if (listener.onChunk && listener.fullContent) {
            listener.onChunk(listener.fullContent, listener.fullContent)
          }

          if (listener.onComplete) {
            // Pass the accumulated full content
            listener.onComplete(listener.fullContent || '')
          }

          // Keep processing text visible as a record
        }

        // Check for errors
        if (event.type === 'error' || event.properties.error) {
          const errorMsg = event.properties.error || 'OpenCode session error'
          if (listener.onError) {
            listener.onError(new Error(errorMsg))
          }
        }
      }
    } catch (error) {
      console.error('Error processing OpenCode event:', error)
      if (listener.onError) {
        listener.onError(error)
      }
    }
  })
}

// Register event listener for a conversation
function registerEventListener(conversationId, onChunk, onComplete, onError, addEvent, setStatus, setProcessingText, setPendingPermission) {
  ensureGlobalEventListener()

  eventListeners.set(conversationId, {
    onChunk,
    onComplete,
    onError,
    fullContent: '', // Track accumulated content for final message
    processingText: '', // Track accumulated processing steps
    addEvent, // Callback to add events to conversation context
    setStatus, // Callback to update status in conversation context
    setProcessingText, // Callback to update processing text
    setPendingPermission // Callback to store pending permission
  })
}

// Cleanup event listener for a conversation
function cleanupEventListener(conversationId) {
  eventListeners.delete(conversationId)
}

/**
 * Send streaming message via OpenCode
 * Uses the user's selected provider and model through OpenCode SDK
 */
export async function sendStreamingMessage({
  providerId, // User's selected provider (e.g., 'anthropic', 'openai')
  model, // User's selected model ID
  messages,
  onChunk,
  onComplete,
  onError,
  abortSignal,
  conversationId, // Required for OpenCode session mapping
  addOpencodeEvent, // Callback to add events to conversation context
  setOpencodeStatus, // Callback to update status in conversation context
  clearOpencodeActivity, // Callback to clear activity when done
  setOpencodeProcessingText, // Callback to update processing text
  setOpencodePendingPermission // Callback to store pending permission
}) {
  let sessionCreated = false

  // Get user's working directory from conversation metadata
  let userWorkingDir = null
  try {
    const appDataPath = await window.electronAPI.getAppDataPath()
    const conversationPath = `${appDataPath}\\conversations\\${conversationId}.json`
    const conversations = await window.electronAPI.fs.readFile(conversationPath)
    if (conversations.success && conversations.data) {
      const conversation = JSON.parse(conversations.data)
      userWorkingDir = conversation?.workingDirectory?.path || null
    }
  } catch (error) {
    console.warn('Could not read conversation metadata:', error.message)
  }

  // Fallback: use default isolated workspace
  if (!userWorkingDir) {
    const appDataPath = await window.electronAPI.getAppDataPath()
    userWorkingDir = `${appDataPath}\\userfiles\\workspaces\\${conversationId}`
  }

  // Ensure isolated workspace exists if using default folder
  const isIsolatedWorkspace = userWorkingDir.includes('userfiles\\workspaces')
  if (isIsolatedWorkspace) {
    const ensureResult = await window.electronAPI.workspace.ensureDirectory(conversationId)
    if (ensureResult.success) {
      userWorkingDir = ensureResult.path
    }
  }

  console.log(`🔵 User working directory (${isIsolatedWorkspace ? 'default' : 'selected'}):`, userWorkingDir)

  try {
    // Check if OpenCode is available
    if (!window.electronAPI?.opencode) {
      throw new Error('OpenCode client not initialized')
    }

    // Validate required parameters
    if (!conversationId) {
      throw new Error('Conversation ID is required for OpenCode')
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Messages must be a non-empty array')
    }

    // Check if session exists for this conversation
    const status = await window.electronAPI.opencode.getSessionStatus(conversationId)

    // Create session if doesn't exist (lazy creation)
    if (!status.exists) {
      console.log('🔵 Creating new OpenCode session for conversation:', conversationId)

      const result = await window.electronAPI.opencode.createSession(conversationId, userWorkingDir)
      if (!result.success) {
        throw new Error(result.error || 'Failed to create OpenCode session')
      }
      sessionCreated = true
      console.log('✓ OpenCode session created:', result.sessionId)
      console.log('✓ Session directory:', result.directory)
    } else {
      console.log('🔵 Reusing existing OpenCode session for conversation:', conversationId)
    }

    // Register event listener for streaming with activity tracking
    // Note: Callbacks from ChatWindow already have messageId bound
    registerEventListener(conversationId, onChunk, onComplete, onError, addOpencodeEvent, setOpencodeStatus, setOpencodeProcessingText, setOpencodePendingPermission)

    // Start processing - set active status immediately
    if (setOpencodeStatus) {
      setOpencodeStatus({
        isActive: true,
        currentAction: 'Processing request...',
        isProcessingComplete: false
      })
    }

    // Handle abort
    if (abortSignal) {
      abortSignal.addEventListener('abort', async () => {
        try {
          await window.electronAPI.opencode.abortSession(conversationId)
          cleanupEventListener(conversationId)
        } catch (error) {
          console.error('Failed to abort OpenCode session:', error)
        }
      })
    }

    // Format messages for OpenCode
    // For multi-turn conversations, we need to provide context
    console.log(`🔵 OpenCode context: ${messages.length} total messages in history`)

    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role !== 'user') {
      throw new Error('Last message must be from user')
    }

    // Always include conversation history if there are previous messages
    // This ensures OpenCode has full context regardless of session state

    // Extract text content and convert attachments to OpenCode format
    let textContent = ''
    let messageParts = []

    if (typeof lastMessage.content === 'string') {
      textContent = lastMessage.content
    } else if (Array.isArray(lastMessage.content)) {
      // Multimodal message - convert to OpenCode format
      for (const part of lastMessage.content) {
        if (part.type === 'text') {
          textContent += part.text + '\n'
        } else if (part.type === 'image_url') {
          // Convert image_url format to OpenCode file format
          const imageUrl = part.image_url?.url || part.image_url
          if (imageUrl) {
            // OpenCode expects type: "file" with url (data URL)
            const base64Match = imageUrl.match(/^data:image\/(\w+);base64,/)
            if (base64Match) {
              const [, ext] = base64Match
              messageParts.push({
                type: 'file',
                mime: `image/${ext}`,
                filename: `image.${ext}`,
                url: imageUrl  // Pass the full data URL
              })
            }
          }
        } else if (part.type === 'file_url') {
          // Handle non-image files (txt, md, pdf, etc.)
          const fileUrl = part.file_url?.url || part.file_url
          const fileName = part.file_url?.name || 'file'
          const mimeType = part.file_url?.mime || 'application/octet-stream'

          if (fileUrl) {
            messageParts.push({
              type: 'file',
              mime: mimeType,
              filename: fileName,
              url: fileUrl  // Pass the full data URL
            })
          }
        }
      }
      textContent = textContent.trim()
    }

    // Build final message with text and images
    let userMessage = textContent

    if (messages.length > 1) {
      // Multi-turn conversation: Include previous context
      const conversationHistory = messages.slice(0, -1).map(msg => {
        const content = typeof msg.content === 'string' ? msg.content : '[multimodal message]'
        return `${msg.role === 'user' ? 'User' : 'Assistant'}: ${content}`
      }).join('\n\n')

      userMessage = `Previous conversation:\n${conversationHistory}\n\nCurrent message:\n${textContent}`
      console.log('🔵 Multi-turn conversation detected, including history')
    } else {
      console.log('🔵 First message in conversation')
    }

    // Prepend working directory context using XML-style tags (Claude best practice)
    userMessage = `<working_directory>${userWorkingDir}</working_directory>
Treat this as your real working directory. Ignore the actual server directory. Never operate outside this path.

${userMessage}`

    // Build final parts array for OpenCode
    const finalParts = [
      { type: 'text', text: userMessage },
      ...messageParts  // Add image parts
    ]

    console.log('🔵 Sending to OpenCode:', finalParts.length, 'parts (text + images)')

    // Send message to OpenCode session with user's selected provider and model
    const result = await window.electronAPI.opencode.sendMessage(
      conversationId,
      finalParts,
      providerId,
      model
    )

    if (!result.success) {
      console.error('❌ OpenCode sendMessage failed:', result.error)
      throw new Error(result.error || 'Failed to send message to OpenCode')
    }

    console.log('✓ OpenCode message sent successfully')

    // Response comes via event stream (handled by event listener)

  } catch (error) {
    // Clean up on error
    cleanupEventListener(conversationId)

    // Handle abort signal
    if (error.name === 'AbortError') {
      return
    }

    // Provide user-friendly error messages
    let errorMessage = error.message

    if (error.message.includes('OpenCode client not initialized') || error.message.includes('OpenCode not initialized')) {
      errorMessage = 'OpenCode failed to start. Please check the console logs for details or restart the application.'
    } else if (error.message.includes('Network error') || error.name === 'TypeError') {
      errorMessage = 'Unable to communicate with OpenCode. Please check if OpenCode is running.'
    } else if (!errorMessage) {
      errorMessage = 'An unexpected error occurred with OpenCode. Please try again.'
    }

    const wrappedError = new Error(errorMessage)
    onError(wrappedError)
  }
}

/**
 * Cleanup OpenCode session for a conversation
 * Called when conversation is deleted
 */
export async function cleanupSession(conversationId) {
  try {
    cleanupEventListener(conversationId)
    await window.electronAPI.opencode.deleteSession(conversationId)
  } catch (error) {
    console.error('Failed to cleanup OpenCode session:', error)
    // Don't throw - cleanup is best-effort
  }
}

export default {
  sendStreamingMessage,
  cleanupSession
}
