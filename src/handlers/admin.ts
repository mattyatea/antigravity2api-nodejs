import { Hono } from 'hono';
import { generateToken, verifyToken } from '../services/auth/jwt.js';
import tokenManager from '../services/auth/token-manager.js';
import quotaManager from '../services/quota/quota-manager.js';
import oauthManager from '../services/auth/oauth.js';
import config, { getConfigJson, saveConfigJson } from '../config/index.js';
import logger from '../utils/logger.js';
// Removed deprecated imports
import { getEnvPath } from '../utils/paths.js';
import dotenv from 'dotenv';
import fs from 'fs';


const envPath = getEnvPath();

// @ts-ignore
import { getModelsWithQuotas } from '../services/ai/client.js';

const admin = new Hono();

// Login attempt rate limit - Brute force protection
const loginAttempts = new Map<string, { count: number; lastAttempt: number; blockedUntil?: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const BLOCK_DURATION = 5 * 60 * 1000; // 5 minutes
const ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minute window

function getClientIP(c: any): string {
    return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
        c.req.header('x-real-ip') ||
        'unknown';
}

function checkLoginRateLimit(ip: string): { allowed: boolean; message?: string; remainingSeconds?: number } {
    const now = Date.now();
    const attempt = loginAttempts.get(ip);

    if (!attempt) return { allowed: true };

    // Check if blocked
    if (attempt.blockedUntil && now < attempt.blockedUntil) {
        const remainingSeconds = Math.ceil((attempt.blockedUntil - now) / 1000);
        return {
            allowed: false,
            message: `Too many login attempts, please retry in ${remainingSeconds} seconds`,
            remainingSeconds
        };
    }

    // Cleanup expired attempts
    if (now - attempt.lastAttempt > ATTEMPT_WINDOW) {
        loginAttempts.delete(ip);
        return { allowed: true };
    }

    return { allowed: true };
}

function recordLoginAttempt(ip: string, success: boolean) {
    const now = Date.now();

    if (success) {
        // Login success, clear record
        loginAttempts.delete(ip);
        return;
    }

    // Login failed, record attempt
    const attempt = loginAttempts.get(ip) || { count: 0, lastAttempt: now };
    attempt.count++;
    attempt.lastAttempt = now;

    // Block if max attempts exceeded
    if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
        attempt.blockedUntil = now + BLOCK_DURATION;
        logger.warn(`IP ${ip} temporarily blocked due to excessive failed login attempts`);
    }

    loginAttempts.set(ip, attempt);
}

// JWT Auth Middleware
async function authMiddleware(c: any, next: () => Promise<void>) {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return c.json({ error: 'Token required' }, 401);
    }

    try {
        const decoded = verifyToken(token);
        c.set('user', decoded);
        await next();
    } catch (error) {
        return c.json({ error: 'Invalid token' }, 401);
    }
}

// Login
admin.post('/login', async (c) => {
    const clientIP = getClientIP(c);

    // Rate limit check
    const rateCheck = checkLoginRateLimit(clientIP);
    if (!rateCheck.allowed) {
        return c.json({
            success: false,
            message: rateCheck.message,
            retryAfter: rateCheck.remainingSeconds
        }, 429);
    }

    const body = await c.req.json();
    const { username, password } = body;

    // Input validation
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
        return c.json({ success: false, message: 'Username and password required' }, 400);
    }

    // Input length limit (DoS protection)
    if (username.length > 100 || password.length > 100) {
        return c.json({ success: false, message: 'Input too long' }, 400);
    }

    if (username === config.admin.username && password === config.admin.password) {
        recordLoginAttempt(clientIP, true);
        const token = generateToken({ username, role: 'admin' });
        return c.json({ success: true, token });
    } else {
        recordLoginAttempt(clientIP, false);
        return c.json({ success: false, message: 'Incorrect username or password' }, 401);
    }
});

// Token Management API - JWT Auth required
admin.get('/tokens', authMiddleware, async (c) => {
    try {
        const tokens = await tokenManager.getTokenList();
        return c.json({ success: true, data: tokens });
    } catch (error: any) {
        logger.error('Failed to get token list:', error.message);
        return c.json({ success: false, message: error.message }, 500);
    }
});

