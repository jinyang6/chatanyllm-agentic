/**
 * Client-side conversation compaction utilities
 * Manages conversation history to prevent context overflow
 */

/**
 * Estimate token count for messages (approximate)
 * Rule of thumb: 1 token ≈ 4 characters
 */
export function estimateTokens(messages) {
  let totalChars = 0

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length
    } else if (Array.isArray(msg.content)) {
      // Multimodal - count text parts only
      msg.content.forEach(part => {
        if (part.type === 'text') {
          totalChars += part.text.length
        }
      })
    }

    // Add reasoning tokens if present
    if (msg.reasoning) {
      totalChars += msg.reasoning.length
    }
  }

  return Math.ceil(totalChars / 4)
}

/**
 * Check if compaction is needed
 */
export function shouldCompact(messages, options = {}) {
  const { messageThreshold = 40, tokenThreshold = 60000 } = options

  // Check message count
  if (messages.length >= messageThreshold) {
    return { needed: true, reason: 'message_count', value: messages.length }
  }

  // Check token count
  const tokens = estimateTokens(messages)
  if (tokens >= tokenThreshold) {
    return { needed: true, reason: 'token_count', value: tokens }
  }

  return { needed: false }
}

/**
 * Create summarization prompt for LLM following Claude best practices
 */
export function createSummaryPrompt(messages) {
  // Format conversation for summarization
  const conversationText = messages.map((msg, idx) => {
    const role = msg.role === 'user' ? 'User' : 'Assistant'
    const content = typeof msg.content === 'string'
      ? msg.content
      : '[multimodal message]'

    return `[Message ${idx + 1}]\nRole: ${role}\nContent: ${content}`
  }).join('\n\n---\n\n')

  return `You are tasked with compacting a conversation history. Create a concise summary that preserves essential context for future interactions.

<conversation_to_compact>
${conversationText}
</conversation_to_compact>

Instructions:
1. Summarize the key topics, decisions, and outcomes
2. Preserve technical details: file paths, function names, variable names, error messages
3. Note any files created, modified, or deleted with full paths
4. Include important code snippets or configurations discussed
5. Retain unresolved issues or ongoing tasks
6. Keep the summary under 400 tokens while maintaining clarity

Format your response as a clear, structured summary that will serve as conversation context. Do not include meta-commentary about the summarization task itself.`
}

/**
 * Perform compaction on messages
 * @param {Array} messages - All messages in conversation
 * @param {Function} summarizeFn - Async function that calls LLM to summarize
 * @param {Object} options - Compaction options
 * @returns {Object} - { compactedMessages, summary, stats }
 */
export async function compactConversation(messages, summarizeFn, options = {}) {
  const { keepLast = 15 } = options

  // Split messages
  const messagesToKeep = messages.slice(-keepLast)
  const messagesToSummarize = messages.slice(0, -keepLast)

  if (messagesToSummarize.length === 0) {
    return {
      compactedMessages: messages,
      summary: null,
      stats: { compacted: 0, kept: messages.length }
    }
  }

  // Create summary prompt
  const summaryPrompt = createSummaryPrompt(messagesToSummarize)

  // Call LLM to summarize
  const summary = await summarizeFn(summaryPrompt)

  // Create compaction message
  const compactionMessage = {
    id: `compact_${Date.now()}`,
    role: 'system',
    type: 'compaction',
    content: summary,
    timestamp: new Date().toISOString(),
    compactedCount: messagesToSummarize.length,
    compactedRange: {
      from: 1,
      to: messagesToSummarize.length
    }
  }

  // Return compacted conversation
  return {
    compactedMessages: [compactionMessage, ...messagesToKeep],
    summary,
    stats: {
      compacted: messagesToSummarize.length,
      kept: messagesToKeep.length,
      totalBefore: messages.length,
      totalAfter: messagesToKeep.length + 1
    }
  }
}

/**
 * Auto-compaction wrapper
 * Checks if compaction needed and performs it
 */
export async function autoCompact(messages, summarizeFn, options = {}) {
  const check = shouldCompact(messages, options)

  if (!check.needed) {
    return { compacted: false, messages }
  }

  // console.log(`🗜️ Auto-compaction triggered (${check.reason}: ${check.value})`)

  const result = await compactConversation(messages, summarizeFn, options)

  // console.log(`✓ Compacted ${result.stats.compacted} messages → ${result.stats.totalAfter} total`)

  return {
    compacted: true,
    messages: result.compactedMessages,
    summary: result.summary,
    stats: result.stats
  }
}
