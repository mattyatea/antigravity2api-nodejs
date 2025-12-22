<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { authFetch } from '../utils/api';
import { useToast } from '../composables/useToast';
import { useSettings } from '../composables/useSettings';
import TokenCard from './TokenCard.vue';
import TokenDetailModal from './TokenDetailModal.vue';
import { useI18n } from 'vue-i18n';
import AppInput from './common/AppInput.vue';

const { showToast } = useToast();
const { toggleSensitiveInfo, sensitiveInfoHidden } = useSettings();
const { t } = useI18n();

const tokens = ref<any[]>([]);
const currentFilter = ref('all');
const showOAuth = ref(false);
const showManual = ref(false);
const showDetail = ref(false);
const selectedToken = ref<any>(null);

const oauthCallbackUrl = ref('');
const manualToken = ref({ accessToken: '', refreshToken: '', expiresIn: 3599 });

// OAuth specific vars
let oauthPort: number | null = null;
const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs'
].join(' ');

async function loadTokens() {
  try {
    const response = await authFetch('/admin/tokens');
    const data = await response.json();
    if (data.success) {
      tokens.value = data.data;
      checkExpired();
    } else {
      showToast(`${t('common.error')}: ${data.message}`, 'error');
    }
  } catch (e: any) {
    showToast(`${t('common.error')}: ${e.message}`, 'error');
  }
}

const filteredTokens = computed(() => {
  if (currentFilter.value === 'enabled') return tokens.value.filter(t => t.enable);
  if (currentFilter.value === 'disabled') return tokens.value.filter(t => !t.enable);
  return tokens.value;
});

const stats = computed(() => {
  return {
    total: tokens.value.length,
    enabled: tokens.value.filter(t => t.enable).length,
    disabled: tokens.value.filter(t => !t.enable).length
  };
});

function getOAuthUrl() {
    if (!oauthPort) oauthPort = Math.floor(Math.random() * 10000) + 50000;
    const redirectUri = `http://localhost:${oauthPort}/oauth-callback`;
    return `https://accounts.google.com/o/oauth2/v2/auth?` +
        `access_type=offline&client_id=${CLIENT_ID}&prompt=consent&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&` +
        `scope=${encodeURIComponent(SCOPES)}&state=${Date.now()}`;
}

function openOAuthWindow() {
    window.open(getOAuthUrl(), '_blank');
}

function copyOAuthUrl() {
    const url = getOAuthUrl();
    navigator.clipboard.writeText(url).then(() => {
        showToast(t('oauth.link_copied'), 'success');
    }).catch(() => {
        showToast(t('common.error'), 'error');
    });
}

function openOAuthModal() {
    showToast(t('common.info'), 'info');
    showOAuth.value = true;
}

async function processOAuth() {
    const callbackUrl = oauthCallbackUrl.value.trim();
    if (!callbackUrl) {
        showToast(t('common.warning'), 'warning');
        return;
    }
    
    showToast(t('common.loading'), 'info');
    
    try {
        const url = new URL(callbackUrl);
        const code = url.searchParams.get('code');
        const port = new URL(url.origin).port || (url.protocol === 'https:' ? 443 : 80);
        
        if (!code) {
             showToast(t('common.error'), 'error');
             return;
        }

        const response = await authFetch('/admin/oauth/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, port })
        });
        
        const result = await response.json();
        if (result.success) {
            const account = result.data;
            const addResponse = await authFetch('/admin/tokens', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(account)
            });
            const addResult = await addResponse.json();
            
            if (addResult.success) {
                showOAuth.value = false;
                oauthCallbackUrl.value = '';
                showToast(t('common.success'), 'success');
                loadTokens();
            } else {
                showToast(`${t('common.error')}: ${addResult.message}`, 'error');
            }
        } else {
            showToast(`${t('common.error')}: ${result.message}`, 'error');
        }
    } catch (e: any) {
        showToast(`${t('common.error')}: ${e.message}`, 'error');
    }
}

