import memoryManager, { registerMemoryPoolCleanup } from '../../utils/memory-manager.js';
import { generateToolCallId } from '../../utils/id-generator.js';
import { setReasoningSignature, setToolSignature } from '../../utils/thoughtSignatureCache.js';
// @ts-ignore
import { getOriginalToolName } from '../../utils/toolNameCache.js';

// Precompiled constants (avoid duplicate string creation)
const DATA_PREFIX = 'data: ';
const DATA_PREFIX_LEN = DATA_PREFIX.length;

// Efficient line splitter (zero-copy, reuses LineBuffer via object pool)
class LineBuffer {
    buffer: string;
    lines: string[];

    constructor() {
        this.buffer = '';
        this.lines = [];
    }

    // Append data and return complete lines
    append(chunk: string): string[] {
        this.buffer += chunk;
        this.lines.length = 0; // Reuse array

        let start = 0;
        let end;
        while ((end = this.buffer.indexOf('\n', start)) !== -1) {
            this.lines.push(this.buffer.slice(start, end));
            start = end + 1;
        }

        // Keep incomplete part
        this.buffer = start < this.buffer.length ? this.buffer.slice(start) : '';
        return this.lines;
    }

    clear() {
        this.buffer = '';
        this.lines.length = 0;
    }
}

// LineBuffer object pool
const lineBufferPool: LineBuffer[] = [];
const getLineBuffer = (): LineBuffer => {
    const buffer = lineBufferPool.pop();
    if (buffer) {
        buffer.clear();
        return buffer;
    }
    return new LineBuffer();
};
const releaseLineBuffer = (buffer: LineBuffer) => {
    const maxSize = memoryManager.getPoolSizes().lineBuffer;
    if (lineBufferPool.length < maxSize) {
        buffer.clear();
        lineBufferPool.push(buffer);
    }
};

// toolCall object pool
const toolCallPool: any[] = [];
const getToolCallObject = () => toolCallPool.pop() || { id: '', type: 'function', function: { name: '', arguments: '' } };
const releaseToolCallObject = (obj: any) => {
    const maxSize = memoryManager.getPoolSizes().toolCall;
    if (toolCallPool.length < maxSize) toolCallPool.push(obj);
};

// Register memory cleanup callback
function registerStreamMemoryCleanup() {
    registerMemoryPoolCleanup(toolCallPool, () => memoryManager.getPoolSizes().toolCall);
    registerMemoryPoolCleanup(lineBufferPool, () => memoryManager.getPoolSizes().lineBuffer);
}

// Convert functionCall to OpenAI format (uses object pool)
// Attempts to restore safe tool name to original
function convertToToolCall(functionCall: any, sessionId: string | undefined, model: string | undefined) {
    const toolCall = getToolCallObject();
    toolCall.id = functionCall.id || generateToolCallId();
    let name = functionCall.name;
    if (sessionId && model) {
        const original = getOriginalToolName(sessionId, model, functionCall.name);
        if (original) name = original;
    }
    toolCall.function.name = name;
    toolCall.function.arguments = JSON.stringify(functionCall.args);
    return toolCall;
}

// Parse and emit stream chunk (updates state and triggers callback)
// Supports DeepSeek format: reasoning content output via reasoning_content field
// Passes through thoughtSignature for client reuse
function parseAndEmitStreamChunk(line: string, state: any, callback: (data: any) => void) {
    if (!line.startsWith(DATA_PREFIX)) return;

    try {
        const data = JSON.parse(line.slice(DATA_PREFIX_LEN));
        const parts = data.response?.candidates?.[0]?.content?.parts;

        if (parts) {
            for (const part of parts) {
                if (part.thought === true) {
                    if (part.thoughtSignature) {
                        state.reasoningSignature = part.thoughtSignature;
                        if (state.sessionId && state.model) {
                            //console.log("Server signature passed: "+state.reasoningSignature);
                            setReasoningSignature(state.sessionId, state.model, part.thoughtSignature);
                        }
                    }
                    callback({
                        type: 'reasoning',
                        reasoning_content: part.text || '',
                        thoughtSignature: part.thoughtSignature || state.reasoningSignature || null
                    });
                } else if (part.text !== undefined) {
                    callback({ type: 'text', content: part.text });
                } else if (part.functionCall) {
                    const toolCall = convertToToolCall(part.functionCall, state.sessionId, state.model);
                    if (part.thoughtSignature) {
                        toolCall.thoughtSignature = part.thoughtSignature;
                        if (state.sessionId && state.model) {
                            setToolSignature(state.sessionId, state.model, part.thoughtSignature);
                        }
                    }
                    state.toolCalls.push(toolCall);
                }
            }
        }

        if (data.response?.candidates?.[0]?.finishReason) {
            if (state.toolCalls.length > 0) {
                callback({ type: 'tool_calls', tool_calls: state.toolCalls });
                state.toolCalls = [];
            }
            const usage = data.response?.usageMetadata;
            if (usage) {
                callback({
                    type: 'usage',
                    usage: {
                        prompt_tokens: usage.promptTokenCount || 0,
                        completion_tokens: usage.candidatesTokenCount || 0,
                        total_tokens: usage.totalTokenCount || 0
                    }
                });
            }
        }
    } catch {
        // Ignore JSON parse errors
    }
}

export {
    getLineBuffer,
    releaseLineBuffer,
    parseAndEmitStreamChunk,
    convertToToolCall,
    registerStreamMemoryCleanup,
    releaseToolCallObject
};
