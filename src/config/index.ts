// @ts-nocheck
import dotenv from 'dotenv';
import fs from 'fs';
import crypto from 'crypto';
import log from '../utils/logger.js';
// Removed configReloader and deepMerge imports

import { getConfigPaths } from '../utils/paths.js';
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_SERVER_HOST,
  DEFAULT_HEARTBEAT_INTERVAL,
  DEFAULT_TIMEOUT,
  DEFAULT_RETRY_TIMES,
  DEFAULT_MAX_REQUEST_SIZE,
  DEFAULT_MAX_IMAGES,
  MODEL_LIST_CACHE_TTL,
  DEFAULT_GENERATION_PARAMS
} from './constants.js';

// Cache for generated credentials
let generatedCredentials = null;

/**
 * Generate or get admin credentials
 * If not configured, automatically generate random credentials
 */
function getAdminCredentials() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const jwtSecret = process.env.JWT_SECRET;

  // Return directly if all configured
  if (username && password && jwtSecret) {
    return { username, password, jwtSecret };
  }

  // Generate random credentials (once only)
  if (!generatedCredentials) {
    generatedCredentials = {
      username: username || crypto.randomBytes(8).toString('hex'),
      password: password || crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, ''),
      jwtSecret: jwtSecret || crypto.randomBytes(32).toString('hex')
    };

    // Display generated credentials
    if (!username || !password) {
      log.warn('═══════════════════════════════════════════════════════════');
      log.warn('⚠️  Admin credentials not configured, generated automatically:');
      log.warn(`    Username: ${generatedCredentials.username}`);
      log.warn(`    Password:   ${generatedCredentials.password}`);
      log.warn('═══════════════════════════════════════════════════════════');
      log.warn('⚠️  Credentials will be regenerated on restart! Configure in .env:');
      log.warn('    ADMIN_USERNAME=your_username');
      log.warn('    ADMIN_PASSWORD=your_password');
      log.warn('    JWT_SECRET=your_secret');
      log.warn('═══════════════════════════════════════════════════════════');
    } else if (!jwtSecret) {
      log.warn('⚠️ JWT_SECRET not configured, generated random secret (sessions will expire on restart)');
    }
  }

  return generatedCredentials;
}

const { envPath, configJsonPath } = getConfigPaths();

// Default system instruction
const DEFAULT_SYSTEM_INSTRUCTION = 'You are a chatbot named MoeMoe, just like the name, your personality is soft, cute and adorable, dedicated to providing users with chat and emotional value, assisting in novel creation or role playing';

// Ensure .env exists (create with defaults if missing)
if (!fs.existsSync(envPath)) {
  const defaultEnvContent = `# Sensitive config (configure in .env only)
# If the following three are not configured, random credentials will be generated and shown on startup
# API_KEY=your-api-key
# ADMIN_USERNAME=your-username
# ADMIN_PASSWORD=your-password
# JWT_SECRET=your-jwt-secret

# Optional config
# PROXY=http://127.0.0.1:7890
SYSTEM_INSTRUCTION=${DEFAULT_SYSTEM_INSTRUCTION}
# IMAGE_BASE_URL=http://your-domain.com
`;
  fs.writeFileSync(envPath, defaultEnvContent, 'utf8');
  log.info('✓ .env file created with default system instruction');
}

// Load config.json
let jsonConfig = {};
if (fs.existsSync(configJsonPath)) {
  jsonConfig = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
}

// Load .env (specific path)
dotenv.config({ path: envPath });

// Get proxy config: prioritize PROXY, then system proxy env vars
export function getProxyConfig() {
  // Prioritize explicitly configured PROXY
  if (process.env.PROXY && process.env.PROXY.trim() !== '') {
    return process.env.PROXY.trim();
  }

  // Check system proxy env vars (by priority)
  const systemProxy = process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;

  // Filter out empty strings
  if (systemProxy && systemProxy.trim() !== '') {
    log.info(`Using system proxy: ${systemProxy}`);
    return systemProxy.trim();
  }

  return null;
}

