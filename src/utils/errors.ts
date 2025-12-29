/**
 * Unified Error Handling Module
 * @module utils/errors
 */

import { Context } from 'hono';

/**
 * Base Application Error Class
 */
export class AppError extends Error {
    statusCode: number;
    type: string;
    isOperational: boolean;

    constructor(message: string, statusCode: number = 500, type: string = 'server_error') {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.type = type;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Upstream API Error
 */
export class UpstreamApiError extends AppError {
    rawBody: any;
    retryAfterMs: number | null;
    isUpstreamApiError: boolean;

    constructor(message: string, statusCode: number, rawBody: any = null, retryAfterMs: number | null = null) {
        super(message, statusCode, 'upstream_api_error');
        this.name = 'UpstreamApiError';
        this.rawBody = rawBody;
        this.retryAfterMs = retryAfterMs;
        this.isUpstreamApiError = true;
    }
}

/**
 * Authentication Error
 */
export class AuthenticationError extends AppError {
    constructor(message: string = 'Authentication failed') {
        super(message, 401, 'authentication_error');
        this.name = 'AuthenticationError';
    }
}

/**
 * Authorization Error
 */
export class AuthorizationError extends AppError {
    constructor(message: string = 'Access denied') {
        super(message, 403, 'authorization_error');
        this.name = 'AuthorizationError';
    }
}

/**
 * Validation Error
 */
export class ValidationError extends AppError {
    details: any;

    constructor(message: string = 'Invalid request parameters', details: any = null) {
        super(message, 400, 'validation_error');
        this.name = 'ValidationError';
        this.details = details;
    }
}

/**
 * Resource Not Found Error
 */
export class NotFoundError extends AppError {
    constructor(message: string = 'Resource not found') {
        super(message, 404, 'not_found');
        this.name = 'NotFoundError';
    }
}

/**
 * Rate Limit Error
 */
export class RateLimitError extends AppError {
    retryAfter: number | null;

    constructor(message: string = 'Too many requests', retryAfter: number | null = null) {
        super(message, 429, 'rate_limit_error');
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}

/**
 * Token Related Error
 */
export class TokenError extends AppError {
    tokenSuffix: string | null;

    constructor(message: string, tokenSuffix: string | null = null, statusCode: number = 500) {
        super(message, statusCode, 'token_error');
        this.name = 'TokenError';
        this.tokenSuffix = tokenSuffix;
    }
}

/**
 * Create Upstream API Error (Factory Function)
 */
export function createApiError(message: string, status: number, rawBody: any, retryAfterMs: number | null = null) {
    return new UpstreamApiError(message, status, rawBody, retryAfterMs);
}

/**
 * Extract message from error object
 */
function extractErrorMessage(error: any): string {
    if (error.isUpstreamApiError && error.rawBody) {
        try {
            const raw = typeof error.rawBody === 'string' ? JSON.parse(error.rawBody) : error.rawBody;
            return raw.error?.message || raw.message || error.message;
        } catch { }
    }
    return error.message || 'Internal server error';
}

/**
 * Build OpenAI compatible error payload
 */
export function buildOpenAIErrorPayload(error: any, statusCode: number) {
    // Handle upstream API error
    if (error.isUpstreamApiError && error.rawBody) {
        try {
            const raw = typeof error.rawBody === 'string' ? JSON.parse(error.rawBody) : error.rawBody;
            const inner = raw.error || raw;
            return {
                error: {
                    message: inner.message || error.message || 'Upstream API error',
                    type: inner.type || 'upstream_api_error',
                    code: inner.code ?? statusCode
                }
            };
        } catch {
            return {
                error: {
                    message: error.rawBody || error.message || 'Upstream API error',
                    type: 'upstream_api_error',
                    code: statusCode
                }
            };
        }
    }

    // Handle application error
    if (error instanceof AppError) {
        return {
            error: {
                message: error.message,
                type: error.type,
                code: error.statusCode
            }
        };
    }

    // Handle general error
    return {
        error: {
            message: error.message || 'Internal server error',
            type: 'server_error',
            code: statusCode
        }
    };
}

/**
 * Build Gemini compatible error payload
 */
export function buildGeminiErrorPayload(error: any, statusCode: number) {
    // Map HTTP status codes to Gemini status strings
    const statusMap: Record<number, string> = {
        400: "INVALID_ARGUMENT",
        401: "UNAUTHENTICATED",
        403: "PERMISSION_DENIED",
        404: "NOT_FOUND",
        429: "RESOURCE_EXHAUSTED",
        499: "CANCELLED",
        500: "INTERNAL",
        501: "UNIMPLEMENTED",
        503: "UNAVAILABLE",
        504: "DEADLINE_EXCEEDED"
    };

    return {
        error: {
            code: statusCode,
            message: extractErrorMessage(error),
            status: statusMap[statusCode] || "INTERNAL"
        }
    };
}

/**
 * Build Claude compatible error payload
 */
export function buildClaudeErrorPayload(error: any, statusCode: number) {
    const errorType = statusCode === 401 ? "authentication_error" :
        statusCode === 403 ? "permission_error" :
            statusCode === 429 ? "rate_limit_error" :
                statusCode === 529 ? "overloaded_error" :
                    statusCode === 400 ? "invalid_request_error" :
                        statusCode === 404 ? "not_found_error" :
                            "api_error";

    return {
        type: "error",
        error: {
            type: errorType,
            message: extractErrorMessage(error)
        }
    };
}

/**
 * Hono error handling function
 */
export function safeHandleError(c: Context, err: any) {
    // Handle payload too large error
    if (err.type === 'entity.too.large') {
        return c.json({
            error: {
                message: 'Payload too large',
                type: 'payload_too_large',
                code: 413
            }
        }, 413);
    }

    // Determine status code
    // Hono error might have different properties, but checking standard ones
    const statusCode = err.status || err.statusCode || 500;

    // Build error response
    const errorPayload = buildOpenAIErrorPayload(err, statusCode);

    // Need to cast statusCode to Content status code which is ok in Hono usually if valid
    return c.json(errorPayload, statusCode as any);
}