admin.post('/tokens', authMiddleware, async (c) => {
    const body = await c.req.json();
    const { access_token, refresh_token, expires_in, timestamp, enable, projectId, email } = body;
    if (!access_token || !refresh_token) {
        return c.json({ success: false, message: 'access_token and refresh_token required' }, 400);
    }
    const tokenData: any = { access_token, refresh_token, expires_in };
    if (timestamp) tokenData.timestamp = timestamp;
    if (enable !== undefined) tokenData.enable = enable;
    if (projectId) tokenData.projectId = projectId;
    if (email) tokenData.email = email;

    try {
        const result = await tokenManager.addToken(tokenData);
        return c.json(result);
    } catch (error: any) {
        logger.error('Failed to add token:', error.message);
        return c.json({ success: false, message: error.message }, 500);
    }
});

admin.put('/tokens/:refreshToken', authMiddleware, async (c) => {
    const refreshToken = c.req.param('refreshToken');
    const updates = await c.req.json();
    try {
        const result = await tokenManager.updateToken(refreshToken, updates);
        return c.json(result);
    } catch (error: any) {
        logger.error('Failed to update token:', error.message);
        return c.json({ success: false, message: error.message }, 500);
    }
});

admin.delete('/tokens/:refreshToken', authMiddleware, async (c) => {
    const refreshToken = c.req.param('refreshToken');
    try {
        const result = await tokenManager.deleteToken(refreshToken);
        return c.json(result);
    } catch (error: any) {
        logger.error('Failed to delete token:', error.message);
        return c.json({ success: false, message: error.message }, 500);
    }
});

admin.post('/tokens/reload', authMiddleware, async (c) => {
    try {
        await tokenManager.reload();
        return c.json({ success: true, message: 'Token hot reloaded' });
    } catch (error: any) {
        logger.error('Hot reload failed:', error.message);
        return c.json({ success: false, message: error.message }, 500);
    }
});

// Refresh access_token of specified Token
admin.post('/tokens/:refreshToken/refresh', authMiddleware, async (c) => {
    const refreshToken = c.req.param('refreshToken');
    try {
        logger.info('Refreshing token...');
        const tokens = await tokenManager.getTokenList();
        const tokenData = tokens.find((t: any) => t.refresh_token === refreshToken);

        if (!tokenData) {
            return c.json({ success: false, message: 'Token not found' }, 404);
        }

        // Call tokenManager refresh method
        const refreshedToken = await tokenManager.refreshToken(tokenData);
        return c.json({ success: true, message: 'Token refreshed successfully', data: { expires_in: refreshedToken.expires_in, timestamp: refreshedToken.timestamp } });
    } catch (error: any) {
        logger.error('Failed to refresh token:', error.message);
        return c.json({ success: false, message: error.message }, 500);
    }
});

admin.post('/oauth/exchange', authMiddleware, async (c) => {
    const body = await c.req.json();
    const { code, port } = body;
    if (!code || !port) {
        return c.json({ success: false, message: 'code and port required' }, 400);
    }

    try {
        const account = await oauthManager.authenticate(code, port);
        const message = account.hasQuota
            ? 'Token added successfully'
            : 'Token added successfully (Account has no quota, random ProjectId used)';
        return c.json({ success: true, data: account, message, fallbackMode: !account.hasQuota });
    } catch (error: any) {
        logger.error('Authentication failed:', error.message);
        return c.json({ success: false, message: error.message }, 500);
    }
});

// Get config
// Get config
admin.get('/config', authMiddleware, async (c) => {
    try {
        const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        const envData: Record<string, string> = {};
        envContent.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                let value = match[2].trim();
                // Remove quotes if present
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                envData[key] = value;
            }
        });

        const jsonData = getConfigJson();
        return c.json({ success: true, data: { env: envData, json: jsonData } });
    } catch (error: any) {
        logger.error('Failed to read config:', error.message);
        return c.json({ success: false, message: error.message }, 500);
    }
});

// Update config
// Update config
admin.put('/config', authMiddleware, async (c) => {
    try {
        const body = await c.req.json();
        const { env: envUpdates, json: jsonUpdates } = body;

        if (envUpdates) {
            let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
            for (const [key, value] of Object.entries(envUpdates)) {
                const regex = new RegExp(`^${key}=.*$`, 'm');
                if (regex.test(envContent)) {
                    envContent = envContent.replace(regex, `${key}=${value}`);
                } else {
                    envContent += `\n${key}=${value}`;
                }
            }
            fs.writeFileSync(envPath, envContent, 'utf8');
        }

        if (jsonUpdates) {
            const existing = getConfigJson();
            // Simple deep merge
            const merge = (target: any, source: any) => {
                for (const key of Object.keys(source)) {
                    if (source[key] instanceof Object && key in target) {
                        Object.assign(source[key], merge(target[key], source[key]))
                    }
                }
                Object.assign(target || {}, source)
                return target
            }
            saveConfigJson(merge(existing, jsonUpdates));
        }

        dotenv.config({ override: true });
        // Reload config logic inline
        const newConfig = (await import('../config/index.js')).buildConfig(getConfigJson());
        Object.assign(config, newConfig);

        logger.info('Config updated and hot reloaded');
        return c.json({ success: true, message: 'Config saved and active (Port/HOST changes require restart)' });
    } catch (error: any) {
        logger.error('Failed to update config:', error.message);
        return c.json({ success: false, message: error.message }, 500);
    }
});

