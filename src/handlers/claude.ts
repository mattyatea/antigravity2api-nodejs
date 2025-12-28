/**
 * Claude Format Handler
 * Handles /v1/messages requests, supporting streaming and non-streaming responses
 */

import { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
// @ts-ignore
import { generateAssistantResponse, generateAssistantResponseNoStream } from '../services/ai/client.js';
import { generateClaudeRequestBody } from '../converters/claude.js';

function prepareImageRequest(requestBody: any): any {
    const req = JSON.parse(JSON.stringify(requestBody));
    // SD specific adjustments for image models
    if (req.request && req.request.generationConfig) {
        req.request.generationConfig.responseMimeType = 'image/jpeg';
        // Ensure sample count 1
        req.request.generationConfig.candidateCount = 1;
    }
    return req;
}
import { normalizeClaudeParameters } from '../utils/parameterNormalizer.js';
import { buildClaudeErrorPayload } from '../utils/errors.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';
// @ts-ignore
import tokenManager from '../services/auth/token-manager.js';
import { with429Retry } from '../utils/sse.js';
import { DEFAULT_HEARTBEAT_INTERVAL } from '../config/constants.js';

/**
 * Create Claude stream event
 */
export const createClaudeStreamEvent = (eventType: string, data: any): string => {
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
};

/**
 * Create Claude non-stream response
 */
export const createClaudeResponse = (
    id: string,
    model: string,
    content: string | null,
    reasoning: string | null,
    reasoningSignature: string | null,
    toolCalls: any[] | null,
    stopReason: string,
    usage: any | null
) => {
    const contentBlocks: any[] = [];

    // thinking content (if any) - Claude format uses thinking type
    if (reasoning) {
        const thinkingBlock: any = {
            type: "thinking",
            thinking: reasoning
        };
        // @ts-ignore
        if (reasoningSignature && config.passSignatureToClient) {
            thinkingBlock.signature = reasoningSignature;
        }
        contentBlocks.push(thinkingBlock);
    }

    // Text content
    if (content) {
        contentBlocks.push({
            type: "text",
            text: content
        });
    }

    // Tool calls
    if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
            try {
                const toolBlock: any = {
                    type: "tool_use",
                    id: tc.id,
                    name: tc.function.name,
                    input: JSON.parse(tc.function.arguments)
                };
                // @ts-ignore
                if (tc.thoughtSignature && config.passSignatureToClient) {
                    toolBlock.signature = tc.thoughtSignature;
                }
                contentBlocks.push(toolBlock);
            } catch (e) {
                // Assign empty object on parse failure
                contentBlocks.push({
                    type: "tool_use",
                    id: tc.id,
                    name: tc.function.name,
                    input: {}
                });
            }
        }
    }

    // Build usage object with cache token support
    const usageObj: any = usage ? {
        input_tokens: usage.prompt_tokens || 0,
        output_tokens: usage.completion_tokens || 0
    } : { input_tokens: 0, output_tokens: 0 };

    // Add cache token fields if present (Claude API cache support)
    if (usage?.cache_creation_input_tokens !== undefined) {
        usageObj.cache_creation_input_tokens = usage.cache_creation_input_tokens;
    }
    if (usage?.cache_read_input_tokens !== undefined) {
        usageObj.cache_read_input_tokens = usage.cache_read_input_tokens;
    }

    return {
        id: id,
        type: "message",
        role: "assistant",
        content: contentBlocks,
        model: model,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: usageObj
    };
};

/**
 * Handle Claude format chat request
 */
