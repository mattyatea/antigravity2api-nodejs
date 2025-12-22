import axios from 'axios';
import { log } from '../../utils/logger.js';
import { generateSessionId, generateProjectId } from '../../utils/id-generator.js';
import config, { getConfigJson } from '../../config/index.js';
import { OAUTH_CONFIG } from '../../config/oauth.js';
import { buildAxiosRequestConfig } from '../../utils/http-client.js';
import {
    DEFAULT_REQUEST_COUNT_PER_TOKEN,
    TOKEN_REFRESH_BUFFER
} from '../../config/constants.js';
import TokenStore from './token-store.js';
import { TokenError } from '../../utils/errors.js';

// Rotation strategy enumeration
const RotationStrategy = {
    ROUND_ROBIN: 'round_robin',           // Load balancing: switch on every request
    QUOTA_EXHAUSTED: 'quota_exhausted',   // Switch when quota is exhausted
    REQUEST_COUNT: 'request_count'        // Switch after custom request count
} as const;

type RotationStrategyType = typeof RotationStrategy[keyof typeof RotationStrategy];

interface TokenData {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    timestamp: number;
    enable?: boolean;
    projectId?: string;
    email?: string;
    hasQuota?: boolean;
    sessionId?: string;
}

/**
 * Token Manager.
 * Responsible for token storage, rotation, and refresh.
 */
class TokenManager {
    store: TokenStore;
    tokens: TokenData[];
    currentIndex: number;
    rotationStrategy: RotationStrategyType;
    requestCountPerToken: number;
    tokenRequestCounts: Map<string, number>;
    availableQuotaTokenIndices: number[];
    currentQuotaIndex: number;
    _initPromise: Promise<void> | null;

    constructor(filePath?: string) {
        this.store = new TokenStore(filePath);
        this.tokens = [];
        this.currentIndex = 0;

        // Rotation strategy related - uses atomic operations to avoid locks
        this.rotationStrategy = RotationStrategy.ROUND_ROBIN;
        this.requestCountPerToken = DEFAULT_REQUEST_COUNT_PER_TOKEN;
        this.tokenRequestCounts = new Map();

        // Available token index cache for quota exhausted strategy (optimizes large account scenarios)
        this.availableQuotaTokenIndices = [];
        this.currentQuotaIndex = 0;

        this._initPromise = null;
    }

    async _initialize() {
        try {
            log.info('Initializing token manager...');
            const tokenArray = await this.store.readAll();

            this.tokens = tokenArray.filter(token => token.enable !== false).map(token => ({
                ...token,
                sessionId: generateSessionId()
            }));

            this.currentIndex = 0;
            this.tokenRequestCounts.clear();
            this._rebuildAvailableQuotaTokens();

            // Load rotation strategy configuration
            this.loadRotationConfig();

            if (this.tokens.length === 0) {
                log.warn('No available accounts. Please add tokens using:');
                log.warn('  Method 1: Run npm run login command');
                log.warn('  Method 2: Use the frontend management page');
            } else {
                log.info(`Successfully loaded ${this.tokens.length} available tokens`);
                if (this.rotationStrategy === RotationStrategy.REQUEST_COUNT) {
                    log.info(`Rotation strategy: ${this.rotationStrategy}, switch after ${this.requestCountPerToken} requests per token`);
                } else {
                    log.info(`Rotation strategy: ${this.rotationStrategy}`);
                }

                // Refresh expired tokens concurrently
                await this._refreshExpiredTokensConcurrently();
            }
        } catch (error: any) {
            log.error('Failed to initialize tokens:', error.message);
            this.tokens = [];
        }
    }

