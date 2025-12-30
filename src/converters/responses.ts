// OpenAI Responses API format converter
import config from '../config/index.js';
import { convertOpenAIToolsToAntigravity } from '../utils/toolConverter.js';
import {
    getSignatureContext,
    pushUserMessage,
    findFunctionNameById,
    pushFunctionResponse,
    createThoughtPart,
    createFunctionCallPart,
    processToolName,
    pushModelMessage,
    buildRequestBody
} from './common.js';
import {
    modelMapping,
    isEnableThinking,
    generateGenerationConfig
} from '../utils/parameterNormalizer.js';

interface ExtractedContent {
    text: string;
    images: any[];
}

interface ResponsesInputItem {
    type?: string;
    role?: string;
    content?: any;
    id?: string;
    status?: string;
}

/**
 * Extract images and text from content array or string
 */
function extractImagesFromContent(content: any): ExtractedContent {
    const result: ExtractedContent = { text: '', images: [] };
    if (typeof content === 'string') {
        result.text = content;
        return result;
    }
    if (Array.isArray(content)) {
        for (const item of content) {
            if (item.type === 'input_text' || item.type === 'text') {
                result.text += item.text || '';
            } else if (item.type === 'output_text') {
                result.text += item.text || '';
            } else if (item.type === 'input_image' || item.type === 'image_url') {
                const imageUrl = item.image_url?.url || item.url || '';
                const match = imageUrl.match(/^data:image\/([\w+]+);base64,(.+)$/);
                if (match) {
                    result.images.push({
                        inlineData: {
                            mimeType: `image/${match[1]}`,
                            data: match[2]
                        }
                    });
                } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                    result.images.push({
                        fileData: {
                            fileUri: imageUrl,
                            mimeType: 'image/jpeg'
                        }
                    });
                }
            } else if (item.type === 'input_audio') {
                const audioData = item.input_audio?.data || item.data;
                const audioFormat = item.input_audio?.format || item.format || 'wav';
                if (audioData) {
                    result.images.push({
                        inlineData: {
                            mimeType: `audio/${audioFormat}`,
                            data: audioData
                        }
                    });
                }
            }
        }
    }
    return result;
}

/**
 * Handle assistant/model message from Responses API input
 */
function handleAssistantMessage(message: ResponsesInputItem, antigravityMessages: any[], enableThinking: boolean, actualModelName: string, sessionId: string) {
    const content = message.content;
    const { reasoningSignature, toolSignature } = getSignatureContext(sessionId, actualModelName);

    const toolCalls: any[] = [];
    const parts: any[] = [];
    let hasContent = false;

    if (Array.isArray(content)) {
        for (const item of content) {
            if (item.type === 'output_text' || item.type === 'text') {
                hasContent = true;
                const textPart: any = { text: (item.text || '').trimEnd() };
                if (enableThinking) {
                    textPart.thoughtSignature = reasoningSignature;
                }
                parts.push(textPart);
            } else if (item.type === 'function_call') {
                const safeName = processToolName(item.name, sessionId, actualModelName);
                const signature = enableThinking ? (item.call_id ? toolSignature : null) : null;
                toolCalls.push(createFunctionCallPart(item.call_id || item.id, safeName, item.arguments, signature));
            } else if (item.type === 'reasoning' || item.type === 'thinking') {
                if (enableThinking) {
                    const reasoningText = item.text || item.content || ' ';
                    parts.unshift(createThoughtPart(reasoningText, item.signature || reasoningSignature));
                }
            }
        }
    } else if (typeof content === 'string' && content.trim() !== '') {
        hasContent = true;
        const textPart: any = { text: content.trimEnd() };
        if (enableThinking) {
            textPart.thoughtSignature = reasoningSignature;
        }
        parts.push(textPart);
    }

    // Add empty thinking if enabled but no reasoning was provided
    if (enableThinking && !parts.some((p: any) => p.thought)) {
        parts.unshift(createThoughtPart(' ', reasoningSignature));
    }

    pushModelMessage({ parts, toolCalls, hasContent }, antigravityMessages);
}

/**
 * Handle function call output (tool result)
 */
