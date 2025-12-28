import { Context, Next } from 'hono';
import logger from '../utils/logger.js';
import config from '../config/index.js';

const MAX_LOG_LENGTH = 4000;

function redactBodyValue(payload: any) {
    if (!payload || typeof payload !== 'object') return payload;
    const cloned = JSON.parse(JSON.stringify(payload));
    const contents = cloned.request?.contents || cloned.contents;
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

function formatRequestBody(bodyText: string) {
    if (!bodyText) return '';
    try {
        const parsed = JSON.parse(bodyText);
        let payload = JSON.stringify(redactBodyValue(parsed));
        if (payload.length > MAX_LOG_LENGTH) {
            payload = `${payload.slice(0, MAX_LOG_LENGTH)}... [truncated]`;
        }
        return payload;
    } catch {
        if (bodyText.length > MAX_LOG_LENGTH) {
            return `${bodyText.slice(0, MAX_LOG_LENGTH)}... [truncated]`;
        }
        return bodyText;
    }
}

export const requestLogger = async (c: Context, next: Next) => {
    const start = Date.now();
    if (c.req.method === 'POST' && c.req.path.startsWith('/v1beta/models')) {
        const rawBody = await c.req.text();
        c.set('rawBody', rawBody);
        logger.info('[Incoming Request]', c.req.path, formatRequestBody(rawBody));
    }
    await next();
    const end = Date.now();
    const ignorePaths = ['/images', '/favicon.ico', '/.well-known'];
    if (!ignorePaths.some(p => c.req.path.startsWith(p))) {
        logger.request(c.req.method, c.req.path, c.res.status, end - start);
    }
};

export const authMiddleware = async (c: Context, next: Next) => {
    const apiKey = config.security?.apiKey;
    if (apiKey) {
        const authHeader = c.req.header('Authorization') || c.req.header('x-api-key');
        const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
        if (providedKey !== apiKey) {
            logger.warn(`API Key validation failed: ${c.req.method} ${c.req.path}`);
            return c.json({ error: 'Invalid API Key' }, 401);
        }
    }
    await next();
};
