/**
 * Application constants.
 * Centralized definitions for all magic numbers and configuration defaults.
 * @module constants
 */

// ==================== Cache Constants ====================

/**
 * File cache TTL in milliseconds.
 * @type {number}
 */
export const FILE_CACHE_TTL = 5000;

/**
 * File save delay for debouncing (ms).
 * @type {number}
 */
export const FILE_SAVE_DELAY = 1000;

/**
 * Quota cache TTL (ms) - 5 minutes.
 * @type {number}
 */
export const QUOTA_CACHE_TTL = 5 * 60 * 1000;

/**
 * Quota cleanup interval (ms) - 1 hour.
 * @type {number}
 */
export const QUOTA_CLEANUP_INTERVAL = 60 * 60 * 1000;

/**
 * Model list cache default TTL (ms) - 1 hour.
 * @type {number}
 */
export const MODEL_LIST_CACHE_TTL = 60 * 60 * 1000;

// ==================== Memory Management Constants ====================

/**
 * Memory pressure thresholds are dynamically calculated by memoryManager
 * based on user-configured memoryThreshold (MB):
 * - LOW: 30% of threshold
 * - MEDIUM: 60% of threshold
 * - HIGH: 100% of threshold (user-configured value)
 * - TARGET: 50% of threshold
 */

/**
 * GC cooldown period (ms).
 * @type {number}
 */
export const GC_COOLDOWN = 10000;

/**
 * Default memory check interval (ms).
 * @type {number}
 */
export const MEMORY_CHECK_INTERVAL = 30000;

// ==================== Server Constants ====================

/**
 * Default heartbeat interval (ms).
 * @type {number}
 */
export const DEFAULT_HEARTBEAT_INTERVAL = 15000;

/**
 * Default server port.
 * @type {number}
 */
export const DEFAULT_SERVER_PORT = 8045;

/**
 * Default server host.
 * @type {string}
 */
export const DEFAULT_SERVER_HOST = '0.0.0.0';

/**
 * Default request timeout (ms).
 * @type {number}
 */
export const DEFAULT_TIMEOUT = 300000;

/**
 * Default retry count.
 * @type {number}
 */
export const DEFAULT_RETRY_TIMES = 3;

/**
 * Default max request body size.
 * @type {string}
 */
export const DEFAULT_MAX_REQUEST_SIZE = '50mb';

// ==================== Token Rotation Constants ====================

/**
 * Default request count per token before rotation.
 * @type {number}
 */
export const DEFAULT_REQUEST_COUNT_PER_TOKEN = 50;

/**
 * Token refresh buffer time (ms) - 5 minutes before expiry.
 * @type {number}
 */
export const TOKEN_REFRESH_BUFFER = 300000;

// ==================== Generation Parameter Defaults ====================

/**
 * Default generation parameters for AI models.
 */
export const DEFAULT_GENERATION_PARAMS = {
  temperature: 1,
  top_p: 0.85,
  top_k: 50,
  max_tokens: 32000,
  thinking_budget: 1024
};

/**
 * Mapping from reasoning_effort to thinkingBudget.
 */
export const REASONING_EFFORT_MAP = {
  low: 1024,
  medium: 16000,
  high: 32000
};

// ==================== Image Constants ====================

/**
 * Default maximum retained images.
 * @type {number}
 */
export const DEFAULT_MAX_IMAGES = 10;

/**
 * MIME type to file extension mapping.
 */
export const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

// ==================== Stop Sequences ====================

/**
 * Default stop sequences for generation.
 * @type {string[]}
 */
export const DEFAULT_STOP_SEQUENCES = [
  '<|user|>',
  '<|bot|>',
  '<|context_request|>',
  '<|endoftext|>',
  '<|end_of_turn|>'
];

// ==================== Admin Configuration ====================

/**
 * Note: Admin credentials (username, password, JWT secret) are now
 * auto-generated with random values by config.ts if not configured.
 * Generated credentials are displayed in the console on startup.
 * No hardcoded default values are used for security reasons.
 */