    /**
     * Refresh expired tokens concurrently.
     */
    async _refreshExpiredTokensConcurrently() {
        const expiredTokens = this.tokens.filter(token => this.isExpired(token));
        if (expiredTokens.length === 0) {
            return;
        }

        log.info(`Found ${expiredTokens.length} expired tokens, starting concurrent refresh...`);
        const startTime = Date.now();

        const results = await Promise.allSettled(
            expiredTokens.map(token => this._refreshTokenSafe(token))
        );

        let successCount = 0;
        let failCount = 0;
        const tokensToDisable: TokenData[] = [];

        results.forEach((result, index) => {
            const token = expiredTokens[index];
            if (result.status === 'fulfilled') {
                if (result.value === 'success') {
                    successCount++;
                } else if (result.value === 'disable') {
                    tokensToDisable.push(token);
                    failCount++;
                }
            } else {
                failCount++;
                log.error(`...${token.access_token?.slice(-8) || 'unknown'} refresh failed:`, result.reason?.message || result.reason);
            }
        });

        // Batch disable invalidated tokens
        for (const token of tokensToDisable) {
            this.disableToken(token);
        }

        const elapsed = Date.now() - startTime;
        log.info(`Concurrent refresh completed: success ${successCount}, failed ${failCount}, elapsed ${elapsed}ms`);
    }

    /**
     * Safely refresh a single token (does not throw exceptions).
     */
    async _refreshTokenSafe(token: TokenData): Promise<'success' | 'disable' | 'skip'> {
        try {
            await this.refreshToken(token);
            return 'success';
        } catch (error: any) {
            if (error.statusCode === 403 || error.statusCode === 400) {
                log.warn(`...${token.access_token?.slice(-8) || 'unknown'}: Token is invalidated, will be disabled`);
                return 'disable';
            }
            throw error;
        }
    }

    async _ensureInitialized() {
        if (!this._initPromise) {
            this._initPromise = this._initialize();
        }
        return this._initPromise;
    }

    // Load rotation strategy configuration
    loadRotationConfig() {
        try {
            const jsonConfig = getConfigJson();
            if (jsonConfig.rotation) {
                this.rotationStrategy = jsonConfig.rotation.strategy || RotationStrategy.ROUND_ROBIN;
                this.requestCountPerToken = jsonConfig.rotation.requestCount || 10;
            }
        } catch (error: any) {
            log.warn('Failed to load rotation config, using defaults:', error.message);
        }
    }

    // Update rotation strategy (hot update)
    updateRotationConfig(strategy?: RotationStrategyType, requestCount?: number) {
        if (strategy && Object.values(RotationStrategy).includes(strategy)) {
            this.rotationStrategy = strategy;
        }
        if (requestCount && requestCount > 0) {
            this.requestCountPerToken = requestCount;
        }
        // Reset counters
        this.tokenRequestCounts.clear();
        if (this.rotationStrategy === RotationStrategy.REQUEST_COUNT) {
            log.info(`Rotation strategy updated: ${this.rotationStrategy}, switch after ${this.requestCountPerToken} requests per token`);
        } else {
            log.info(`Rotation strategy updated: ${this.rotationStrategy}`);
        }
    }

    // Rebuild available token list for quota exhausted strategy
    _rebuildAvailableQuotaTokens() {
        this.availableQuotaTokenIndices = [];
        this.tokens.forEach((token, index) => {
            if (token.enable !== false && token.hasQuota !== false) {
                this.availableQuotaTokenIndices.push(index);
            }
        });

        if (this.availableQuotaTokenIndices.length === 0) {
            this.currentQuotaIndex = 0;
        } else {
            this.currentQuotaIndex = this.currentQuotaIndex % this.availableQuotaTokenIndices.length;
        }
    }

    // Remove specified index from available list for quota strategy
    _removeQuotaIndex(tokenIndex: number) {
        const pos = this.availableQuotaTokenIndices.indexOf(tokenIndex);
        if (pos !== -1) {
            this.availableQuotaTokenIndices.splice(pos, 1);
            if (this.currentQuotaIndex >= this.availableQuotaTokenIndices.length) {
                this.currentQuotaIndex = 0;
            }
        }
    }