function handleFunctionCallOutput(message: ResponsesInputItem, antigravityMessages: any[]) {
    const callId = message.id || (message as any).call_id;
    const output = (message as any).output || '';
    const functionName = findFunctionNameById(callId, antigravityMessages);
    pushFunctionResponse(callId, functionName, typeof output === 'string' ? output : JSON.stringify(output), antigravityMessages);
}

/**
 * Convert Responses API input to Antigravity format messages
 */
function responsesInputToAntigravity(input: string | ResponsesInputItem[], enableThinking: boolean, actualModelName: string, sessionId: string): any[] {
    const antigravityMessages: any[] = [];

    // Handle simple string input
    if (typeof input === 'string') {
        pushUserMessage({ text: input, images: [] }, antigravityMessages);
        return antigravityMessages;
    }

    // Handle array of input items
    if (Array.isArray(input)) {
        for (const item of input) {
            // Skip null/undefined items
            if (!item) continue;

            const type = item.type;
            const role = item.role;

            // User message: role === 'user' OR (type === 'message' AND role === 'user')
            if (role === 'user' || (type === 'message' && role === 'user')) {
                const extracted = extractImagesFromContent(item.content);
                pushUserMessage(extracted, antigravityMessages);
            }
            // Assistant/model message: role === 'assistant' OR (type === 'message' AND role === 'assistant')
            else if (role === 'assistant' || (type === 'message' && role === 'assistant')) {
                handleAssistantMessage(item, antigravityMessages, enableThinking, actualModelName, sessionId);
            }
            // Function call output (tool result)
            else if (type === 'function_call_output') {
                handleFunctionCallOutput(item, antigravityMessages);
            }
            // Direct object with content but no type/role - treat as user message
            else if (!type && !role && typeof item === 'object' && 'content' in item) {
                const extracted = extractImagesFromContent(item.content);
                pushUserMessage(extracted, antigravityMessages);
            }
            // Handle item that is just a string in an array
            else if (typeof item === 'string') {
                pushUserMessage({ text: item, images: [] }, antigravityMessages);
            }
        }
    }

    return antigravityMessages;
}

/**
 * Convert Responses API tools to Antigravity format
 */
function convertResponsesTools(tools: any[], sessionId: string, actualModelName: string): any[] {
    if (!tools || !Array.isArray(tools)) {
        return [];
    }

    // Filter only function tools (ignore built-in tools like web_search, file_search, etc.)
    const functionTools = tools.filter(tool => tool.type === 'function');

    // Convert to OpenAI format first, then to Antigravity
    const openaiTools = functionTools.map(tool => ({
        type: 'function',
        function: tool.function || {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        }
    }));

    return convertOpenAIToolsToAntigravity(openaiTools, sessionId, actualModelName);
}

/**
 * Generate request body from Responses API request
 */
export function generateResponsesRequestBody(
    input: string | ResponsesInputItem[],
    modelName: string,
    instructions: string | undefined,
    parameters: any,
    tools: any[],
    token: any
) {
    const enableThinking = isEnableThinking(modelName);
    const actualModelName = modelMapping(modelName);

    const contents = responsesInputToAntigravity(input, enableThinking, actualModelName, token.sessionId);
    const convertedTools = convertResponsesTools(tools, token.sessionId, actualModelName);

    return buildRequestBody({
        contents,
        tools: convertedTools,
        generationConfig: generateGenerationConfig(parameters, enableThinking, actualModelName),
        sessionId: token.sessionId,
        systemInstruction: instructions || ''
    }, token, actualModelName);
}

/**
 * Generate a unique response ID
 */
export function generateResponseId(): string {
    const timestamp = Date.now().toString(16);
    const random = Math.random().toString(16).substring(2, 18);
    return `resp_${timestamp}${random}`;
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
    const timestamp = Date.now().toString(16);
    const random = Math.random().toString(16).substring(2, 18);
    return `msg_${timestamp}${random}`;
}

/**
 * Convert internal response to Responses API format
 */
