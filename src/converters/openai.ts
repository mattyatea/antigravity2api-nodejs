// OpenAI format converter tool
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
    generateGenerationConfig,
    extractSystemInstruction
} from '../utils/parameterNormalizer.js';

interface ExtractedContent {
    text: string;
    images: any[];
}

function extractImagesFromContent(content: any): ExtractedContent {
    const result: ExtractedContent = { text: '', images: [] };
    if (typeof content === 'string') {
        result.text = content;
        return result;
    }
    if (Array.isArray(content)) {
        for (const item of content) {
            if (item.type === 'text') {
                result.text += item.text;
            } else if (item.type === 'image_url') {
                const imageUrl = item.image_url?.url || '';
                const match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
                if (match) {
                    result.images.push({
                        inlineData: {
                            mimeType: `image/${match[1]}`,
                            data: match[2]
                        }
                    });
                }
            }
        }
    }
    return result;
}

function handleAssistantMessage(message: any, antigravityMessages: any[], enableThinking: boolean, actualModelName: string, sessionId: string) {
    const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;
    const hasContent = message.content && message.content.trim() !== '';
    const { reasoningSignature, toolSignature } = getSignatureContext(sessionId, actualModelName);

    const toolCalls = hasToolCalls
        ? message.tool_calls.map((toolCall: any) => {
            const safeName = processToolName(toolCall.function.name, sessionId, actualModelName);
            const signature = enableThinking ? (toolCall.thoughtSignature || toolSignature) : null;
            return createFunctionCallPart(toolCall.id, safeName, toolCall.function.arguments, signature);
        })
        : [];

    const parts: any[] = [];
    if (enableThinking) {
        const reasoningText = (typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0)
            ? message.reasoning_content : ' ';
        parts.push(createThoughtPart(reasoningText));
    }
    if (hasContent) parts.push({ text: message.content.trimEnd(), thoughtSignature: message.thoughtSignature || reasoningSignature });
    if (!enableThinking && parts[0]) delete parts[0].thoughtSignature;

    pushModelMessage({ parts, toolCalls, hasContent }, antigravityMessages);
}

function handleToolCall(message: any, antigravityMessages: any[]) {
    const functionName = findFunctionNameById(message.tool_call_id, antigravityMessages);
    pushFunctionResponse(message.tool_call_id, functionName, message.content, antigravityMessages);
}

function openaiMessageToAntigravity(openaiMessages: any[], enableThinking: boolean, actualModelName: string, sessionId: string): any[] {
    const antigravityMessages: any[] = [];
    for (const message of openaiMessages) {
        if (message.role === 'user' || message.role === 'system') {
            const extracted = extractImagesFromContent(message.content);
            pushUserMessage(extracted, antigravityMessages);
        } else if (message.role === 'assistant') {
            handleAssistantMessage(message, antigravityMessages, enableThinking, actualModelName, sessionId);
        } else if (message.role === 'tool') {
            handleToolCall(message, antigravityMessages);
        }
    }
    return antigravityMessages;
}

export function generateRequestBody(openaiMessages: any[], modelName: string, parameters: any, openaiTools: any[], token: any) {
    const enableThinking = isEnableThinking(modelName);
    const actualModelName = modelMapping(modelName);
    const mergedSystemInstruction = extractSystemInstruction(openaiMessages);

    let filteredMessages = openaiMessages;
    let startIndex = 0;
    // @ts-ignore
    if (config.useContextSystemPrompt) {
        for (let i = 0; i < openaiMessages.length; i++) {
            if (openaiMessages[i].role === 'system') {
                startIndex = i + 1;
            } else {
                filteredMessages = openaiMessages.slice(startIndex);
                break;
            }
        }
    }

    return buildRequestBody({
        contents: openaiMessageToAntigravity(filteredMessages, enableThinking, actualModelName, token.sessionId),
        tools: convertOpenAIToolsToAntigravity(openaiTools, token.sessionId, actualModelName),
        generationConfig: generateGenerationConfig(parameters, enableThinking, actualModelName),
        sessionId: token.sessionId,
        systemInstruction: mergedSystemInstruction
    }, token, actualModelName);
}

export function prepareImageRequest(requestBody: any) {
    if (requestBody.request) {
        // Image models do not support tools
        delete requestBody.request.tools;
        delete requestBody.request.toolConfig;

        // Ensure no thinking config
        if (requestBody.request.generationConfig) {
            delete requestBody.request.generationConfig.thinkingConfig;
        }
    }
}
