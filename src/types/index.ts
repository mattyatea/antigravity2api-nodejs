/**
 * Core type definitions for the application.
 * @module types
 */

// ==================== Token Types ====================

/**
 * Token data structure for authentication.
 */
export interface TokenData {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    timestamp: number;
    enable?: boolean;
    projectId?: string;
    email?: string;
    hasQuota?: boolean;
    sessionId?: string;
}

/**
 * Token rotation strategy types.
 */
export const RotationStrategy = {
    /** Switch token on every request for load balancing */
    ROUND_ROBIN: 'round_robin',
    /** Switch token when quota is exhausted */
    QUOTA_EXHAUSTED: 'quota_exhausted',
    /** Switch token after custom request count */
    REQUEST_COUNT: 'request_count'
} as const;

export type RotationStrategyType = typeof RotationStrategy[keyof typeof RotationStrategy];

// ==================== API Types ====================

/**
 * Stream response state for tracking parsing progress.
 */
export interface StreamState {
    toolCalls: ToolCall[];
    reasoningSignature: string | null;
    sessionId?: string;
    model?: string;
}

/**
 * Tool call structure (OpenAI format).
 */
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
    thoughtSignature?: string;
}

/**
 * Usage metadata for token counting.
 */
export interface UsageData {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

/**
 * Generation configuration parameters.
 */
export interface GenerationConfig {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    thinkingConfig?: {
        thinkingBudget: number;
    };
    stopSequences?: string[];
}

/**
 * Normalized request parameters.
 */
export interface NormalizedParameters {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    max_tokens?: number;
    thinking_budget?: number;
}

// ==================== Server Types ====================

/**
 * Server configuration.
 */
export interface ServerConfig {
    port: number;
    host: string;
    heartbeatInterval: number;
    memoryThreshold: number;
}

/**
 * API configuration.
 */
export interface ApiConfig {
    url: string;
    modelsUrl: string;
    noStreamUrl: string;
    host: string;
    userAgent: string;
}

/**
 * Default generation parameters.
 */
export interface DefaultsConfig {
    temperature: number;
    top_p: number;
    top_k: number;
    max_tokens: number;
    thinking_budget: number;
}

/**
 * Security configuration.
 */
export interface SecurityConfig {
    maxRequestSize: string;
    apiKey: string | null;
}

/**
 * Admin credentials configuration.
 */
export interface AdminConfig {
    username: string;
    password: string;
    jwtSecret: string;
}

/**
 * Complete application configuration.
 */
export interface AppConfig {
    server: ServerConfig;
    cache: { modelListTTL: number };
    rotation: { strategy: string; requestCount: number };
    imageBaseUrl: string | null;
    maxImages: number;
    api: ApiConfig;
    defaults: DefaultsConfig;
    security: SecurityConfig;
    admin: AdminConfig;
    useNativeAxios: boolean;
    timeout: number;
    retryTimes: number;
    proxy: string | null;
    systemInstruction: string;
    skipProjectIdFetch: boolean;
    useContextSystemPrompt: boolean;
    passSignatureToClient: boolean;
}

// ==================== Memory Types ====================

/**
 * Memory pressure levels.
 */
export enum MemoryPressure {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    CRITICAL = 'critical'
}

/**
 * Pool size configuration for object pooling.
 */
export interface PoolSizes {
    chunk: number;
    lineBuffer: number;
    toolCall: number;
}

// ==================== Error Types ====================

/**
 * API error with status code.
 */
export interface ApiErrorOptions {
    message: string;
    statusCode: number;
    body?: any;
}

/**
 * Token-specific error.
 */
export interface TokenErrorOptions {
    message: string;
    tokenSuffix: string | null;
    statusCode: number;
}
