import { Context, Next } from 'hono';
import logger from '../utils/logger.js';
import config from '../config/index.js';

export const requestLogger = async (c: Context, next: Next) => {
    const start = Date.now();
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
