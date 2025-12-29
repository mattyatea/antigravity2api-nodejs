// @ts-ignore
import tokenManager from '../auth/token-manager.js';
import config from '../../config/index.js';
// Removed: import AntigravityRequester from './requester.js';
import { saveBase64Image } from '../../utils/imageStorage.js';
import logger from '../../utils/logger.js';
import memoryManager, { MemoryPressure } from '../../utils/memory-manager.js';
import { httpRequest, httpStreamRequest } from '../../utils/http-client.js';
import { MODEL_LIST_CACHE_TTL } from '../../config/constants.js';
import { createApiError } from '../../utils/errors.js';
import {
    getLineBuffer,
    releaseLineBuffer,
    parseAndEmitStreamChunk,
    convertToToolCall,
    registerStreamMemoryCleanup
} from './stream-parser.js';
import { setReasoningSignature, setToolSignature } from '../../utils/thoughtSignatureCache.js';


// Request client: always use axios/http-client now
// let requester: AntigravityRequester | null = null;
// const useAxios = true;

// ==================== Model List Cache (Smart Management) ====================
// Cache TTL is dynamically adjusted based on memory pressure
const getModelCacheTTL = (): number => {
    // @ts-ignore
    const baseTTL = config.cache?.modelListTTL || MODEL_LIST_CACHE_TTL;
    const pressure = memoryManager.getCurrentPressure();
    // Reduce cache time under high pressure
    if (pressure === MemoryPressure.CRITICAL) return Math.min(baseTTL, 5 * 60 * 1000);
    if (pressure === MemoryPressure.HIGH) return Math.min(baseTTL, 15 * 60 * 1000);
    return baseTTL;
};

let modelListCache: any = null;
let modelListCacheTime = 0;

// Default model list (used when API request fails)
const DEFAULT_MODELS = [
    'claude-opus-4-5',
    'claude-opus-4-5-thinking',
    'claude-sonnet-4-5-thinking',
    'claude-sonnet-4-5',
    'gemini-3-pro-high',
    'gemini-2.5-flash-lite',
    'gemini-3-pro-image',
    'gemini-2.5-flash-thinking',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-3-pro-low',
    'gemini-3-flash',
    'chat_20706',
    'rev19-uic3-1p',
    'gpt-oss-120b-medium',
    'chat_23310'
];

// Generate default model list response
function getDefaultModelList() {
    const created = Math.floor(Date.now() / 1000);
    return {
        object: 'list',
        data: DEFAULT_MODELS.map(id => ({
            id,
            object: 'model',
            created,
            owned_by: 'google'
        }))
    };
}


// Logic for choosing requester removed. Always using native HTTP client.

// Register memory cleanup callbacks for object pools and model cache
function registerMemoryCleanup() {
    // Stream parser module manages its own object pool size
    registerStreamMemoryCleanup();

    memoryManager.registerCleanup((pressure: MemoryPressure) => {
        // Clear model cache on high or critical pressure
        if (pressure === MemoryPressure.HIGH || pressure === MemoryPressure.CRITICAL) {
            const ttl = getModelCacheTTL();
            const now = Date.now();
            if (modelListCache && (now - modelListCacheTime) > ttl) {
                modelListCache = null;
                modelListCacheTime = 0;
                logger.info('Cleared expired model list cache');
            }
        }

        if (pressure === MemoryPressure.CRITICAL && modelListCache) {
            modelListCache = null;
            modelListCacheTime = 0;
            logger.info('Emergency cleared model list cache');
        }
    });
}

// Register cleanup callback on initialization
registerMemoryCleanup();

// ==================== Helper Functions ====================

function buildHeaders(token: any) {
    return {
        'Host': config.api.host,
        'User-Agent': config.api.userAgent,
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip'
    };
}

function buildRequesterConfig(headers: any, body: any = null) {
    const reqConfig: any = {
        method: 'POST',
        headers,
        timeout_ms: config.timeout,
        // @ts-ignore
        proxy: config.proxy
    };
    if (body !== null) reqConfig.body = JSON.stringify(body);
    return reqConfig;
}

function redactRequestBody(requestBody: any) {
    if (!requestBody || typeof requestBody !== 'object') return requestBody;
    const cloned = JSON.parse(JSON.stringify(requestBody));
    const contents = cloned.request?.contents;
    if (Array.isArray(contents)) {
        for (const content of contents) {
            if (!content?.parts || !Array.isArray(content.parts)) continue;
            for (const part of content.parts) {
                if (part?.inlineData?.data) {
                    part.inlineData.data = '[base64 omitted]';
                }
            }
        }
    }
    return cloned;
}

