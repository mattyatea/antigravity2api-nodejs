import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';

import config from '../config/index.js';
import logger from '../utils/logger.js';
// @ts-ignore
import memoryManager from '../utils/memory-manager.js';
import { MEMORY_CHECK_INTERVAL } from '../config/constants.js';
import { getChunkPoolSize, clearChunkPool } from '../utils/sse.js';
import { handleOpenAIRequest } from '../handlers/openai.js';
import { handleGetModels } from '../handlers/models.js';
import { handleClaudeRequest } from '../handlers/claude.js';
import { handleGeminiModelsList, handleGeminiModelDetail, handleGeminiRequest } from '../handlers/gemini.js';
import admin from '../handlers/admin.js';
// @ts-ignore
import { closeRequester } from '../services/ai/client.js';
import { requestLogger, authMiddleware } from './middleware.js';

const app = new Hono();

// Initialize memory manager with configured threshold
memoryManager.setThreshold(config.server.memoryThreshold);
memoryManager.start(MEMORY_CHECK_INTERVAL);

// Global Middleware
app.use('*', cors());
app.use('*', requestLogger);

// Auth Middleware
app.use('/v1/*', authMiddleware);
app.use('/v1beta/*', authMiddleware); // Add for Gemini
app.use('/admin/*', authMiddleware); // Add for Admin

// Static Files
app.use('/images/*', serveStatic({ root: './public' }));
app.use('/*', serveStatic({ root: './public' }));

// API Routes
// OpenAI
app.post('/v1/chat/completions', handleOpenAIRequest);
app.get('/v1/models', handleGetModels);

// Claude
app.post('/v1/messages', async (c) => {
    let body;
    try {
        body = await c.req.json();
    } catch (e) {
        return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const isStream = body.stream === true;
    return handleClaudeRequest(c, body, isStream);
});

// Gemini
app.get('/v1beta/models', handleGeminiModelsList);
app.get('/v1beta/models/:model', handleGeminiModelDetail);
app.post('/v1beta/models/:model:*', async (c) => {
    const model = c.req.param('model') || '';
    const isStream = c.req.path.includes('streamGenerateContent'); // Basic stream detection
    return handleGeminiRequest(c, model, isStream);
});

// Admin
app.route('/admin', admin);

// System Endpoints
app.get('/v1/memory', (c) => {
    const usage = process.memoryUsage();
    return c.json({
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        rss: usage.rss,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers,
        pressure: memoryManager.getCurrentPressure(),
        poolSizes: memoryManager.getPoolSizes(),
        chunkPoolSize: getChunkPoolSize()
    });
});

app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

// SPA Fallback
app.get('*', async (c, next) => {
    if (c.req.header('Accept')?.includes('text/html')) {
        return serveStatic({ root: './public', path: 'index.html' })(c, next);
    }
    return c.json({ error: 'Not found' }, 404);
});

// Error Handling
app.onError((err, c) => {
    logger.error(`Error: ${err.message}`);
    return c.json({ error: err.message }, 500);
});

const port = Number(config.server.port || 8045);
const host = config.server.host || '0.0.0.0';

logger.info(`Server started: ${host}:${port}`);

const server = serve({
    fetch: app.fetch,
    port,
    hostname: host
});

// Graceful Shutdown
const shutdown = () => {
    logger.info('Shutting down server...');
    memoryManager.stop();
    closeRequester();
    clearChunkPool();
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
    setTimeout(() => {
        logger.warn('Server shutdown timeout, forcing exit');
        process.exit(0);
    }, 5000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;
