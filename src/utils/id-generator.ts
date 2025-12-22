import { randomUUID } from 'crypto';

export function generateRequestId(): string {
    return `agent-${randomUUID()}`;
}

export function generateSessionId(): string {
    return String(-Math.floor(Math.random() * 9e18));
}

export function generateProjectId(): string {
    const adjectives = ['useful', 'bright', 'swift', 'calm', 'bold'];
    const nouns = ['fuze', 'wave', 'spark', 'flow', 'core'];
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomNum = Math.random().toString(36).substring(2, 7);
    return `${randomAdj}-${randomNoun}-${randomNum}`;
}

export function generateToolCallId(): string {
    return `call_${randomUUID().replace(/-/g, '')}`;
}