    async fetchProjectId(token: TokenData): Promise<string | undefined> {
        const response = await axios(buildAxiosRequestConfig({
            method: 'POST',
            url: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist',
            headers: {
                'Host': 'daily-cloudcode-pa.sandbox.googleapis.com',
                'User-Agent': 'antigravity/1.11.9 windows/amd64',
                'Authorization': `Bearer ${token.access_token}`,
                'Content-Type': 'application/json',
                'Accept-Encoding': 'gzip'
            },
            data: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } })
        }));
        return response.data?.cloudaicompanionProject;
    }

    /**
     * Check if Token is expired
     */
    isExpired(token: TokenData): boolean {
        if (!token.timestamp || !token.expires_in) return true;
        const expiresAt = token.timestamp + (token.expires_in * 1000);
        return Date.now() >= expiresAt - TOKEN_REFRESH_BUFFER;
    }

    async refreshToken(token: TokenData): Promise<TokenData> {
        log.info('Refreshing token...');
        const body = new URLSearchParams({
            client_id: OAUTH_CONFIG.CLIENT_ID,
            client_secret: OAUTH_CONFIG.CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: token.refresh_token
        });

        try {
            const response = await axios(buildAxiosRequestConfig({
                method: 'POST',
                url: OAUTH_CONFIG.TOKEN_URL,
                headers: {
                    'Host': 'oauth2.googleapis.com',
                    'User-Agent': 'Go-http-client/1.1',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept-Encoding': 'gzip'
                },
                data: body.toString()
            }));

            token.access_token = response.data.access_token;
            token.expires_in = response.data.expires_in;
            token.timestamp = Date.now();
            this.saveToFile(token);
            return token;
        } catch (error: any) {
            const statusCode = error.response?.status;
            const rawBody = error.response?.data;
            const suffix = token.access_token ? token.access_token.slice(-8) : null;
            const message = typeof rawBody === 'string' ? rawBody : (rawBody?.error?.message || error.message || 'Failed to refresh token');
            throw new TokenError(message, suffix, statusCode || 500);
        }
    }

    saveToFile(tokenToUpdate: TokenData | null = null) {
        // Maintain sync calling convention with async internal write
        this.store.mergeActiveTokens(this.tokens, tokenToUpdate).catch((error: any) => {
            log.error('Failed to save account config file:', error.message);
        });
    }

    disableToken(token: TokenData) {
        log.warn(`Disabling token ...${token.access_token.slice(-8)}`);
        token.enable = false;
        this.saveToFile();
        this.tokens = this.tokens.filter(t => t.refresh_token !== token.refresh_token);
        this.currentIndex = this.currentIndex % Math.max(this.tokens.length, 1);
        // Rebuild available list for quota strategy when tokens changes
        this._rebuildAvailableQuotaTokens();
    }

    // Atomic operation: Get and increment request count
    incrementRequestCount(tokenKey: string): number {
        const current = this.tokenRequestCounts.get(tokenKey) || 0;
        const newCount = current + 1;
        this.tokenRequestCounts.set(tokenKey, newCount);
        return newCount;
    }

    // Atomic operation: Reset request count
    resetRequestCount(tokenKey: string) {
        this.tokenRequestCounts.set(tokenKey, 0);
    }

    // Determine if should rotate to next token
    shouldRotate(token: TokenData): boolean {
        switch (this.rotationStrategy) {
            case RotationStrategy.ROUND_ROBIN:
                // Load balance: switch every request
                return true;

            case RotationStrategy.QUOTA_EXHAUSTED:
                // Switch when quota exhausted: check hasQuota flag
                // If hasQuota is false, switch is needed
                return token.hasQuota === false;

            case RotationStrategy.REQUEST_COUNT:
                // Switch after custom count
                const tokenKey = token.refresh_token;
                const count = this.incrementRequestCount(tokenKey);
                if (count >= this.requestCountPerToken) {
                    this.resetRequestCount(tokenKey);
                    return true;
                }
                return false;

            default:
                return true;
        }
    }

    // Mark token quota exhausted
    markQuotaExhausted(token: TokenData) {
        token.hasQuota = false;
        this.saveToFile(token);
        log.warn(`...${token.access_token.slice(-8)}: Quota exhausted, marked as no quota`);

        if (this.rotationStrategy === RotationStrategy.QUOTA_EXHAUSTED) {
            const tokenIndex = this.tokens.findIndex(t => t.refresh_token === token.refresh_token);
            if (tokenIndex !== -1) {
                this._removeQuotaIndex(tokenIndex);
            }
            this.currentIndex = (this.currentIndex + 1) % Math.max(this.tokens.length, 1);
        }
    }

    // Restore token quota (after reset)
    restoreQuota(token: TokenData) {
        token.hasQuota = true;
        this.saveToFile(token);
        log.info(`...${token.access_token.slice(-8)}: Quota restored`);
    }

    /**
     * Prepare single token (refresh + fetch projectId)
     */
    async _prepareToken(token: TokenData): Promise<'ready' | 'skip' | 'disable'> {
        // Refresh expired token
        if (this.isExpired(token)) {
            await this.refreshToken(token);
        }

        // Fetch projectId
        if (!token.projectId) {
            // @ts-ignore
            if (config.skipProjectIdFetch) {
                token.projectId = generateProjectId();
                this.saveToFile(token);
                log.info(`...${token.access_token.slice(-8)}: Using randomly generated projectId: ${token.projectId}`);
            } else {
                const projectId = await this.fetchProjectId(token);
                if (projectId === undefined) {
                    log.warn(`...${token.access_token.slice(-8)}: Not eligible for projectId, disabling account`);
                    return 'disable';
                }
                token.projectId = projectId;
                this.saveToFile(token);
            }
        }

        return 'ready';
    }

    /**
     * Handle errors during token preparation process
     */
    _handleTokenError(error: any, token: TokenData): 'disable' | 'skip' {
        const suffix = token.access_token?.slice(-8) || 'unknown';
        if (error.statusCode === 403 || error.statusCode === 400) {
            log.warn(`...${suffix}: Token invalid or error, account disabled automatically`);
            return 'disable';
        }
        log.error(`...${suffix} Operation failed:`, error.message);
        return 'skip';
    }

    /**
     * Reset quota status for all tokens
     */
    _resetAllQuotas() {
        log.warn('All tokens quota exhausted, resetting quota status');
        this.tokens.forEach(t => {
            t.hasQuota = true;
        });
        this.saveToFile();
        this._rebuildAvailableQuotaTokens();
    }

    async getToken(): Promise<TokenData | null> {
        await this._ensureInitialized();
        if (this.tokens.length === 0) return null;

        // Separate high-performance processing for quota strategy
        if (this.rotationStrategy === RotationStrategy.QUOTA_EXHAUSTED) {
            return this._getTokenForQuotaExhaustedStrategy();
        }

        return this._getTokenForDefaultStrategy();
    }

    /**
     * Get token for quota exhausted strategy
     */
    async _getTokenForQuotaExhaustedStrategy(): Promise<TokenData | null> {
        // If no available tokens, try resetting quotas
        if (this.availableQuotaTokenIndices.length === 0) {
            this._resetAllQuotas();
        }

        const totalAvailable = this.availableQuotaTokenIndices.length;
        if (totalAvailable === 0) {
            return null;
        }

        const startIndex = this.currentQuotaIndex % totalAvailable;

        for (let i = 0; i < totalAvailable; i++) {
            const listIndex = (startIndex + i) % totalAvailable;
            const tokenIndex = this.availableQuotaTokenIndices[listIndex];
            const token = this.tokens[tokenIndex];

            try {
                const result = await this._prepareToken(token);
                if (result === 'disable') {
                    this.disableToken(token);
                    this._rebuildAvailableQuotaTokens();
                    if (this.tokens.length === 0 || this.availableQuotaTokenIndices.length === 0) {
                        return null;
                    }
                    continue;
                }

                this.currentIndex = tokenIndex;
                this.currentQuotaIndex = listIndex;
                return token;
            } catch (error) {
                const action = this._handleTokenError(error, token);
                if (action === 'disable') {
                    this.disableToken(token);
                    this._rebuildAvailableQuotaTokens();
                    if (this.tokens.length === 0 || this.availableQuotaTokenIndices.length === 0) {
                        return null;
                    }
                }
                // skip: Try next token
            }
        }

        // All available tokens unusable, resetting quota status
        this._resetAllQuotas();
        return this.tokens[0] || null;
    }

    /**
     * Get token for default strategy (round_robin / request_count)
     */
    async _getTokenForDefaultStrategy(): Promise<TokenData | null> {
        const totalTokens = this.tokens.length;
        const startIndex = this.currentIndex;

        for (let i = 0; i < totalTokens; i++) {
            const index = (startIndex + i) % totalTokens;
            const token = this.tokens[index];

            try {
                const result = await this._prepareToken(token);
                if (result === 'disable') {
                    this.disableToken(token);
                    if (this.tokens.length === 0) return null;
                    continue;
                }

                // Update current index
                this.currentIndex = index;

                // Determine if should rotate
                if (this.shouldRotate(token)) {
                    this.currentIndex = (this.currentIndex + 1) % this.tokens.length;
                }

                return token;
            } catch (error) {
                const action = this._handleTokenError(error, token);
                if (action === 'disable') {
                    this.disableToken(token);
                    if (this.tokens.length === 0) return null;
                }
                // skip: Try next token
            }
        }

        return null;
    }

    disableCurrentToken(token: TokenData) {
        const found = this.tokens.find(t => t.access_token === token.access_token);
        if (found) {
            this.disableToken(found);
        }
    }

    // API Management Methods
    async reload() {
        this._initPromise = this._initialize();
        await this._initPromise;
        log.info('Token hot reloaded');
    }

    async addToken(tokenData: Partial<TokenData>) {
        try {
            const allTokens = await this.store.readAll();

            const newToken: any = {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_in: tokenData.expires_in || 3599,
                timestamp: tokenData.timestamp || Date.now(),
                enable: tokenData.enable !== undefined ? tokenData.enable : true
            };

            if (tokenData.projectId) {
                newToken.projectId = tokenData.projectId;
            }
            if (tokenData.email) {
                newToken.email = tokenData.email;
            }
            if (tokenData.hasQuota !== undefined) {
                newToken.hasQuota = tokenData.hasQuota;
            }

            allTokens.push(newToken);
            await this.store.writeAll(allTokens);

            await this.reload();
            return { success: true, message: 'Token added successfully' };
        } catch (error: any) {
            log.error('Failed to add Token:', error.message);
            return { success: false, message: error.message };
        }
    }

    async updateToken(refreshToken: string, updates: Partial<TokenData>) {
        try {
            const allTokens = await this.store.readAll();

            const index = allTokens.findIndex(t => t.refresh_token === refreshToken);
            if (index === -1) {
                return { success: false, message: 'Token does not exist' };
            }

            allTokens[index] = { ...allTokens[index], ...updates };
            await this.store.writeAll(allTokens);

            await this.reload();
            return { success: true, message: 'Token updated successfully' };
        } catch (error: any) {
            log.error('Failed to update Token:', error.message);
            return { success: false, message: error.message };
        }
    }

    async deleteToken(refreshToken: string) {
        try {
            const allTokens = await this.store.readAll();

            const filteredTokens = allTokens.filter(t => t.refresh_token !== refreshToken);
            if (filteredTokens.length === allTokens.length) {
                return { success: false, message: 'Token does not exist' };
            }

            await this.store.writeAll(filteredTokens);

            await this.reload();
            return { success: true, message: 'Token deleted successfully' };
        } catch (error: any) {
            log.error('Failed to delete Token:', error.message);
            return { success: false, message: error.message };
        }
    }

    async getTokenList() {
        try {
            const allTokens = await this.store.readAll();

            return allTokens.map(token => ({
                refresh_token: token.refresh_token,
                access_token: token.access_token,
                access_token_suffix: token.access_token ? `...${token.access_token.slice(-8)}` : 'N/A',
                expires_in: token.expires_in,
                timestamp: token.timestamp,
                enable: token.enable !== false,
                projectId: token.projectId || null,
                email: token.email || null,
                hasQuota: token.hasQuota !== false
            }));
        } catch (error: any) {
            log.error('Failed to get Token list:', error.message);
            return [];
        }
    }

    // Get current round-robin configuration
    getRotationConfig() {
        return {
            strategy: this.rotationStrategy,
            requestCount: this.requestCountPerToken,
            currentIndex: this.currentIndex,
            tokenCounts: Object.fromEntries(this.tokenRequestCounts)
        };
    }
}

// Export strategy enumeration
export { RotationStrategy };

const tokenManager = new TokenManager();
export default tokenManager;
