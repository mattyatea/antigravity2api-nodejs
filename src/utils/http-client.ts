import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import dns from 'dns';
import http from 'http';
import https from 'https';
import config from '../config/index.js';

// ==================== Unified DNS & Proxy Configuration ====================

// Custom DNS resolution: failover to IPv6 if IPv4 fails
function customLookup(
    hostname: string,
    options: dns.LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
) {
    // Ensure 'all' is false to get single address
    const lookupOptions = { ...options, all: false };

    dns.lookup(hostname, { ...lookupOptions, family: 4 }, (err4, address4, family4) => {
        if (!err4 && address4 && typeof address4 === 'string') {
            return callback(null, address4, family4);
        }
        dns.lookup(hostname, { ...lookupOptions, family: 6 }, (err6, address6, family6) => {
            if (!err6 && address6 && typeof address6 === 'string') {
                return callback(null, address6, family6);
            }
            callback(err4 || err6 || new Error('DNS lookup failed'), '', 0);
        });
    });
}

// Agent using custom DNS resolution (prefer IPv4, fallback to IPv6)
const httpAgent = new http.Agent({
    lookup: customLookup as any,
    keepAlive: true
});

const httpsAgent = new https.Agent({
    lookup: customLookup as any,
    keepAlive: true
});

// Build unified proxy configuration
function buildProxyConfig(): { protocol: string; host: string; port: number } | false {
    // @ts-ignore
    if (!config.proxy) return false;
    try {
        // @ts-ignore
        const proxyUrl = new URL(config.proxy);
        const port = parseInt(proxyUrl.port, 10);
        const host = proxyUrl.hostname;

        // Validate that we have valid host and port
        if (!host || !port || isNaN(port)) {
            return false;
        }

        return {
            protocol: proxyUrl.protocol.replace(':', ''),
            host,
            port
        };
    } catch {
        return false;
    }
}

interface HttpRequestOptions {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    data?: any;
    timeout?: number;
}

// Build unified request config for axios
export function buildAxiosRequestConfig({ method = 'POST', url, headers, data = null, timeout = config.timeout }: HttpRequestOptions): AxiosRequestConfig {
    const axiosConfig: AxiosRequestConfig = {
        method: method as any,
        url,
        headers,
        timeout,
        httpAgent,
        httpsAgent,
        proxy: buildProxyConfig()
    };

    if (data !== null) axiosConfig.data = data;
    return axiosConfig;
}

// Simple axios call wrapper for future extension (retry, metrics, etc.)
export async function httpRequest(configOverrides: HttpRequestOptions): Promise<AxiosResponse> {
    const axiosConfig = buildAxiosRequestConfig(configOverrides);
    return axios(axiosConfig);
}

// Stream request wrapper
export async function httpStreamRequest(configOverrides: HttpRequestOptions): Promise<AxiosResponse> {
    const axiosConfig = buildAxiosRequestConfig(configOverrides);
    axiosConfig.responseType = 'stream';
    return axios(axiosConfig);
}
