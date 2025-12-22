// import { ref } from 'vue'; // Unused
import { authFetch } from '../utils/api';

interface QuotaCacheItem {
    data: any;
    timestamp: number;
}

const quotaCache: Record<string, QuotaCacheItem> = {};
const CACHE_TTL = 5 * 60 * 1000;

export function useQuota() {
    // const loading = ref(false); // Unused
    // const error = ref<string | null>(null); // Unused

    function getFromCache(refreshToken: string) {
        const cached = quotaCache[refreshToken];
        if (!cached) return null;
        if (Date.now() - cached.timestamp > CACHE_TTL) {
            delete quotaCache[refreshToken];
            return null;
        }
        return cached.data;
    }

    function setCache(refreshToken: string, data: any) {
        quotaCache[refreshToken] = { data, timestamp: Date.now() };
    }

    function clearCache(refreshToken?: string) {
        if (refreshToken) {
            delete quotaCache[refreshToken];
        } else {
            for (const key in quotaCache) delete quotaCache[key];
        }
    }

    async function fetchQuota(refreshToken: string, refresh = false) {
        if (!refresh) {
            const cached = getFromCache(refreshToken);
            if (cached) return cached;
        } else {
            clearCache(refreshToken);
        }

        try {
            const response = await authFetch(`/admin/tokens/${encodeURIComponent(refreshToken)}/quotas${refresh ? '?refresh=true' : ''}`);
            const data = await response.json();
            if (data.success && data.data) {
                setCache(refreshToken, data.data);
                return data.data;
            } else {
                throw new Error(data.message || 'Unknown error');
            }
        } catch (err: any) {
            throw err;
        }
    }

    return {
        fetchQuota,
        clearCache
    };
}
