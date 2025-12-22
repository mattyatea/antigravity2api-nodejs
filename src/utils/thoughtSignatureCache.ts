// Simple memory cache: cache thinking signature and tool signature by sessionId + model
// Integrate with Memory Manager to automatically shrink/clear cache under high pressure

import memoryManager, { MemoryPressure } from './memory-manager.js';

interface SignatureEntry {
    signature: string;
    ts: number;
}

const reasoningSignatureCache = new Map<string, SignatureEntry>();
const toolSignatureCache = new Map<string, SignatureEntry>();

// Max entries under normal conditions (low pressure)
const MAX_REASONING_ENTRIES = 256;
const MAX_TOOL_ENTRIES = 256;

// Expiration and periodic cleanup interval (ms)
const ENTRY_TTL_MS = 30 * 60 * 1000;      // 30 minutes
const CLEAN_INTERVAL_MS = 10 * 60 * 1000; // Scan every 10 minutes

function makeKey(sessionId: string | undefined, model: string | undefined): string {
    return `${sessionId || ''}::${model || ''}`;
}

function pruneMap(map: Map<string, SignatureEntry>, targetSize: number) {
    if (map.size <= targetSize) return;
    const removeCount = map.size - targetSize;
    let removed = 0;
    for (const key of map.keys()) {
        map.delete(key);
        removed++;
        if (removed >= removeCount) break;
    }
}

function pruneExpired(map: Map<string, SignatureEntry>, now: number) {
    for (const [key, entry] of map.entries()) {
        if (!entry || typeof entry.ts !== 'number') continue;
        if (now - entry.ts > ENTRY_TTL_MS) {
            map.delete(key);
        }
    }
}

// Register to memory manager, automatically cleanup cache under different pressure levels
memoryManager.registerCleanup((pressure: string) => {
    if (pressure === MemoryPressure.MEDIUM) {
        // Medium pressure: shrink to half capacity
        pruneMap(reasoningSignatureCache, Math.floor(MAX_REASONING_ENTRIES / 2));
        pruneMap(toolSignatureCache, Math.floor(MAX_TOOL_ENTRIES / 2));
    } else if (pressure === MemoryPressure.HIGH) {
        // High pressure: significantly shrink
        pruneMap(reasoningSignatureCache, Math.floor(MAX_REASONING_ENTRIES / 4));
        pruneMap(toolSignatureCache, Math.floor(MAX_TOOL_ENTRIES / 4));
    } else if (pressure === MemoryPressure.CRITICAL) {
        // Critical pressure: clear directly, prioritize survival
        reasoningSignatureCache.clear();
        toolSignatureCache.clear();
    }
});

// Periodic cleanup: delete expired signatures by TTL regardless of pressure level
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    pruneExpired(reasoningSignatureCache, now);
    pruneExpired(toolSignatureCache, now);
}, CLEAN_INTERVAL_MS);
cleanupInterval.unref?.();

export function setReasoningSignature(sessionId: string | undefined, model: string | undefined, signature: string | undefined) {
    if (!signature) return;
    const key = makeKey(sessionId, model);
    reasoningSignatureCache.set(key, { signature, ts: Date.now() });
    // Prevent infinite growth under low pressure
    pruneMap(reasoningSignatureCache, MAX_REASONING_ENTRIES);
}

export function getReasoningSignature(sessionId: string | undefined, model: string | undefined): string | null {
    const key = makeKey(sessionId, model);
    const entry = reasoningSignatureCache.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (typeof entry.ts === 'number' && now - entry.ts > ENTRY_TTL_MS) {
        reasoningSignatureCache.delete(key);
        return null;
    }
    return entry.signature || null;
}

export function setToolSignature(sessionId: string | undefined, model: string | undefined, signature: string | undefined) {
    if (!signature) return;
    const key = makeKey(sessionId, model);
    toolSignatureCache.set(key, { signature, ts: Date.now() });
    pruneMap(toolSignatureCache, MAX_TOOL_ENTRIES);
}

export function getToolSignature(sessionId: string | undefined, model: string | undefined): string | null {
    const key = makeKey(sessionId, model);
    const entry = toolSignatureCache.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (typeof entry.ts === 'number' && now - entry.ts > ENTRY_TTL_MS) {
        toolSignatureCache.delete(key);
        return null;
    }
    return entry.signature || null;
}

// Reserve: Manual clear interface (not currently used externally but for future extension)
export function clearThoughtSignatureCaches() {
    reasoningSignatureCache.clear();
    toolSignatureCache.clear();
}