export function formatResponsesOutput(
    responseId: string,
    model: string,
    content: string,
    reasoningContent: string | null,
    toolCalls: any[],
    usage: any,
    requestParams: any
): any {
    const created = Math.floor(Date.now() / 1000);
    const output: any[] = [];

    // Build message output
    const messageContent: any[] = [];

    // Add reasoning if present
    if (reasoningContent) {
        messageContent.push({
            type: 'reasoning',
            text: reasoningContent
        });
    }

    // Add text output
    if (content) {
        messageContent.push({
            type: 'output_text',
            text: content,
            annotations: []
        });
    }

    // Add function calls
    if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
            messageContent.push({
                type: 'function_call',
                id: toolCall.id,
                call_id: toolCall.id,
                name: toolCall.function?.name || toolCall.name,
                arguments: toolCall.function?.arguments || toolCall.arguments,
                status: 'completed'
            });
        }
    }

    const messageOutput = {
        type: 'message',
        id: generateMessageId(),
        status: 'completed',
        role: 'assistant',
        content: messageContent
    };

    output.push(messageOutput);

    // Calculate status
    const status = toolCalls && toolCalls.length > 0 ? 'requires_action' : 'completed';

    // Build full response
    return {
        id: responseId,
        object: 'response',
        created_at: created,
        status,
        error: null,
        incomplete_details: null,
        instructions: requestParams.instructions || null,
        max_output_tokens: requestParams.max_output_tokens || null,
        model,
        output,
        parallel_tool_calls: requestParams.parallel_tool_calls ?? true,
        previous_response_id: requestParams.previous_response_id || null,
        reasoning: {
            effort: requestParams.reasoning?.effort || null,
            summary: requestParams.reasoning?.summary || null
        },
        store: requestParams.store ?? true,
        temperature: requestParams.temperature ?? 1.0,
        text: requestParams.text || { format: { type: 'text' } },
        tool_choice: requestParams.tool_choice || 'auto',
        tools: requestParams.tools || [],
        top_p: requestParams.top_p ?? 1.0,
        truncation: requestParams.truncation || 'disabled',
        usage: formatResponsesUsage(usage),
        user: requestParams.user || null,
        metadata: requestParams.metadata || {}
    };
}

/**
 * Format usage for Responses API
 */
function formatResponsesUsage(usage: any): any {
    if (!usage) {
        return {
            input_tokens: 0,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 0,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 0
        };
    }

    return {
        input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
        input_tokens_details: {
            cached_tokens: usage.cached_tokens || usage.prompt_tokens_details?.cached_tokens || 0
        },
        output_tokens: usage.completion_tokens || usage.output_tokens || 0,
        output_tokens_details: {
            reasoning_tokens: usage.reasoning_tokens || usage.completion_tokens_details?.reasoning_tokens || 0
        },
        total_tokens: usage.total_tokens || 0
    };
}

/**
 * Create streaming response events for Responses API
 * 
 * Event sequence must be:
 * 1. response.created
 * 2. response.in_progress
 * 3. response.output_item.added (for each output item)
 * 4. response.content_part.added (for each content part)
 * 5. response.output_text.delta (for text deltas)
 * 6. response.content_part.done
 * 7. response.output_item.done
 * 8. response.completed
 */