/**
 * Build configuration object from JSON and environment variables
 * @param {Object} jsonConfig - JSON config object
 * @returns {Object} Complete configuration object
 */
export function buildConfig(jsonConfig) {
  return {
    server: {
      port: jsonConfig.server?.port || DEFAULT_SERVER_PORT,
      host: jsonConfig.server?.host || DEFAULT_SERVER_HOST,
      heartbeatInterval: jsonConfig.server?.heartbeatInterval || DEFAULT_HEARTBEAT_INTERVAL,
      memoryThreshold: jsonConfig.server?.memoryThreshold || 100
    },
    cache: {
      modelListTTL: jsonConfig.cache?.modelListTTL || MODEL_LIST_CACHE_TTL
    },
    rotation: {
      strategy: jsonConfig.rotation?.strategy || 'round_robin',
      requestCount: jsonConfig.rotation?.requestCount || 10
    },
    imageBaseUrl: process.env.IMAGE_BASE_URL || null,
    maxImages: jsonConfig.other?.maxImages || DEFAULT_MAX_IMAGES,
    api: {
      url: jsonConfig.api?.url || 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse',
      modelsUrl: jsonConfig.api?.modelsUrl || 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
      noStreamUrl: jsonConfig.api?.noStreamUrl || 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent',
      host: jsonConfig.api?.host || 'daily-cloudcode-pa.sandbox.googleapis.com',
      userAgent: jsonConfig.api?.userAgent || 'antigravity/1.11.3 windows/amd64'
    },
    defaults: {
      temperature: jsonConfig.defaults?.temperature ?? DEFAULT_GENERATION_PARAMS.temperature,
      top_p: jsonConfig.defaults?.topP ?? DEFAULT_GENERATION_PARAMS.top_p,
      top_k: jsonConfig.defaults?.topK ?? DEFAULT_GENERATION_PARAMS.top_k,
      max_tokens: jsonConfig.defaults?.maxTokens ?? DEFAULT_GENERATION_PARAMS.max_tokens,
      thinking_budget: jsonConfig.defaults?.thinkingBudget ?? DEFAULT_GENERATION_PARAMS.thinking_budget
    },
    security: {
      maxRequestSize: jsonConfig.server?.maxRequestSize || DEFAULT_MAX_REQUEST_SIZE,
      apiKey: process.env.API_KEY || null
    },
    admin: getAdminCredentials(),
    useNativeAxios: jsonConfig.other?.useNativeAxios !== false,
    timeout: jsonConfig.other?.timeout || DEFAULT_TIMEOUT,
    retryTimes: Number.isFinite(jsonConfig.other?.retryTimes) ? jsonConfig.other.retryTimes : DEFAULT_RETRY_TIMES,
    proxy: getProxyConfig(),
    systemInstruction: process.env.SYSTEM_INSTRUCTION || '',
    skipProjectIdFetch: jsonConfig.other?.skipProjectIdFetch === true,
    useContextSystemPrompt: jsonConfig.other?.useContextSystemPrompt === true,
    passSignatureToClient: jsonConfig.other?.passSignatureToClient === true
  };
}

const config = buildConfig(jsonConfig);

log.info('✓ Configuration loaded successfully');

export default config;

export function getConfigJson() {
  if (fs.existsSync(configJsonPath)) {
    return JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
  }
  return {};
}


// Simple deep merge implementation since the utility was removed
function simpleDeepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] instanceof Object && key in target) {
      Object.assign(source[key], simpleDeepMerge(target[key], source[key]))
    }
  }
  Object.assign(target || {}, source)
  return target
}

export function saveConfigJson(data) {
  const existing = getConfigJson();
  const merged = simpleDeepMerge(existing, data);
  fs.writeFileSync(configJsonPath, JSON.stringify(merged, null, 2), 'utf8');
}