function logUpstreamRequest(url: string, requestBody: any) {
    const safeBody = redactRequestBody(requestBody);
    let payload = '';
    try {
        payload = JSON.stringify(safeBody);
    } catch {
        payload = '[unserializable request body]';
    }
    const maxLen = 4000;
    if (payload.length > maxLen) {
        payload = `${payload.slice(0, maxLen)}... [truncated]`;
    }
    logger.info('[Upstream Request]', url, payload);
}

function parseRetryAfterMs(value: any): number | null {
    if (value === undefined || value === null) return null;
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.max(0, raw * 1000);
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        const asNumber = Number(trimmed);
        if (Number.isFinite(asNumber)) {
            return Math.max(0, asNumber * 1000);
        }
        const asDate = Date.parse(trimmed);
        if (!Number.isNaN(asDate)) {
            return Math.max(0, asDate - Date.now());
        }
    }
    return null;
}

function safeJsonParse(value: string): any | null {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function extractUpstreamError(errorBody: any): any | null {
    if (!errorBody) return null;
    if (typeof errorBody === 'string') {
        const parsed = safeJsonParse(errorBody);
        if (parsed && typeof parsed === 'object') {
            return parsed.error || parsed;
        }
        return null;
    }
    if (typeof errorBody === 'object') {
        return errorBody.error || errorBody;
    }
    return null;
}

function parseDurationMs(value: any): number | null {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, value * 1000);
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const msMatch = trimmed.match(/^([\d.]+)\s*ms$/i);
        if (msMatch) {
            const msValue = Number(msMatch[1]);
            return Number.isFinite(msValue) ? Math.max(0, msValue) : null;
        }
        const sMatch = trimmed.match(/^([\d.]+)\s*s$/i);
        if (sMatch) {
            const sValue = Number(sMatch[1]);
            return Number.isFinite(sValue) ? Math.max(0, sValue * 1000) : null;
        }
        const asNumber = Number(trimmed);
        if (Number.isFinite(asNumber)) {
            return Math.max(0, asNumber * 1000);
        }
        return null;
    }
    if (typeof value === 'object') {
        const seconds = Number(value.seconds ?? 0);
        const nanos = Number(value.nanos ?? 0);
        if (Number.isFinite(seconds) || Number.isFinite(nanos)) {
            return Math.max(0, (Number.isFinite(seconds) ? seconds : 0) * 1000 + (Number.isFinite(nanos) ? nanos : 0) / 1e6);
        }
    }
    return null;
}

function parseTimestampMs(value: any): number | null {
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
            return Math.max(0, parsed - Date.now());
        }
    }
    return null;
}

function extractRetryAfterMsFromBody(errorBody: any): number | null {
    const upstreamError = extractUpstreamError(errorBody);
    if (!upstreamError || typeof upstreamError !== 'object') return null;

    const directRetry = parseDurationMs(upstreamError.retryDelay);
    if (directRetry !== null) return directRetry;

    const details = Array.isArray(upstreamError.details) ? upstreamError.details : [];
    for (const detail of details) {
        const retryDelay = parseDurationMs(detail?.retryDelay);
        if (retryDelay !== null) return retryDelay;
        const quotaResetDelay = parseDurationMs(detail?.metadata?.quotaResetDelay);
        if (quotaResetDelay !== null) return quotaResetDelay;
        const quotaResetTime = parseTimestampMs(detail?.metadata?.quotaResetTimeStamp);
        if (quotaResetTime !== null) return quotaResetTime;
    }

    const fallbackResetDelay = parseDurationMs(upstreamError.quotaResetDelay);
    if (fallbackResetDelay !== null) return fallbackResetDelay;
    const fallbackResetTime = parseTimestampMs(upstreamError.quotaResetTimeStamp);
    if (fallbackResetTime !== null) return fallbackResetTime;

    return null;
}

function formatRetryAfterMs(retryAfterMs: number): string {
    if (!Number.isFinite(retryAfterMs)) return '';
    if (retryAfterMs < 1000) return `${Math.ceil(retryAfterMs)}ms`;
    const seconds = retryAfterMs / 1000;
    if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
    const minutes = seconds / 60;
    if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
    const hours = minutes / 60;
    return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
}

