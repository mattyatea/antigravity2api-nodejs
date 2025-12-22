// Tool name mapping cache: sessionId + model + safeName dimension
// Solution: Sanitize tool name when sending upstream, restore original name when returning

import memoryManager, { MemoryPressure } from './memory-manager.js';

interface ToolNameEntry {
    originalName: string;
    ts: number;
}

// safeKey: `${sessionId}::${model}::${safeName}` -> { originalName, ts }
const toolNameMap = new Map<string, ToolNameEntry>();

const MAX_ENTRIES = 512;
const ENTRY_TTL_MS = 30 * 60 * 1000;      // 30 minutes
const CLEAN_INTERVAL_MS = 10 * 60 * 1000; // Scan every 10 minutes

function makeKey(sessionId: string | undefined, model: string | undefined, safeName: string | undefined): string {
    return `${sessionId || ''}::${model || ''}::${safeName || ''}`;
}

function pruneSize(targetSize: number) {
    if (toolNameMap.size <= targetSize) return;
    const removeCount = toolNameMap.size - targetSize;
    let removed = 0;
    for (const key of toolNameMap.keys()) {
        toolNameMap.delete(key);
        removed++;
        if (removed >= removeCount) break;
    }
}

function pruneExpired(now: number) {
    for (const [key, entry] of toolNameMap.entries()) {
        if (!entry || typeof entry.ts !== 'number') continue;
        if (now - entry.ts > ENTRY_TTL_MS) {
            toolNameMap.delete(key);
        }
    }
}

// Shrink cache according to memory pressure
memoryManager.registerCleanup((pressure: MemoryPressure) => {
    if (pressure === MemoryPressure.MEDIUM) {
        pruneSize(Math.floor(MAX_ENTRIES / 2));
    } else if (pressure === MemoryPressure.HIGH) {
        pruneSize(Math.floor(MAX_ENTRIES / 4));
    } else if (pressure === MemoryPressure.CRITICAL) {
        toolNameMap.clear();
    }
});

// Periodic cleanup by TTL
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    pruneExpired(now);
}, CLEAN_INTERVAL_MS);
cleanupInterval.unref?.();

export function setToolNameMapping(sessionId: string | undefined, model: string | undefined, safeName: string | undefined, originalName: string | undefined) {
    if (!safeName || !originalName || safeName === originalName) return;
    const key = makeKey(sessionId, model, safeName);
    toolNameMap.set(key, { originalName, ts: Date.now() });
    pruneSize(MAX_ENTRIES);
}

export function getOriginalToolName(sessionId: string | undefined, model: string | undefined, safeName: string | undefined): string | null {
    if (!safeName) return null;
    const key = makeKey(sessionId, model, safeName);
    const entry = toolNameMap.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (typeof entry.ts === 'number' && now - entry.ts > ENTRY_TTL_MS) {
        toolNameMap.delete(key);
        return null;
    }
    return entry.originalName || null;
}

export function clearToolNameMappings() {
    toolNameMap.clear();
}
