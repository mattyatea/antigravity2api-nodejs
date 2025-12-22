import fs from 'fs/promises';
import path from 'path';
import { getDataDir } from '../../utils/paths.js';
import { FILE_CACHE_TTL } from '../../config/constants.js';
import { log } from '../../utils/logger.js';

/**
 * Handles reading/writing and simple caching of Token file
 * Handles JSON array load/save only, indifferent to business fields
 */
class TokenStore {
    filePath: string;
    _cache: any[] | null;
    _cacheTime: number;
    _cacheTTL: number;

    constructor(filePath: string = path.join(getDataDir(), 'accounts.json')) {
        this.filePath = filePath;
        this._cache = null;
        this._cacheTime = 0;
        this._cacheTTL = FILE_CACHE_TTL;
    }

    async _ensureFileExists() {
        const dir = path.dirname(this.filePath);
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (e) {
            // Ignore if directory already exists
        }

        try {
            await fs.access(this.filePath);
        } catch (e) {
            // Create empty array definition if file not exists
            await fs.writeFile(this.filePath, '[]', 'utf8');
            log.info('✓ Account config file created');
        }
    }

    _isCacheValid(): boolean {
        if (!this._cache) return false;
        const now = Date.now();
        return (now - this._cacheTime) < this._cacheTTL;
    }

    /**
     * Read all tokens (including invalid ones) with simple memory cache
     */
    async readAll(): Promise<any[]> {
        if (this._isCacheValid()) {
            return this._cache!;
        }

        await this._ensureFileExists();
        try {
            const data = await fs.readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(data || '[]');
            if (!Array.isArray(parsed)) {
                log.warn('Account config file format error, reset to empty array');
                this._cache = [];
            } else {
                this._cache = parsed;
            }
        } catch (error: any) {
            log.error('Failed to read account config file:', error.message);
            this._cache = [];
        }
        this._cacheTime = Date.now();
        return this._cache!;
    }

    /**
     * Overwrite all tokens to file, update cache
     */
    async writeAll(tokens: any[]) {
        await this._ensureFileExists();
        const normalized = Array.isArray(tokens) ? tokens : [];
        try {
            await fs.writeFile(this.filePath, JSON.stringify(normalized, null, 2), 'utf8');
            this._cache = normalized;
            this._cacheTime = Date.now();
        } catch (error: any) {
            log.error('Failed to save account config file:', error.message);
            throw error;
        }
    }

    /**
     * Merge corresponding records to file based on active token list in memory
     * - Update existing records matching refresh_token
     * - Do not change records not in activeTokens (e.g. disabled accounts)
     */
    async mergeActiveTokens(activeTokens: any[], tokenToUpdate: any = null) {
        const allTokens = [...await this.readAll()];

        const applyUpdate = (targetToken: any) => {
            if (!targetToken) return;
            const index = allTokens.findIndex(t => t.refresh_token === targetToken.refresh_token);
            if (index !== -1) {
                const { sessionId, ...plain } = targetToken;
                allTokens[index] = { ...allTokens[index], ...plain };
            }
        };

        if (tokenToUpdate) {
            applyUpdate(tokenToUpdate);
        } else if (Array.isArray(activeTokens) && activeTokens.length > 0) {
            for (const memToken of activeTokens) {
                applyUpdate(memToken);
            }
        }

        await this.writeAll(allTokens);
    }
}

export default TokenStore;