// Unified error handling
async function handleApiError(error: any, token: any): Promise<never> {
    const status = error.response?.status || error.status || error.statusCode || 500;
    let retryAfterMs = status === 429
        ? parseRetryAfterMs(error.response?.headers?.['retry-after'])
        : null;
    let errorBody = error.message;

    if (error.response?.data?.readable) {
        const chunks: Buffer[] = [];
        for await (const chunk of error.response.data) {
            chunks.push(chunk);
        }
        errorBody = Buffer.concat(chunks).toString();
    } else if (typeof error.response?.data === 'object') {
        errorBody = JSON.stringify(error.response.data, null, 2);
    } else if (error.response?.data) {
        errorBody = error.response.data;
    }

    if (status === 429 && retryAfterMs === null) {
        retryAfterMs = extractRetryAfterMsFromBody(errorBody);
    }

    if (status === 403) {
        if (JSON.stringify(errorBody).includes("The caller does not")) {
            throw createApiError(`Exceeded model maximum context. Error details: ${errorBody}`, status, errorBody, retryAfterMs);
        }
        tokenManager.disableCurrentToken(token);
        throw createApiError(`Account has no access permission, disabled automatically. Error details: ${errorBody}`, status, errorBody, retryAfterMs);
    }

    let message = `API request failed (${status}): ${errorBody}`;
    if (status === 429) {
        const upstreamMessage = extractUpstreamError(errorBody)?.message;
        message = upstreamMessage || `API request failed (${status})`;
        if (retryAfterMs !== null) {
            const formattedRetry = formatRetryAfterMs(retryAfterMs);
            if (formattedRetry) {
                message = `${message} (retry after ${formattedRetry})`;
            }
        }
    }

    throw createApiError(message, status, errorBody, retryAfterMs);
}


// ==================== Export Functions ======================================