// Get round-robin config
admin.get('/rotation', authMiddleware, async (c) => {
    try {
        const rotationConfig = tokenManager.getRotationConfig();
        return c.json({ success: true, data: rotationConfig });
    } catch (error: any) {
        logger.error('Failed to get rotation config:', error.message);
        return c.json({ success: false, message: error.message }, 500);
    }
});

// Update round-robin config
admin.put('/rotation', authMiddleware, async (c) => {
    try {
        const body = await c.req.json();
        const { strategy, requestCount } = body;

        // Validate strategy
        const validStrategies = ['round_robin', 'quota_exhausted', 'request_count'];
        if (strategy && !validStrategies.includes(strategy)) {
            return c.json({
                success: false,
                message: `Invalid strategy, values: ${validStrategies.join(', ')}`
            }, 400);
        }

        // Update in-memory config
        tokenManager.updateRotationConfig(strategy, requestCount);

        // Save to config.json
        const currentConfig = getConfigJson();
        if (!currentConfig.rotation) currentConfig.rotation = {};
        if (strategy) currentConfig.rotation.strategy = strategy;
        if (requestCount) currentConfig.rotation.requestCount = requestCount;
        saveConfigJson(currentConfig);

        // Reload config to memory
        const newConfig = (await import('../config/index.js')).buildConfig(getConfigJson());
        Object.assign(config, newConfig);

        logger.info(`Rotation strategy updated: ${strategy || 'Unchanged'}, Request count: ${requestCount || 'Unchanged'}`);
        return c.json({ success: true, message: 'Rotation strategy updated', data: tokenManager.getRotationConfig() });
    } catch (error: any) {
        logger.error('Failed to update rotation config:', error.message);
        return c.json({ success: false, message: error.message }, 500);
    }
});

// Get model quota for specified Token
admin.get('/tokens/:refreshToken/quotas', authMiddleware, async (c) => {
    try {
        const refreshToken = c.req.param('refreshToken');
        const forceRefresh = c.req.query('refresh') === 'true';
        const tokens = await tokenManager.getTokenList();
        let tokenData: any = tokens.find((t: any) => t.refresh_token === refreshToken);

        if (!tokenData) {
            return c.json({ success: false, message: 'Token not found' }, 404);
        }

        // Check if token expired and refresh if necessary
        if (tokenManager.isExpired(tokenData)) {
            try {
                tokenData = await tokenManager.refreshToken(tokenData);
            } catch (error: any) {
                logger.error('Failed to refresh token:', error.message);
                // Use 400 instead of 401 to avoid frontend mistaking it for JWT expiry
                return c.json({ success: false, message: 'Google Token expired and refresh failed, please re-login to Google account' }, 400);
            }
        }

        // First get from cache (unless force refresh)
        let quotaData = forceRefresh ? null : quotaManager.getQuota(refreshToken);

        if (!quotaData) {
            // Cache miss or force refresh, get from API
            const token = { access_token: tokenData.access_token, refresh_token: refreshToken };
            const quotas = await getModelsWithQuotas(token);
            quotaManager.updateQuota(refreshToken, quotas);
            quotaData = { lastUpdated: Date.now(), models: quotas };
        }

        // Convert time to Beijing time
        const modelsWithBeijingTime: Record<string, any> = {};
        Object.entries(quotaData.models).forEach(([modelId, quota]: [string, any]) => {
            modelsWithBeijingTime[modelId] = {
                remaining: quota.r,
                resetTime: quotaManager.convertToBeijingTime(quota.t),
                resetTimeRaw: quota.t
            };
        });

        return c.json({
            success: true,
            data: {
                lastUpdated: quotaData.lastUpdated,
                models: modelsWithBeijingTime
            }
        });
    } catch (error: any) {
        logger.error('Failed to get quota:', error.message);
        return c.json({ success: false, message: error.message }, 500);
    }
});

export default admin;
