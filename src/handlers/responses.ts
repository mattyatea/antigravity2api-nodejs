/**
 * OpenAI Responses API Handler
 * Handles /v1/responses endpoints, supporting streaming and non-streaming responses
 */

import { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { generateAssistantResponse, generateAssistantResponseNoStream } from '../services/ai/client.js';
import {
    generateResponsesRequestBody,
    prepareImageRequest,
    generateResponseId,
    formatResponsesOutput,
    createResponseStreamEvents
} from '../converters/responses.js';
// @ts-ignore
import { buildOpenAIErrorPayload } from '../utils/errors.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';
// @ts-ignore
import tokenManager from '../services/auth/token-manager.js';
import {
    writeHeartbeat,
    with429Retry
} from '../utils/sse.js';
import { DEFAULT_HEARTBEAT_INTERVAL } from '../config/constants.js';

// In-memory storage for responses (for GET/DELETE operations)
// In production, this should be replaced with a persistent store
const responseStore = new Map<string, any>();

/**
 * Write SSE event for Responses API
 * Responses API uses SSE format with both event: and data: fields
 */
async function writeResponseEvent(stream: any, event: any) {
    const eventType = event.type || 'message';
    const data = JSON.stringify(event);
    await stream.writeSSE({
        event: eventType,
        data
    });
}

/**
 * Handle POST /v1/responses - Create a model response
 */
export const handleCreateResponse = async (c: Context) => {
    let body: any;
    try {
        body = await c.req.json();
    } catch (e) {
        return c.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, 400);
    }

    const {
        input,
        model,
        instructions,
        stream = false,
        tools,
        previous_response_id,
        store = true,
        ...params
    } = body;

    // Validate required fields
    if (!input && !previous_response_id) {
        return c.json({ error: { message: 'Either input or previous_response_id is required', type: 'invalid_request_error' } }, 400);
    }

    const token = await tokenManager.getToken();
    if (!token) {
        return c.json({ error: { message: 'No token available', type: 'authentication_error' } }, 401);
    }

    // Handle previous_response_id - prepend previous conversation
    let effectiveInput = input;
    if (previous_response_id && responseStore.has(previous_response_id)) {
        const previousResponse = responseStore.get(previous_response_id);
        if (previousResponse && previousResponse.output) {
            // Combine previous output with new input
            const previousItems = previousResponse.output.map((item: any) => ({
                type: item.type,
                role: item.role,
                content: item.content,
                id: item.id
            }));
            effectiveInput = [...previousItems, ...(Array.isArray(input) ? input : [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: input }] }])];
        }
    }

    const modelName = model || 'gpt-4o';
    const isImageModel = modelName.includes('-image');

    // Debug logging
    logger.debug('[Responses] Input received:', JSON.stringify(effectiveInput).substring(0, 500));

    const requestBody = generateResponsesRequestBody(effectiveInput, modelName, instructions, params, tools, token);

    // Debug logging for request body
    logger.debug('[Responses] Request body contents count:', requestBody?.request?.contents?.length || 0);

    if (isImageModel) {
        prepareImageRequest(requestBody);
    }

    const responseId = generateResponseId();
    const maxRetries = Number(config.retryTimes || 0);
    const safeRetries = maxRetries > 0 ? Math.floor(maxRetries) : 0;

    // Store request params for response formatting
    const requestParams = {
        instructions,
        max_output_tokens: params.max_output_tokens,
        parallel_tool_calls: params.parallel_tool_calls,
        previous_response_id,
        reasoning: params.reasoning,
        store,
        temperature: params.temperature,
        text: params.text,
        tool_choice: params.tool_choice,
        tools,
        top_p: params.top_p,
        truncation: params.truncation,
        user: params.user,
        metadata: params.metadata
    };

    if (stream) {
        return streamSSE(c, async (stream) => {
            const heartbeatTimer = setInterval(async () => {
                await writeHeartbeat(stream);
            }, DEFAULT_HEARTBEAT_INTERVAL);

            try {
                const streamEvents = createResponseStreamEvents(responseId, modelName, requestParams);
                const itemId = streamEvents.generateItemId();
                const outputIndex = 0;
                const contentIndex = 0;

                // Send response.created event
                await writeResponseEvent(stream, streamEvents.createStartEvent());
                logger.debug('[Responses] Sent response.created event');

                // Send response.in_progress event
                await writeResponseEvent(stream, streamEvents.createInProgressEvent());

                // Send output_item.added event
                await writeResponseEvent(stream, streamEvents.createOutputItemAdded(itemId, outputIndex));

                // Send content_part.added event
                await writeResponseEvent(stream, streamEvents.createContentPartAdded(itemId, outputIndex, contentIndex));
                logger.debug('[Responses] Sent initial events (created, in_progress, output_item.added, content_part.added)');

                if (isImageModel) {
                    const { content, usage } = await with429Retry(
                        () => generateAssistantResponseNoStream(requestBody, token),
                        safeRetries,
                        'responses.stream.image '
                    );

                    // Send content deltas
                    await writeResponseEvent(stream, streamEvents.createContentDelta(content, itemId, outputIndex, contentIndex));

                    // Send content_part.done
                    await writeResponseEvent(stream, streamEvents.createContentPartDone(itemId, outputIndex, contentIndex, content));

                    // Send output_item.done
                    const messageContent = [{ type: 'output_text', text: content, annotations: [] }];
                    await writeResponseEvent(stream, streamEvents.createOutputItemDone(itemId, outputIndex, messageContent));

                    // Send completed event
                    await writeResponseEvent(stream, streamEvents.createCompletedEvent(content, null, [], usage));
                } else {
                    let accumulatedContent = '';
                    let accumulatedReasoning = '';
                    let accumulatedToolCalls: any[] = [];
                    let usageData = null;

                    await with429Retry(
                        () => generateAssistantResponse(requestBody, token, async (data: any) => {
                            logger.debug('[Responses] Callback data:', JSON.stringify(data).substring(0, 200));
                            if (data.type === 'usage') {
                                usageData = data.usage;
                                logger.debug('[Responses] Received usage data');
                            } else if (data.type === 'reasoning') {
                                accumulatedReasoning += data.reasoning_content || '';
                                await writeResponseEvent(stream, streamEvents.createReasoningDelta(data.reasoning_content || '', itemId, outputIndex));
                                logger.debug('[Responses] Sent reasoning delta');
                            } else if (data.type === 'tool_calls') {
                                for (const toolCall of data.tool_calls) {
                                    accumulatedToolCalls.push(toolCall);
                                    await writeResponseEvent(stream, streamEvents.createToolCallDelta(toolCall, itemId, outputIndex));
                                }
                                logger.debug('[Responses] Sent tool_calls delta, count:', data.tool_calls.length);
                            } else if (data.type === 'text' || data.content) {
                                // Handle both 'text' type from stream-parser and direct content
                                const textContent = data.content || '';
                                if (textContent) {
                                    accumulatedContent += textContent;
                                    await writeResponseEvent(stream, streamEvents.createContentDelta(textContent, itemId, outputIndex, contentIndex));
                                    logger.debug('[Responses] Sent content delta, length:', textContent.length);
                                }
                            }
                        }),
                        safeRetries,
                        'responses.stream '
                    );

                    logger.debug('[Responses] Stream processing complete, sending final events');

                    // Send content_part.done
                    await writeResponseEvent(stream, streamEvents.createContentPartDone(itemId, outputIndex, contentIndex, accumulatedContent));
                    logger.debug('[Responses] Sent content_part.done');

                    // Build message content for output_item.done
                    const messageContent: any[] = [];
                    if (accumulatedReasoning) {
                        messageContent.push({ type: 'reasoning', text: accumulatedReasoning });
                    }
                    if (accumulatedContent) {
                        messageContent.push({ type: 'output_text', text: accumulatedContent, annotations: [] });
                    }
                    for (const toolCall of accumulatedToolCalls) {
                        messageContent.push({
                            type: 'function_call',
                            id: toolCall.id,
                            call_id: toolCall.id,
                            name: toolCall.function?.name || toolCall.name,
                            arguments: toolCall.function?.arguments || toolCall.arguments,
                            status: 'completed'
                        });
                    }

                    // Send output_item.done
                    await writeResponseEvent(stream, streamEvents.createOutputItemDone(itemId, outputIndex, messageContent));
                    logger.debug('[Responses] Sent output_item.done');

                    // Send done/completed event
                    // Use 'response.done' when there are tool calls (requires_action)
                    // Use 'response.completed' when the response is fully completed
                    const hasToolCalls = accumulatedToolCalls.length > 0;
                    const completedEvent = streamEvents.createCompletedEvent(
                        accumulatedContent,
                        accumulatedReasoning || null,
                        accumulatedToolCalls,
                        usageData,
                        hasToolCalls  // Pass flag to determine event type
                    );
                    await writeResponseEvent(stream, completedEvent);
                    logger.debug(`[Responses] Sent ${hasToolCalls ? 'response.done' : 'response.completed'} event`);

                    // Store response if requested
                    if (store) {
                        responseStore.set(responseId, completedEvent.response);
                    }
                }
            } catch (error: any) {
                logger.error('Responses stream processing error:', error.message);
                const statusCode = error.statusCode || error.status || 500;
                await writeResponseEvent(stream, {
                    type: 'error',
                    error: {
                        message: error.message || 'Internal server error',
                        type: error.type || 'server_error',
                        code: statusCode
                    }
                });
            } finally {
                clearInterval(heartbeatTimer);
                await stream.writeSSE({ data: '[DONE]' });
            }
        });
    } else {
        // Non-streaming response
        try {
            const { content, reasoningContent, toolCalls, usage } = await with429Retry(
                () => generateAssistantResponseNoStream(requestBody, token),
                safeRetries,
                'responses.no_stream '
            );

            const response = formatResponsesOutput(
                responseId,
                modelName,
                content,
                reasoningContent || null,
                toolCalls || [],
                usage,
                requestParams
            );

            // Store response if requested
            if (store) {
                responseStore.set(responseId, response);
            }

            return c.json(response);
        } catch (error: any) {
            logger.error('Failed to generate response:', error.message);
            const statusCode = error.statusCode || error.status || 500;
            return c.json({
                error: {
                    message: error.message || 'Internal server error',
                    type: error.type || 'server_error',
                    code: statusCode
                }
            }, statusCode);
        }
    }
};