export async function generateAssistantResponse(requestBody: any, token: any, callback: (data: any) => void) {

    const headers = buildHeaders(token);
    // State caches thought chain signature temporarily for streaming multi-fragment reuse,
    // carries session and model info to write to global cache
    const state = {
        toolCalls: [] as any[],
        reasoningSignature: null as string | null,
        sessionId: requestBody.request?.sessionId,
        model: requestBody.model
    };
    const lineBuffer = getLineBuffer(); // Get from object pool

    const processChunk = (chunk: string) => {
        const lines = lineBuffer.append(chunk);
        for (let i = 0; i < lines.length; i++) {
            parseAndEmitStreamChunk(lines[i], state, callback);
        }
    };

    try {
        // useAxios check removed, assuming true
        logUpstreamRequest(config.api.url, requestBody);
        const response = await httpStreamRequest({
            method: 'POST',
            url: config.api.url,
            headers,
            data: requestBody
        });

        // Process Buffer directly, avoid toString memory allocation
        response.data.on('data', (chunk: any) => {
            processChunk(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        });

        await new Promise<void>((resolve, reject) => {
            response.data.on('end', () => {
                releaseLineBuffer(lineBuffer); // Return to object pool
                resolve();
            });
            response.data.on('error', reject);
        });
    } catch (error) {
        releaseLineBuffer(lineBuffer); // Ensure buffer is returned
        await handleApiError(error, token);
    }
}

// Internal tool: fetch complete raw model data from remote
async function fetchRawModels(headers: any, token: any) {
    try {
        // useAxios check removed, assuming true
        const response = await httpRequest({
            method: 'POST',
            url: config.api.modelsUrl,
            headers,
            data: {}
        });
        return response.data;
    } catch (error) {
        await handleApiError(error, token);
    }
}

export async function getAvailableModels() {
    // Check if cache is valid (dynamic TTL)
    const now = Date.now();
    const ttl = getModelCacheTTL();
    if (modelListCache && (now - modelListCacheTime) < ttl) {
        return modelListCache;
    }

    const token = await tokenManager.getToken();
    if (!token) {
        // Return default model list if no token available
        logger.warn('No available token, returning default model list');
        return getDefaultModelList();
    }

    const headers = buildHeaders(token);
    const data = await fetchRawModels(headers, token);
    if (!data) {
        // fetchRawModels already handles errors, fallback to default list here
        return getDefaultModelList();
    }

    const created = Math.floor(Date.now() / 1000);
    const modelList = Object.keys(data.models || {}).map(id => ({
        id,
        object: 'model',
        created,
        owned_by: 'google'
    }));

    // Add default models if not in API returned list
    const existingIds = new Set(modelList.map(m => m.id));
    for (const defaultModel of DEFAULT_MODELS) {
        if (!existingIds.has(defaultModel)) {
            modelList.push({
                id: defaultModel,
                object: 'model',
                created,
                owned_by: 'google'
            });
        }
    }

    const result = {
        object: 'list',
        data: modelList
    };

    // Update cache
    modelListCache = result;
    modelListCacheTime = now;
    const currentTTL = getModelCacheTTL();
    logger.info(`Model list cached (TTL: ${currentTTL / 1000}s, count: ${modelList.length})`);

    return result;
}

// Clear model list cache (for manual refresh)
export function clearModelListCache() {
    modelListCache = null;
    modelListCacheTime = 0;
    logger.info('Model list cache cleared');
}

export async function getModelsWithQuotas(token: any) {
    const headers = buildHeaders(token);
    const data = await fetchRawModels(headers, token);
    if (!data) return {};

    const quotas: Record<string, any> = {};
    Object.entries(data.models || {}).forEach(([modelId, modelData]: [string, any]) => {
        if (modelData.quotaInfo) {
            quotas[modelId] = {
                r: modelData.quotaInfo.remainingFraction,
                t: modelData.quotaInfo.resetTime
            };
        }
    });

    return quotas;
}

export async function generateAssistantResponseNoStream(requestBody: any, token: any) {

    const headers = buildHeaders(token);
    let data: any;

    try {
        // useAxios check removed, assuming true
        logUpstreamRequest(config.api.noStreamUrl, requestBody);
        data = (await httpRequest({
            method: 'POST',
            url: config.api.noStreamUrl,
            headers,
            data: requestBody
        })).data;
    } catch (error) {
        await handleApiError(error, token);
    }

    // Parse response content
    const parts = data.response?.candidates?.[0]?.content?.parts || [];
    let content = '';
    let reasoningContent = '';
    let reasoningSignature: string | null = null;
    const toolCalls: any[] = [];
    const imageUrls: string[] = [];

    for (const part of parts) {
        if (part.thought === true) {
            // Thought chain content - use DeepSeek format reasoning_content
            reasoningContent += part.text || '';
            if (part.thoughtSignature && !reasoningSignature) {
                reasoningSignature = part.thoughtSignature;
            }
        } else if (part.text !== undefined) {
            content += part.text;
        } else if (part.functionCall) {
            const toolCall = convertToToolCall(part.functionCall, requestBody.request?.sessionId, requestBody.model);
            if (part.thoughtSignature) {
                toolCall.thoughtSignature = part.thoughtSignature;
            }
            toolCalls.push(toolCall);
        } else if (part.inlineData) {
            // Save image locally and get URL
            const imageUrl = saveBase64Image(part.inlineData.data, part.inlineData.mimeType);
            imageUrls.push(imageUrl);
        }
    }

    // Extract token usage statistics
    const usage = data.response?.usageMetadata;
    const usageData = usage ? {
        prompt_tokens: usage.promptTokenCount || 0,
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0
    } : null;

    // Write new signature to global cache (by sessionId + model) for subsequent request fallback
    const sessionId = requestBody.request?.sessionId;
    const model = requestBody.model;
    if (sessionId && model) {
        if (reasoningSignature) {
            setReasoningSignature(sessionId, model, reasoningSignature);
        }
        // Tool signature: use first tool with thoughtSignature as cache source
        const toolSig = toolCalls.find(tc => tc.thoughtSignature)?.thoughtSignature;
        if (toolSig) {
            setToolSignature(sessionId, model, toolSig);
        }
    }

    // Image generation model: convert to markdown format
    if (imageUrls.length > 0) {
        let markdown = content ? content + '\n\n' : '';
        markdown += imageUrls.map(url => `![image](${url})`).join('\n\n');
        return { content: markdown, reasoningContent: reasoningContent || null, reasoningSignature, toolCalls, usage: usageData };
    }

    return { content, reasoningContent: reasoningContent || null, reasoningSignature, toolCalls, usage: usageData };
}

export async function generateImageForSD(requestBody: any, token: any) {
    const headers = buildHeaders(token);
    let data: any;

    try {
        // useAxios check removed, assuming true
        data = (await httpRequest({
            method: 'POST',
            url: config.api.noStreamUrl,
            headers,
            data: requestBody
        })).data;
    } catch (error) {
        await handleApiError(error, token);
    }

    const parts = data.response?.candidates?.[0]?.content?.parts || [];
    const images = parts.filter((p: any) => p.inlineData).map((p: any) => p.inlineData.data);

    return images;
}

export function closeRequester() {
    // if (requester) requester.close();
}

// Export memory cleanup registration function for external use
export { registerMemoryCleanup };
