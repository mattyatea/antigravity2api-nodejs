import axios from 'axios';
import crypto from 'crypto';
import log from '../../utils/logger.js';
import config from '../../config/index.js';
import { generateProjectId } from '../../utils/id-generator.js';
// @ts-ignore
import tokenManager from './token-manager.js';
import { OAUTH_CONFIG, OAUTH_SCOPES } from '../../config/oauth.js';
import { buildAxiosRequestConfig } from '../../utils/http-client.js';

interface Account {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    timestamp: number;
    email?: string;
    projectId?: string;
    hasQuota?: boolean;
    enable?: boolean;
}

class OAuthManager {
    state: string;

    constructor() {
        this.state = crypto.randomUUID();
    }

    /**
     * Generate Auth URL
     */
    generateAuthUrl(port: number): string {
        const params = new URLSearchParams({
            access_type: 'offline',
            client_id: OAUTH_CONFIG.CLIENT_ID,
            prompt: 'consent',
            redirect_uri: `http://localhost:${port}/oauth-callback`,
            response_type: 'code',
            scope: OAUTH_SCOPES.join(' '),
            state: this.state
        });
        return `${OAUTH_CONFIG.AUTH_URL}?${params.toString()}`;
    }

    /**
     * Exchange auth code for Token
     */
    async exchangeCodeForToken(code: string, port: number) {
        const postData = new URLSearchParams({
            code,
            client_id: OAUTH_CONFIG.CLIENT_ID,
            client_secret: OAUTH_CONFIG.CLIENT_SECRET,
            redirect_uri: `http://localhost:${port}/oauth-callback`,
            grant_type: 'authorization_code'
        });

        const response = await axios(buildAxiosRequestConfig({
            method: 'POST',
            url: OAUTH_CONFIG.TOKEN_URL,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data: postData.toString(),
            timeout: config.timeout
        }));

        return response.data;
    }

    /**
     * Get user email
     */
    async fetchUserEmail(accessToken: string): Promise<string | null> {
        try {
            const response = await axios(buildAxiosRequestConfig({
                method: 'GET',
                url: 'https://www.googleapis.com/oauth2/v2/userinfo',
                headers: {
                    'Host': 'www.googleapis.com',
                    'User-Agent': 'Go-http-client/1.1',
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept-Encoding': 'gzip'
                },
                timeout: config.timeout
            }));
            return response.data?.email;
        } catch (err: any) {
            log.warn('Failed to get user email:', err.message);
            return null;
        }
    }

    /**
     * Qualifications check: try to fetch projectId, fallback to random if failed
     */
    async validateAndGetProjectId(accessToken: string): Promise<{ projectId: string; hasQuota: boolean }> {
        // If configured to skip API verification, return random projectId immediately
        // @ts-ignore
        if (config.skipProjectIdFetch) {
            const projectId = generateProjectId();
            log.info('Skipped API verification, using random projectId: ' + projectId);
            return { projectId, hasQuota: true };
        }

        // Try to fetch projectId from API
        try {
            log.info('Verifying account qualifications...');
            const projectId = await tokenManager.fetchProjectId({
                access_token: accessToken,
                refresh_token: '',
                expires_in: 0,
                timestamp: Date.now()
            });

            if (projectId === undefined) {
                // No qualification, unauthorized fallback to random projectId
                const randomProjectId = generateProjectId();
                log.warn('Account unqualified, fallback to unauthorized mode using random projectId: ' + randomProjectId);
                return { projectId: randomProjectId, hasQuota: false };
            }

            log.info('Account verified, projectId: ' + projectId);
            return { projectId, hasQuota: true };
        } catch (err: any) {
            // Fallback to random projectId on failure
            const randomProjectId = generateProjectId();
            log.warn('Failed to verify account qualifications: ' + err.message + ', falling back to unauthorized mode');
            log.info('Using randomly generated projectId: ' + randomProjectId);
            return { projectId: randomProjectId, hasQuota: false };
        }
    }

    /**
     * Complete OAuth flow: Token exchange -> Get Email -> Qualification Check
     */
    async authenticate(code: string, port: number): Promise<Account> {
        // 1. Exchange auth code for Token
        const tokenData = await this.exchangeCodeForToken(code, port);

        if (!tokenData.access_token) {
            throw new Error('Token exchange failed: access_token not found');
        }

        const account: Account = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: tokenData.expires_in,
            timestamp: Date.now()
        };

        // 2. Get user email
        const email = await this.fetchUserEmail(account.access_token);
        if (email) {
            account.email = email;
            log.info('Got user email: ' + email);
        }

        // 3. Qualification verification and projectId retrieval
        const { projectId, hasQuota } = await this.validateAndGetProjectId(account.access_token);
        account.projectId = projectId;
        account.hasQuota = hasQuota;
        account.enable = true;

        return account;
    }
}

export default new OAuthManager();