/**
 * Handle GET /v1/responses/:response_id - Retrieve a response
 */
export const handleGetResponse = async (c: Context) => {
    const responseId = c.req.param('response_id');

    if (!responseId) {
        return c.json({ error: { message: 'response_id is required', type: 'invalid_request_error' } }, 400);
    }

    const response = responseStore.get(responseId);
    if (!response) {
        return c.json({ error: { message: 'Response not found', type: 'not_found_error' } }, 404);
    }

    return c.json(response);
};

/**
 * Handle DELETE /v1/responses/:response_id - Delete a response
 */
export const handleDeleteResponse = async (c: Context) => {
    const responseId = c.req.param('response_id');

    if (!responseId) {
        return c.json({ error: { message: 'response_id is required', type: 'invalid_request_error' } }, 400);
    }

    const existed = responseStore.has(responseId);
    if (existed) {
        responseStore.delete(responseId);
    }

    return c.json({
        id: responseId,
        object: 'response',
        deleted: existed
    });
};

/**
 * Handle POST /v1/responses/:response_id/cancel - Cancel a response
 */
export const handleCancelResponse = async (c: Context) => {
    const responseId = c.req.param('response_id');

    if (!responseId) {
        return c.json({ error: { message: 'response_id is required', type: 'invalid_request_error' } }, 400);
    }

    const response = responseStore.get(responseId);
    if (!response) {
        return c.json({ error: { message: 'Response not found', type: 'not_found_error' } }, 404);
    }

    // Update status to cancelled if it was in_progress
    if (response.status === 'in_progress') {
        response.status = 'cancelled';
        responseStore.set(responseId, response);
    }

    return c.json(response);
};

