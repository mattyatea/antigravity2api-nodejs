/**
 * Get available models list
 */
import { Context } from 'hono';
// @ts-ignore
import { getAvailableModels } from '../services/ai/client.js';
import logger from '../utils/logger.js';

export const handleGetModels = async (c: Context) => {
    try {
        const models = await getAvailableModels();
        return c.json(models);
    } catch (error: any) {
        logger.error('Failed to get model list:', error.message);
        return c.json({ error: error.message }, 500);
    }
};