export function createResponseStreamEvents(
    responseId: string,
    model: string,
    requestParams: any
): {
    createStartEvent: () => any;
    createInProgressEvent: () => any;
    createOutputItemAdded: (itemId: string, outputIndex: number) => any;
    createContentPartAdded: (itemId: string, outputIndex: number, contentIndex: number) => any;
    createContentDelta: (content: string, itemId: string, outputIndex: number, contentIndex: number) => any;
    createReasoningDelta: (content: string, itemId: string, outputIndex: number) => any;
    createToolCallDelta: (toolCall: any, itemId: string, outputIndex: number) => any;
    createToolCallDone: (toolCall: any, itemId: string, outputIndex: number) => any;
    createContentPartDone: (itemId: string, outputIndex: number, contentIndex: number, text: string) => any;
    createOutputItemDone: (itemId: string, outputIndex: number, content: any[]) => any;
    createCompletedEvent: (content: string, reasoningContent: string | null, toolCalls: any[], usage: any) => any;
    createDoneEvent: () => string;
    generateItemId: () => string;
} {
    const createdAt = Math.floor(Date.now() / 1000);

    return {
        createStartEvent: () => ({
            type: 'response.created',
            response: {
                id: responseId,
                object: 'response',
                created_at: createdAt,
                status: 'in_progress',
                model,
                output: [],
                parallel_tool_calls: requestParams.parallel_tool_calls ?? true,
                previous_response_id: requestParams.previous_response_id || null,
                reasoning: requestParams.reasoning || { effort: null, summary: null },
                store: requestParams.store ?? true,
                temperature: requestParams.temperature ?? 1.0,
                text: requestParams.text || { format: { type: 'text' } },
                tool_choice: requestParams.tool_choice || 'auto',
                tools: requestParams.tools || [],
                top_p: requestParams.top_p ?? 1.0,
                truncation: requestParams.truncation || 'disabled'
            }
        }),

        createInProgressEvent: () => ({
            type: 'response.in_progress',
            response: {
                id: responseId,
                object: 'response',
                created_at: createdAt,
                status: 'in_progress',
                model
            }
        }),

        createOutputItemAdded: (itemId: string, outputIndex: number) => ({
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: {
                type: 'message',
                id: itemId,
                status: 'in_progress',
                role: 'assistant',
                content: []
            }
        }),

        createContentPartAdded: (itemId: string, outputIndex: number, contentIndex: number) => ({
            type: 'response.content_part.added',
            item_id: itemId,
            output_index: outputIndex,
            content_index: contentIndex,
            part: {
                type: 'output_text',
                text: '',
                annotations: []
            }
        }),

        createContentDelta: (content: string, itemId: string, outputIndex: number, contentIndex: number) => ({
            type: 'response.output_text.delta',
            item_id: itemId,
            output_index: outputIndex,
            content_index: contentIndex,
            delta: content
        }),

        createReasoningDelta: (content: string, itemId: string, outputIndex: number) => ({
            type: 'response.reasoning.delta',
            item_id: itemId,
            output_index: outputIndex,
            delta: content
        }),

        createToolCallDelta: (toolCall: any, itemId: string, outputIndex: number) => ({
            type: 'response.function_call_arguments.delta',
            item_id: itemId,
            output_index: outputIndex,
            call_id: toolCall.id,
            name: toolCall.function?.name || toolCall.name,
            delta: toolCall.function?.arguments || toolCall.arguments
        }),

        createToolCallDone: (toolCall: any, itemId: string, outputIndex: number) => ({
            type: 'response.function_call_arguments.done',
            item_id: itemId,
            output_index: outputIndex,
            call_id: toolCall.id,
            name: toolCall.function?.name || toolCall.name,
            arguments: toolCall.function?.arguments || toolCall.arguments
        }),

        createContentPartDone: (itemId: string, outputIndex: number, contentIndex: number, text: string) => ({
            type: 'response.content_part.done',
            item_id: itemId,
            output_index: outputIndex,
            content_index: contentIndex,
            part: {
                type: 'output_text',
                text,
                annotations: []
            }
        }),

        createOutputItemDone: (itemId: string, outputIndex: number, content: any[]) => ({
            type: 'response.output_item.done',
            output_index: outputIndex,
            item: {
                type: 'message',
                id: itemId,
                status: 'completed',
                role: 'assistant',
                content
            }
        }),

        createCompletedEvent: (content: string, reasoningContent: string | null, toolCalls: any[], usage: any) => ({
            type: 'response.completed',
            response: formatResponsesOutput(responseId, model, content, reasoningContent, toolCalls, usage, requestParams)
        }),

        createDoneEvent: () => '[DONE]',

        generateItemId: () => generateMessageId()
    };
}

/**
 * Prepare image request (disable tools and thinking for image models)
 */
export function prepareImageRequest(requestBody: any) {
    if (requestBody.request) {
        delete requestBody.request.tools;
        delete requestBody.request.toolConfig;
        if (requestBody.request.generationConfig) {
            delete requestBody.request.generationConfig.thinkingConfig;
        }
    }
}
