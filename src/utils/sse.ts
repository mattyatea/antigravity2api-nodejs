/**
 * SSE Streaming Response and Heartbeat Mechanism Utility Module - Hono Version
 */

import { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import config from '../config/index.js';
import logger from './logger.js';
import memoryManager, { registerMemoryPoolCleanup } from './memory-manager.js';
import { DEFAULT_HEARTBEAT_INTERVAL } from '../config/constants.js';

const HEARTBEAT_INTERVAL = config.server.heartbeatInterval || DEFAULT_HEARTBEAT_INTERVAL;

export const createResponseMeta = () => ({
    id: `chatcmpl-${Date.now()}`,
    created: Math.floor(Date.now() / 1000)
});

// Object Pool
const chunkPool: any[] = [];

export const getChunkObject = () => chunkPool.pop() || { choices: [{ index: 0, delta: {}, finish_reason: null }] };

export const releaseChunkObject = (obj: any) => {
    const sizes = memoryManager.getPoolSizes();
    const maxSize = sizes ? sizes.chunk : 100;
    if (chunkPool.length < maxSize) chunkPool.push(obj);
};

// Register cleanup
registerMemoryPoolCleanup(chunkPool, () => {
    const sizes = memoryManager.getPoolSizes();
    return sizes ? sizes.chunk : 100;
});

export const getChunkPoolSize = () => chunkPool.length;

export const clearChunkPool = () => {
    chunkPool.length = 0;
};

export const createStreamChunk = (id: string, created: number, model: string, delta: any, finish_reason: string | null = null, usage: any = null) => {
    const chunk = getChunkObject();
    chunk.id = id;
    chunk.object = 'chat.completion.chunk';
    chunk.created = created;
    chunk.model = model;
    chunk.choices[0].delta = delta;
    chunk.choices[0].finish_reason = finish_reason;

    // Add extended usage if provided (OpenAI API compatibility)
    if (usage) {
        chunk.usage = {
            prompt_tokens: usage.prompt_tokens || 0,
            completion_tokens: usage.completion_tokens || 0,
            total_tokens: usage.total_tokens || 0
        };
        // Add reasoning_tokens if present (for o3/reasoning models)
        if (usage.reasoning_tokens !== undefined) {
            chunk.usage.completion_tokens_details = {
                reasoning_tokens: usage.reasoning_tokens
            };
        }
        // Add cached_tokens if present (for prompt caching)
        if (usage.cached_tokens !== undefined) {
            chunk.usage.prompt_tokens_details = {
                cached_tokens: usage.cached_tokens
            };
        }
    }

    return chunk;
};

// Hono Stream Helper
export const writeStreamData = async (stream: any, data: any) => {
    await stream.writeSSE({
        data: JSON.stringify(data)
    });
};

// Create error chunk for streaming responses (OpenAI compatible format)
export const createErrorStreamChunk = (error: any, statusCode: number) => {
    const message = error.message || 'Internal server error';
    const type = error.type || 'server_error';
    return {
        error: {
            message,
            type,
            code: statusCode
        }
    };
};

// Retry logic
export const with429Retry = async (fn: (attempt: number) => Promise<any>, maxRetries: number, loggerPrefix: string = '') => {
    const retries = Number.isFinite(maxRetries) && maxRetries > 0 ? Math.floor(maxRetries) : 0;
    let attempt = 0;
    while (true) {
        try {
            return await fn(attempt);
        } catch (error: any) {
            const status = Number(error.status || error.statusCode || error.response?.status);
            if (status === 429 && attempt < retries) {
                const nextAttempt = attempt + 1;
                logger.warn(`${loggerPrefix}Received 429, retrying attempt ${nextAttempt} (total ${retries})`);
                attempt = nextAttempt;
                continue;
            }
            throw error;
        }
    }
};