/**
 * Handle GET /v1/responses/:response_id/input_items - List input items
 */
export const handleListInputItems = async (c: Context) => {
    const responseId = c.req.param('response_id');

    if (!responseId) {
        return c.json({ error: { message: 'response_id is required', type: 'invalid_request_error' } }, 400);
    }

    // Since we don't store input items separately, return empty list
    // In a full implementation, input items would be stored with the response
    return c.json({
        object: 'list',
        data: [],
        first_id: null,
        last_id: null,
        has_more: false
    });
};

/**
 * Handle POST /v1/responses/input_tokens - Get input token counts
 */
export const handleGetInputTokens = async (c: Context) => {
    let body: any;
    try {
        body = await c.req.json();
    } catch (e) {
        return c.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, 400);
    }

    // This is a placeholder - actual token counting would require tokenizer
    // For now, estimate based on character count
    const input = body.input;
    const instructions = body.instructions || '';

    let charCount = 0;
    if (typeof input === 'string') {
        charCount = input.length;
    } else if (Array.isArray(input)) {
        charCount = JSON.stringify(input).length;
    }
    charCount += instructions.length;

    // Rough estimation: ~4 characters per token
    const estimatedTokens = Math.ceil(charCount / 4);

    return c.json({
        object: 'response.input_tokens',
        input_tokens: estimatedTokens
    });
};

/**
 * Handle POST /v1/responses/compact - Compact a conversation
 */
export const handleCompactResponse = async (c: Context) => {
    let body: any;
    try {
        body = await c.req.json();
    } catch (e) {
        return c.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, 400);
    }

    const { model, input, instructions, previous_response_id } = body;

    if (!model) {
        return c.json({ error: { message: 'model is required', type: 'invalid_request_error' } }, 400);
    }

    // In a full implementation, this would call the model to compact the conversation
    // For now, return a placeholder compaction
    const compactionId = `cmp_${Date.now().toString(16)}${Math.random().toString(16).substring(2, 10)}`;

    const output: any[] = [];

    // Keep user messages as-is
    if (Array.isArray(input)) {
        for (const item of input) {
            if (item.role === 'user') {
                output.push(item);
            }
        }
    }

    // Add compaction item
    output.push({
        id: compactionId,
        type: 'compaction',
        encrypted_content: Buffer.from(JSON.stringify({ placeholder: true })).toString('base64')
    });

    return c.json({
        id: `resp_${Date.now().toString(16)}`,
        object: 'response.compaction',
        created_at: Math.floor(Date.now() / 1000),
        output,
        usage: {
            input_tokens: 0,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 0,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 0
        }
    });
};

/**
 * Clear stored responses (for memory management)
 */
export function clearResponseStore() {
    responseStore.clear();
}

/**
 * Get response store size
 */
export function getResponseStoreSize(): number {
    return responseStore.size;
}
