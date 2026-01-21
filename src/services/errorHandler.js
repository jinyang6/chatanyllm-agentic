/**
 * Unified error handler for streaming chat adapters
 * Provides consistent error transformation and reporting across all providers
 */

import { ERROR_MESSAGES } from '@/config/constants'

/**
 * Error types for categorization
 */
export const ErrorType = {
  AUTHENTICATION: 'authentication',
  RATE_LIMIT: 'rate_limit',
  NOT_FOUND: 'not_found',
  FORBIDDEN: 'forbidden',
  SERVER_ERROR: 'server_error',
  NETWORK_ERROR: 'network_error',
  VALIDATION_ERROR: 'validation_error',
  ABORT_ERROR: 'abort_error',
  UNKNOWN: 'unknown'
}

/**
 * Streaming error handler class
 * Normalizes errors from different providers into a consistent format
 */
export class StreamingErrorHandler {
  constructor(onError, providerName = 'API') {
    this.onError = onError
    this.providerName = providerName
  }

  /**
   * Handle HTTP response errors
   * @param {Response} response - Fetch Response object
   * @param {Object} errorData - Parsed error data from response
   * @returns {Error} Normalized error object
   */
  handleHttpError(response, errorData = {}) {
    const status = response.status
    let errorMessage
    let errorType

    switch (status) {
      case 401:
        errorType = ErrorType.AUTHENTICATION
        errorMessage = errorData.error?.message ||
                      errorData.message ||
                      'Invalid API key or unauthorized access.'
        break

      case 403:
        errorType = ErrorType.FORBIDDEN
        errorMessage = errorData.error?.message ||
                      errorData.message ||
                      'Access forbidden. Check your API key permissions.'
        break

      case 404:
        errorType = ErrorType.NOT_FOUND
        errorMessage = errorData.error?.message ||
                      errorData.message ||
                      'Model or endpoint not found.'
        break

      case 429:
        errorType = ErrorType.RATE_LIMIT
        const retryAfter = response.headers.get('retry-after')
        const waitTime = retryAfter ? ` Please wait ${retryAfter} seconds.` : ''
        errorMessage = `Rate limit exceeded.${waitTime}`
        break

      case 500:
      case 502:
      case 503:
      case 504:
        errorType = ErrorType.SERVER_ERROR
        errorMessage = errorData.error?.message ||
                      errorData.message ||
                      `Server error (${status}). Please try again later.`
        break

      default:
        errorType = ErrorType.UNKNOWN
        errorMessage = errorData.error?.message ||
                      errorData.message ||
                      `HTTP ${status}: ${response.statusText}`
    }

    const error = new Error(errorMessage)
    error.type = errorType
    error.status = status
    error.provider = this.providerName
    error.originalError = errorData

    return error
  }

  /**
   * Handle streaming errors (parse errors, network issues, etc.)
   * @param {Error} error - Original error object
   * @param {Object} context - Additional context about where the error occurred
   * @returns {Error} Normalized error object
   */
  handleStreamingError(error, context = {}) {
    let normalizedError

    // Check if already normalized
    if (error.type && error.provider) {
      normalizedError = error
    } else {
      // Determine error type
      let errorType = ErrorType.UNKNOWN
      let errorMessage = error.message

      if (error.name === 'AbortError') {
        errorType = ErrorType.ABORT_ERROR
        errorMessage = 'Request was cancelled'
      } else if (error.message?.includes('Failed to fetch') ||
                 error.message?.includes('NetworkError') ||
                 error.message?.includes('network')) {
        errorType = ErrorType.NETWORK_ERROR
        errorMessage = 'Network error. Please check your connection.'
      } else if (error.message?.includes('JSON') ||
                 error.message?.includes('parse')) {
        errorType = ErrorType.VALIDATION_ERROR
        errorMessage = 'Invalid response format from API'
      } else if (error.message?.includes('Invalid')) {
        errorType = ErrorType.VALIDATION_ERROR
      }

      normalizedError = new Error(errorMessage)
      normalizedError.type = errorType
      normalizedError.provider = this.providerName
      normalizedError.originalError = error
      normalizedError.context = context
    }

    // Log error with context
    console.error(
      `[${this.providerName}] Streaming error:`,
      normalizedError.message,
      context
    )

    // Call error callback if provided
    if (this.onError) {
      this.onError(normalizedError)
    }

    return normalizedError
  }

  /**
   * Validate parameters before making API request
   * @param {Object} params - Parameters to validate
   * @throws {Error} Validation error if parameters are invalid
   */
  validateParameters(params) {
    const { apiKey, model, messages, baseUrl } = params

    if (!apiKey || typeof apiKey !== 'string') {
      const error = new Error('Invalid or missing API key')
      error.type = ErrorType.VALIDATION_ERROR
      throw error
    }

    if (!model || typeof model !== 'string') {
      const error = new Error('Invalid or missing model')
      error.type = ErrorType.VALIDATION_ERROR
      throw error
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      const error = new Error('Messages must be a non-empty array')
      error.type = ErrorType.VALIDATION_ERROR
      throw error
    }

    if (baseUrl && (typeof baseUrl !== 'string' || !baseUrl.trim())) {
      const error = new Error('Invalid base URL')
      error.type = ErrorType.VALIDATION_ERROR
      throw error
    }
  }

  /**
   * Safe error callback - prevents errors in error handlers
   * @param {Error} error - Error to report
   */
  safeErrorCallback(error) {
    try {
      if (this.onError) {
        this.onError(error)
      }
    } catch (callbackError) {
      console.error('[ErrorHandler] Error in onError callback:', callbackError)
    }
  }
}

/**
 * Create an error handler for a specific provider
 * @param {Function} onError - Error callback function
 * @param {string} providerName - Name of the provider
 * @returns {StreamingErrorHandler} Error handler instance
 */
export function createErrorHandler(onError, providerName) {
  return new StreamingErrorHandler(onError, providerName)
}

/**
 * Check if an error is retryable
 * @param {Error} error - Error to check
 * @returns {boolean} True if error is retryable
 */
export function isRetryableError(error) {
  return [
    ErrorType.RATE_LIMIT,
    ErrorType.SERVER_ERROR,
    ErrorType.NETWORK_ERROR
  ].includes(error.type)
}

/**
 * Get user-friendly error message
 * @param {Error} error - Error object
 * @returns {string} User-friendly message
 */
export function getUserFriendlyMessage(error) {
  if (!error.type) {
    return error.message
  }

  switch (error.type) {
    case ErrorType.AUTHENTICATION:
      return 'Authentication failed. Please check your API key.'
    case ErrorType.RATE_LIMIT:
      return error.message // Already has retry info
    case ErrorType.NOT_FOUND:
      return 'The requested model or resource was not found.'
    case ErrorType.FORBIDDEN:
      return 'Access denied. Check your API key permissions.'
    case ErrorType.SERVER_ERROR:
      return 'Server error. Please try again in a moment.'
    case ErrorType.NETWORK_ERROR:
      return 'Network error. Please check your internet connection.'
    case ErrorType.ABORT_ERROR:
      return 'Request was cancelled.'
    case ErrorType.VALIDATION_ERROR:
      return error.message
    default:
      return error.message || 'An unexpected error occurred.'
  }
}
