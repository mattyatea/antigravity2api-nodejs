// Claude format converter tool
import config from '../config/index.js';
import { convertClaudeToolsToAntigravity } from '../utils/toolConverter.js';
import {
    getSignatureContext,
    pushUserMessage,
    findFunctionNameById,
    pushFunctionResponse,
    createThoughtPart,
    createFunctionCallPart,
    processToolName,
    pushModelMessage,
    buildRequestBody,
    mergeSystemInstruction
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

function extractImagesFromClaudeContent(content: any): ExtractedContent {
    const result: ExtractedContent = { text: '', images: [] };
    if (typeof content === 'string') {
        result.text = content;
        return result;
    }
    if (Array.isArray(content)) {
        for (const item of content) {
            if (item.type === 'text') {
                result.text += item.text || '';
            } else if (item.type === 'image') {
                const source = item.source;
                if (source && source.type === 'base64' && source.data) {
                    // Base64 image
                    result.images.push({
                        inlineData: {
                            mimeType: source.media_type || 'image/png',
                            data: source.data
                        }
                    });
                } else if (source && source.type === 'url' && source.url) {
                    // URL image (Claude API also supports URL sources)
                    result.images.push({
                        fileData: {
                            fileUri: source.url,
                            mimeType: source.media_type || 'image/jpeg'
                        }
                    });
                }
            } else if (item.type === 'document') {
                // Claude document support (PDF, etc.)
                const source = item.source;
                if (source && source.type === 'base64' && source.data) {
                    result.images.push({
                        inlineData: {
                            mimeType: source.media_type || 'application/pdf',
                            data: source.data
                        }
                    });
                } else if (source && source.type === 'url' && source.url) {
                    result.images.push({
                        fileData: {
                            fileUri: source.url,
                            mimeType: source.media_type || 'application/pdf'
                        }
                    });
                }
            }
        }
    }
    return result;
}

function handleClaudeAssistantMessage(message: any, antigravityMessages: any[], enableThinking: boolean, actualModelName: string, sessionId: string) {
    const content = message.content;
    const { reasoningSignature, toolSignature } = getSignatureContext(sessionId, actualModelName);

    let textContent = '';
    const toolCalls: any[] = [];

    if (typeof content === 'string') {
        textContent = content;
    } else if (Array.isArray(content)) {
        for (const item of content) {
            if (item.type === 'text') {
                textContent += item.text || '';
            } else if (item.type === 'tool_use') {
                const safeName = processToolName(item.name, sessionId, actualModelName);
                const signature = enableThinking ? toolSignature : null;
                toolCalls.push(createFunctionCallPart(item.id, safeName, JSON.stringify(item.input || {}), signature));
            }
        }
    }

    const hasContent = Boolean(textContent && textContent.trim() !== '');
    const parts: any[] = [];

    if (enableThinking) {
        parts.push(createThoughtPart(' ', reasoningSignature));
    }
    if (hasContent) parts.push({ text: textContent.trimEnd(), thoughtSignature: reasoningSignature });
    if (!enableThinking && parts[0]) delete parts[0].thoughtSignature;

    pushModelMessage({ parts, toolCalls, hasContent }, antigravityMessages);
}

function handleClaudeToolResult(message: any, antigravityMessages: any[]) {
    const content = message.content;
    if (!Array.isArray(content)) return;

    for (const item of content) {
        if (item.type !== 'tool_result') continue;

        const toolUseId = item.tool_use_id;
        const functionName = findFunctionNameById(toolUseId, antigravityMessages);

        let resultContent = '';
        if (typeof item.content === 'string') {
            resultContent = item.content;
        } else if (Array.isArray(item.content)) {
            resultContent = item.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
        }

        pushFunctionResponse(toolUseId, functionName, resultContent, antigravityMessages);
    }
}

function claudeMessageToAntigravity(claudeMessages: any[], enableThinking: boolean, actualModelName: string, sessionId: string): any[] {
    const antigravityMessages: any[] = [];
    for (const message of claudeMessages) {
        if (message.role === 'user') {
            const content = message.content;
            if (Array.isArray(content) && content.some((item: any) => item.type === 'tool_result')) {
                handleClaudeToolResult(message, antigravityMessages);
            } else {
                const extracted = extractImagesFromClaudeContent(content);
                pushUserMessage(extracted, antigravityMessages);
            }
        } else if (message.role === 'assistant') {
            handleClaudeAssistantMessage(message, antigravityMessages, enableThinking, actualModelName, sessionId);
        }
    }
    return antigravityMessages;
}

export function generateClaudeRequestBody(claudeMessages: any[], modelName: string, parameters: any, claudeTools: any[], systemPrompt: string, token: any) {
    const enableThinking = isEnableThinking(modelName);
    const actualModelName = modelMapping(modelName);
    // @ts-ignore
    const mergedSystem = mergeSystemInstruction(config.systemInstruction || '', systemPrompt);

    return buildRequestBody({
        contents: claudeMessageToAntigravity(claudeMessages, enableThinking, actualModelName, token.sessionId),
        tools: convertClaudeToolsToAntigravity(claudeTools, token.sessionId, actualModelName),
        generationConfig: generateGenerationConfig(parameters, enableThinking, actualModelName),
        sessionId: token.sessionId,
        systemInstruction: mergedSystem
    }, token, actualModelName);
}
