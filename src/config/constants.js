/**
 * Application-wide configuration constants
 * Centralized location for magic numbers and configuration values
 */

// Compaction Configuration
export const COMPACTION_CONFIG = {
  // Auto-compaction triggers
  MESSAGE_THRESHOLD: 40,        // Trigger compaction after this many messages
  TOKEN_THRESHOLD: 60000,       // Trigger compaction after this many tokens
  KEEP_LAST_MESSAGES: 15,       // Keep this many recent messages uncompacted

  // Manual compaction
  MANUAL_KEEP_LAST: 2,          // Keep only last 2 messages for manual compaction
  MIN_MESSAGES_FOR_COMPACTION: 3 // Minimum messages required to compact
}

// UI Configuration
export const UI_CONFIG = {
  // Message display
  MESSAGE_COLLAPSE_THRESHOLD: 500, // Character count to trigger message collapse

  // Performance
  SCROLL_DEBOUNCE_MS: 100,         // Debounce delay for scroll events
  STREAMING_THROTTLE_MS: 50,       // Throttle delay for streaming updates

  // Animations
  TOOLTIP_DELAY_MS: 300            // Delay before showing tooltips
}

// File Paths
export const PATHS = {
  USER_FILES: 'userfiles',
  WORKSPACES: 'userfiles/workspaces',

  /**
   * Get workspace path for a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {string} Workspace path
   */
  getWorkspacePath: (conversationId) => `userfiles/workspaces/${conversationId}`,

  /**
   * Get isolated workspace path for a conversation
   * @param {string} appDataPath - App data path
   * @param {string} conversationId - Conversation ID
   * @returns {string} Isolated workspace path
   */
  getIsolatedWorkspacePath: (appDataPath, conversationId) =>
    `${appDataPath}\\userfiles\\workspaces\\conversationId}`
}

// Model Configuration
export const MODEL_CONFIG = {
  // Model capabilities
  DEFAULT_CONTEXT_WINDOW: 4096,
  MAX_OUTPUT_TOKENS: 4096,

  // Pricing tiers (for future use)
  TIER_FREE: 'free',
  TIER_PAID: 'paid',
  TIER_PREMIUM: 'premium'
}

// API Configuration
export const API_CONFIG = {
  // Timeouts
  DEFAULT_TIMEOUT_MS: 30000,      // 30 seconds
  STREAMING_TIMEOUT_MS: 120000,   // 2 minutes

  // Retry configuration
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  RETRY_BACKOFF_MULTIPLIER: 2
}

// Workspace Configuration
export const WORKSPACE_CONFIG = {
  // Workspace types
  TYPE_ISOLATED: 'isolated',
  TYPE_LINKED: 'linked',

  // Display names
  SAFE_WORKSPACE_NAME: 'Safe Workspace',
  DEFAULT_PROJECT_NAME: 'Project'
}

// Message Configuration
export const MESSAGE_CONFIG = {
  // Message roles
  ROLE_USER: 'user',
  ROLE_ASSISTANT: 'assistant',
  ROLE_SYSTEM: 'system',

  // Message types
  TYPE_COMPACTION: 'compaction',
  TYPE_REGULAR: 'regular'
}

// Error Messages
export const ERROR_MESSAGES = {
  NO_API_KEY: 'API key not configured',
  INVALID_API_KEY: 'Invalid API key',
  NETWORK_ERROR: 'Network error occurred',
  TIMEOUT: 'Request timed out',
  UNKNOWN: 'An unknown error occurred'
}

// Feature Flags (for gradual rollout)
export const FEATURE_FLAGS = {
  ENABLE_AUTO_COMPACTION: true,
  ENABLE_OPENCODE: true,
  ENABLE_IMAGE_GENERATION: true,
  ENABLE_THINKING_MODELS: true
}