async function addManualToken() {
    if (!manualToken.value.accessToken || !manualToken.value.refreshToken) {
        showToast(t('common.warning'), 'warning');
        return;
    }
    
    try {
        const response = await authFetch('/admin/tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                access_token: manualToken.value.accessToken, 
                refresh_token: manualToken.value.refreshToken, 
                expires_in: Number(manualToken.value.expiresIn) 
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showManual.value = false;
            manualToken.value = { accessToken: '', refreshToken: '', expiresIn: 3599 };
            showToast(t('common.success'), 'success');
            loadTokens();
        } else {
            showToast(`${t('common.error')}: ${data.message}`, 'error');
        }
    } catch (e: any) {
        showToast(`${t('common.error')}: ${e.message}`, 'error');
    }
}

async function deleteToken(refreshToken: string) {
    if (!confirm(t('tokens.delete_confirm'))) return;
    try {
        const response = await authFetch(`/admin/tokens/${encodeURIComponent(refreshToken)}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            showToast(t('common.success'), 'success');
            loadTokens(); // reload list
        } else {
            showToast(`${t('common.error')}: ${data.message}`, 'error');
        }
    } catch (e: any) {
        showToast(`${t('common.error')}: ${e.message}`, 'error');
    }
}

function handleEdit(token: any) {
    selectedToken.value = token;
    showDetail.value = true;
}

function handleViewQuota(_token: any) {
    showToast(t('tokens.quota_detail'), 'info');
}

// Auto refresh expired logic
const refreshingTokens = new Set();
function checkExpired() {
    tokens.value.forEach(token => {
        const expireTime = new Date(token.timestamp + token.expires_in * 1000);
        if (expireTime < new Date() && token.enable && !refreshingTokens.has(token.refresh_token)) {
             autoRefresh(token.refresh_token);
        }
    });
}

async function autoRefresh(refreshToken: string) {
    refreshingTokens.add(refreshToken);
    try {
         const response = await authFetch(`/admin/tokens/${encodeURIComponent(refreshToken)}/refresh`, {
             method: 'POST'
         });
         const data = await response.json();
         if (data.success) {
             showToast(t('common.success'), 'success');
             loadTokens();
         }
    } catch (e) {}
    refreshingTokens.delete(refreshToken);
}

onMounted(() => {
    loadTokens();
});
</script>

<template>
  <div class="flex flex-1 flex-col min-h-0 overflow-hidden">
      <div class="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:bg-black dark:border-gray-800">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <!-- Stats -->
              <!-- Stats -->
              <div class="flex gap-1 p-1 bg-gray-100 dark:bg-gray-900 rounded-lg">
                  <button 
                    class="flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all"
                    :class="currentFilter === 'all' ? 'bg-white text-black shadow-sm dark:bg-gray-800 dark:text-white' : 'text-gray-500 hover:text-black hover:bg-white/50 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800/50'"
                    @click="currentFilter = 'all'"
                  >
                      <span class="font-bold">{{ stats.total }}</span>
                      <span class="text-xs uppercase tracking-wider opacity-70">{{ t('tokens.total') }}</span>
                  </button>
                  <button 
                    class="flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all"
                    :class="currentFilter === 'enabled' ? 'bg-white text-black shadow-sm dark:bg-gray-800 dark:text-white' : 'text-gray-500 hover:text-black hover:bg-white/50 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800/50'"
                    @click="currentFilter = 'enabled'"
                  >
                      <span class="font-bold">{{ stats.enabled }}</span>
                      <span class="text-xs uppercase tracking-wider opacity-70">{{ t('tokens.enabled_count') }}</span>
                  </button>
                  <button 
                    class="flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all"
                    :class="currentFilter === 'disabled' ? 'bg-white text-black shadow-sm dark:bg-gray-800 dark:text-white' : 'text-gray-500 hover:text-black hover:bg-white/50 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800/50'"
                    @click="currentFilter = 'disabled'"
                  >
                      <span class="font-bold">{{ stats.disabled }}</span>
                      <span class="text-xs uppercase tracking-wider opacity-70">{{ t('tokens.disabled_count') }}</span>
                  </button>
              </div>

              <!-- Actions -->
              <div class="flex flex-wrap gap-2">
                    <button type="button" @click="openOAuthModal" class="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        {{ t('tokens.oauth_btn') }}
                    </button>
                    <button type="button" @click="showManual = true" class="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-black dark:text-gray-300 dark:hover:bg-gray-900">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                        {{ t('tokens.manual_btn') }}
                    </button>
                    <button type="button" @click="loadTokens" class="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed text-gray-600 hover:bg-gray-100 hover:text-black dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-white" v-tooltip="t('tokens.refresh_btn')">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
                    </button>
                    <button type="button" @click="toggleSensitiveInfo" class="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed text-gray-600 hover:bg-gray-100 hover:text-black dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-white" v-tooltip="sensitiveInfoHidden ? t('tokens.show_sensitive') : t('tokens.hide_sensitive')">
                       <svg v-if="sensitiveInfoHidden" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
                       <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                   </button>
              </div>
          </div>
      </div>

      <div class="grid grid-cols-1 gap-4 overflow-y-auto p-1 pt-0 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]" id="tokenList">
          <div v-if="filteredTokens.length === 0" class="col-span-full flex min-h-[300px] flex-col items-center justify-center py-12 text-center text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="mb-4 opacity-50"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
              <div class="mb-2 text-lg font-medium text-black dark:text-white">{{ t('tokens.empty') }}</div>
              <div class="text-sm">{{ t('tokens.empty_hint') }}</div>
          </div>
          
          <TokenCard 
             v-for="(token, index) in filteredTokens" 
             :key="token.refresh_token" 
             :token="token" 
             :index="index"
             @refresh-list="loadTokens"
             @delete="deleteToken"
             @edit="handleEdit"
             @view-quota="handleViewQuota"
          />
      </div>

      <!-- OAuth Modal -->
      <div v-if="showOAuth" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" @click.self="showOAuth = false">
          <div class="w-full max-w-[480px] rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-black">
              <div class="mb-4 text-lg font-bold text-black dark:text-white">{{ t('oauth.title') }}</div>
              <div class="mb-6 rounded bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                  <p class="mb-2"><strong>{{ t('oauth.title') }}</strong></p>
                  <p class="mb-2">1. {{ t('oauth.step1') }}</p>
                  <p class="mb-2">2. {{ t('oauth.step2') }}</p>
                  <p class="mb-0">3. {{ t('oauth.step3') }}</p>
              </div>
               <div class="mb-4 flex gap-3">
                  <button type="button" @click="openOAuthWindow" class="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200 flex-1 justify-center">{{ t('oauth.open_page') }}</button>
                  <button type="button" @click="copyOAuthUrl" class="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-black dark:text-gray-300 dark:hover:bg-gray-900 flex-1 justify-center">{{ t('oauth.copy_link') }}</button>
              </div>
              <div class="mb-6">
                  <AppInput 
                    v-model="oauthCallbackUrl" 
                    :placeholder="t('oauth.callback_placeholder')" 
                  />
              </div>
              <div class="flex justify-end gap-3">
                  <button class="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed text-gray-600 hover:bg-gray-100 hover:text-black dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-white" @click="showOAuth = false">{{ t('common.cancel') }}</button>
                  <button class="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200" @click="processOAuth">{{ t('oauth.submit') }}</button>
              </div>
          </div>
      </div>

      <!-- Manual Modal -->
      <div v-if="showManual" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" @click.self="showManual = false">
          <div class="w-full max-w-[480px] rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-black">
              <div class="mb-4 text-lg font-bold text-black dark:text-white">{{ t('manual.title') }}</div>
               <div class="mb-6 flex flex-col gap-4">
                  <AppInput v-model="manualToken.accessToken" placeholder="Access Token" />
                  <AppInput v-model="manualToken.refreshToken" placeholder="Refresh Token" />
                  <AppInput v-model.number="manualToken.expiresIn" placeholder="Expires In (s)" type="number" />
              </div>
              <p class="mb-6 text-xs text-gray-500">{{ t('manual.expire_hint') }}</p>
              <div class="flex justify-end gap-3">
                  <button class="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed text-gray-600 hover:bg-gray-100 hover:text-black dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-white" @click="showManual = false">{{ t('common.cancel') }}</button>
                  <button class="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200" @click="addManualToken">{{ t('manual.add') }}</button>
              </div>
          </div>
      </div>
      
      <TokenDetailModal 
          :show="showDetail" 
          :token="selectedToken" 
          @close="showDetail = false"
          @saved="loadTokens"
      />
  </div>
</template>