export const handleClaudeRequest = async (c: Context, body: any, isStream: boolean) => {
    const { messages, model, system, tools, ...rawParams } = body;

    try {
        if (!messages) {
            return c.json(buildClaudeErrorPayload({ message: 'messages is required' }, 400), 400);
        }

        const token = await tokenManager.getToken();
        if (!token) {
            throw new Error('No token available, please run npm run login to get a token');
        }

        // Process Claude format parameters using unified parameter normalizer
        const parameters = normalizeClaudeParameters(rawParams);

        const isImageModel = model.includes('-image');
        const requestBody = generateClaudeRequestBody(messages, model, parameters, tools, system, token);

        if (isImageModel) {
            prepareImageRequest(requestBody);
        }

        const msgId = `msg_${Date.now()}`;
        // @ts-ignore
        const maxRetries = Number(config.retryTimes || 0);
        const safeRetries = maxRetries > 0 ? Math.floor(maxRetries) : 0;

        if (isStream) {
            return streamSSE(c, async (stream) => {
                const heartbeatTimer = setInterval(async () => {
                    await stream.writeSSE({ event: 'ping', data: '{}' });
                }, DEFAULT_HEARTBEAT_INTERVAL);

                try {
                    let contentIndex = 0;
                    let usageData: any = null;
                    let hasToolCall = false;
                    let currentBlockType: string | null = null;
                    let reasoningSent = false;

                    // Send message_start
                    await stream.writeSSE({
                        event: 'message_start',
                        data: JSON.stringify({
                            type: "message_start",
                            message: {
                                id: msgId,
                                type: "message",
                                role: "assistant",
                                content: [],
                                model: model,
                                stop_reason: null,
                                stop_sequence: null,
                                usage: { input_tokens: 0, output_tokens: 0 }
                            }
                        })
                    });

                    if (isImageModel) {
                        // Image generation model: get result non-streaming then return as stream
                        const { content, usage } = await with429Retry(
                            () => generateAssistantResponseNoStream(requestBody, token),
                            safeRetries,
                            'claude.stream.image '
                        );

                        // Send text block
                        await stream.writeSSE({
                            event: 'content_block_start',
                            data: JSON.stringify({
                                type: "content_block_start",
                                index: 0,
                                content_block: { type: "text", text: "" }
                            })
                        });
                        await stream.writeSSE({
                            event: 'content_block_delta',
                            data: JSON.stringify({
                                type: "content_block_delta",
                                index: 0,
                                delta: { type: "text_delta", text: content || '' }
                            })
                        });
                        await stream.writeSSE({
                            event: 'content_block_stop',
                            data: JSON.stringify({
                                type: "content_block_stop",
                                index: 0
                            })
                        });

                        // Send message_delta and message_stop
                        await stream.writeSSE({
                            event: 'message_delta',
                            data: JSON.stringify({
                                type: "message_delta",
                                delta: { stop_reason: 'end_turn', stop_sequence: null },
                                usage: usage ? { output_tokens: usage.completion_tokens || 0 } : { output_tokens: 0 }
                            })
                        });
                        await stream.writeSSE({
                            event: 'message_stop',
                            data: JSON.stringify({
                                type: "message_stop"
                            })
                        });
                    } else {
                        await with429Retry(
                            () => generateAssistantResponse(requestBody, token, async (data: any) => {
                                if (data.type === 'usage') {
                                    usageData = data.usage;
                                } else if (data.type === 'reasoning') {
                                    // thinking content - use thinking type
                                    if (!reasoningSent) {
                                        // Start thinking block
                                        const contentBlock: any = { type: "thinking", thinking: "" };
                                        // @ts-ignore
                                        if (data.thoughtSignature && config.passSignatureToClient) {
                                            contentBlock.signature = data.thoughtSignature;
                                        }
                                        await stream.writeSSE({
                                            event: 'content_block_start',
                                            data: JSON.stringify({
                                                type: "content_block_start",
                                                index: contentIndex,
                                                content_block: contentBlock
                                            })
                                        });
                                        currentBlockType = 'thinking';
                                        reasoningSent = true;
                                    }
                                    // Send thinking delta
                                    const delta: any = { type: "thinking_delta", thinking: data.reasoning_content || '' };
                                    // @ts-ignore
                                    if (data.thoughtSignature && config.passSignatureToClient) {
                                        delta.signature = data.thoughtSignature;
                                    }
                                    await stream.writeSSE({
                                        event: 'content_block_delta',
                                        data: JSON.stringify({
                                            type: "content_block_delta",
                                            index: contentIndex,
                                            delta: delta
                                        })
                                    });
                                } else if (data.type === 'tool_calls') {
                                    hasToolCall = true;
                                    // End previous block (if any)
                                    if (currentBlockType) {
                                        await stream.writeSSE({
                                            event: 'content_block_stop',
                                            data: JSON.stringify({
                                                type: "content_block_stop",
                                                index: contentIndex
                                            })
                                        });
                                        contentIndex++;
                                    }
                                    // Tool calls
                                    for (const tc of data.tool_calls) {
                                        try {
                                            const inputObj = JSON.parse(tc.function.arguments);
                                            const toolContentBlock: any = { type: "tool_use", id: tc.id, name: tc.function.name, input: {} };
                                            // @ts-ignore
                                            if (tc.thoughtSignature && config.passSignatureToClient) {
                                                toolContentBlock.signature = tc.thoughtSignature;
                                            }
                                            await stream.writeSSE({
                                                event: 'content_block_start',
                                                data: JSON.stringify({
                                                    type: "content_block_start",
                                                    index: contentIndex,
                                                    content_block: toolContentBlock
                                                })
                                            });
                                            // Send input delta
                                            await stream.writeSSE({
                                                event: 'content_block_delta',
                                                data: JSON.stringify({
                                                    type: "content_block_delta",
                                                    index: contentIndex,
                                                    delta: { type: "input_json_delta", partial_json: JSON.stringify(inputObj) }
                                                })
                                            });
                                            await stream.writeSSE({
                                                event: 'content_block_stop',
                                                data: JSON.stringify({
                                                    type: "content_block_stop",
                                                    index: contentIndex
                                                })
                                            });
                                            contentIndex++;
                                        } catch (e) {
                                            // Parse failure, skip
                                        }
                                    }
                                    currentBlockType = null;
                                } else {
                                    // Normal text content
                                    if (currentBlockType === 'thinking') {
                                        // End thinking block
                                        await stream.writeSSE({
                                            event: 'content_block_stop',
                                            data: JSON.stringify({
                                                type: "content_block_stop",
                                                index: contentIndex
                                            })
                                        });
                                        contentIndex++;
                                        currentBlockType = null;
                                    }
                                    if (currentBlockType !== 'text') {
                                        // Start text block
                                        await stream.writeSSE({
                                            event: 'content_block_start',
                                            data: JSON.stringify({
                                                type: "content_block_start",
                                                index: contentIndex,
                                                content_block: { type: "text", text: "" }
                                            })
                                        });
                                        currentBlockType = 'text';
                                    }
                                    // Send text delta
                                    await stream.writeSSE({
                                        event: 'content_block_delta',
                                        data: JSON.stringify({
                                            type: "content_block_delta",
                                            index: contentIndex,
                                            delta: { type: "text_delta", text: data.content || '' }
                                        })
                                    });
                                }
                            }),
                            safeRetries,
                            'claude.stream '
                        );

                        // End last content block
                        if (currentBlockType) {
                            await stream.writeSSE({
                                event: 'content_block_stop',
                                data: JSON.stringify({
                                    type: "content_block_stop",
                                    index: contentIndex
                                })
                            });
                        }

                        // Send message_delta
                        const stopReason = hasToolCall ? 'tool_use' : 'end_turn';
                        await stream.writeSSE({
                            event: 'message_delta',
                            data: JSON.stringify({
                                type: "message_delta",
                                delta: { stop_reason: stopReason, stop_sequence: null },
                                usage: usageData ? { output_tokens: usageData.completion_tokens || 0 } : { output_tokens: 0 }
                            })
                        });

                        // Send message_stop
                        await stream.writeSSE({
                            event: 'message_stop',
                            data: JSON.stringify({
                                type: "message_stop"
                            })
                        });
                    }
                } catch (error: any) {
                    logger.error('Claude streaming request failed:', error.message);
                    const statusCode = error.statusCode || error.status || 500;
                    await stream.writeSSE({
                        event: 'error',
                        data: JSON.stringify(buildClaudeErrorPayload(error, statusCode))
                    });
                } finally {
                    clearInterval(heartbeatTimer);
                }
            });
        } else {
            // Non-stream request
            const { content, reasoningContent, reasoningSignature, toolCalls, usage } = await with429Retry(
                () => generateAssistantResponseNoStream(requestBody, token),
                safeRetries,
                'claude.no_stream '
            );

            const stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn';
            const response = createClaudeResponse(
                msgId,
                model,
                content,
                reasoningContent,
                reasoningSignature,
                toolCalls,
                stopReason,
                usage
            );

            return c.json(response);
        }
    } catch (error: any) {
        logger.error('Claude request failed:', error.message);
        const statusCode = error.statusCode || error.status || 500;
        return c.json(buildClaudeErrorPayload(error, statusCode), statusCode);
    }
};

