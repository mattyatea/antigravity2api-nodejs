<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useQuota } from '../composables/useQuota';
import { useSettings } from '../composables/useSettings';
import { authFetch } from '../utils/api';
import { useToast } from '../composables/useToast';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  token: any;
  index: number;
}>();

const emit = defineEmits(['refresh-list', 'delete', 'view-quota', 'edit']);

const { fetchQuota } = useQuota();
const { sensitiveInfoHidden } = useSettings();
const { showToast } = useToast();
const { t } = useI18n();

const isRefreshing = ref(false);
const quotaSummary = ref<any>(null);
const quotaDetail = ref<any>(null);
const quotaLoading = ref(false);
const isExpanded = ref(false);
const quotaError = ref<string|null>(null);

const expireTime = computed(() => {
  return new Date(props.token.timestamp + props.token.expires_in * 1000);
});

const isExpired = computed(() => {
  return expireTime.value < new Date();
});

const expireStr = computed(() => {
  return expireTime.value.toLocaleString(undefined, {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
});

// const cardId = computed(() => props.token.refresh_token.substring(0, 8)); // Unused

// Quota Summary Logic
async function loadSummary() {
  try {
    const data = await fetchQuota(props.token.refresh_token);
    if (data && data.models) {
       // Find min quota
       const models = data.models;
       const entries = Object.entries(models);
       if (entries.length === 0 || !entries[0]) {
         quotaSummary.value = { text: 'N/A' };
         return;
       }
       
       let minModel = entries[0][0];
       let minQuota: any = entries[0][1];
       
       entries.forEach(([mId, q]: [string, any]) => {
         if (q.remaining < minQuota.remaining) {
           minQuota = q;
           minModel = mId;
         }
       });
       
        const percentage = minQuota.remaining * 100;
        const shortName = minModel.replace('models/', '').replace('publishers/google/', '').split('/').pop();
        
        quotaSummary.value = {
          shortName,
          percentage,
          barColor: percentage > 50 ? '#10b981' : percentage > 20 ? '#f59e0b' : '#ef4444', 
          pctText: `${percentage.toFixed(2)}%`,
          fullName: minModel
        };
    }
  } catch (e) {
    quotaSummary.value = { error: true };
  }
}

// Actions
async function manualRefresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    const response = await authFetch(`/admin/tokens/${encodeURIComponent(props.token.refresh_token)}/refresh`, {
      method: 'POST'
    });
    const data = await response.json();
    if (data.success) {
      showToast(t('common.success'), 'success');
      emit('refresh-list');
    } else {
      showToast(`${t('tokens.refresh_failed')}: ${data.message}`, 'error');
    }
  } catch (e: any) {
    showToast(`${t('tokens.refresh_failed')}: ${e.message}`, 'error');
  } finally {
    isRefreshing.value = false;
  }
}

async function toggleToken() {
  const actionText = props.token.enable ? t('tokens.status_disable_action') : t('tokens.status_enable_action');
  if (!confirm(t('tokens.toggle_confirm', { action: actionText }))) return;
  
  try {
    const response = await authFetch(`/admin/tokens/${encodeURIComponent(props.token.refresh_token)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: !props.token.enable })
    });
    const data = await response.json();
    if (data.success) {
      showToast(t('common.success'), 'success');
      emit('refresh-list');
    } else {
      showToast(t('common.error'), 'error');
    }
  } catch (e: any) {
    showToast(`${t('common.error')}: ${e.message}`, 'error');
  }
}

async function deleteToken() {
    emit('delete', props.token.refresh_token);
}

// Inline Quota Detail
async function toggleQuota() {
  isExpanded.value = !isExpanded.value;
  if (isExpanded.value && !quotaDetail.value) {
    await loadDetail();
  }
}

async function loadDetail(force = false) {
  quotaLoading.value = true;
  quotaError.value = null;
  try {
    const data = await fetchQuota(props.token.refresh_token, force);
    if (data && data.models) {
        // Group models
        const grouped: any = { claude: [], gemini: [], other: [] };
        Object.entries(data.models).forEach(([modelId, quota]: [string, any]) => {
            const item = { modelId, quota };
            const lower = modelId.toLowerCase();
            if (lower.includes('claude')) grouped.claude.push(item);
            else if (lower.includes('gemini')) grouped.gemini.push(item);
            else grouped.other.push(item);
        });
        quotaDetail.value = grouped;
        // Also update summary
        loadSummary(); 
    } else {
        quotaError.value = t('tokens.empty');
    }
  } catch (e: any) {
    quotaError.value = e.message || t('common.error');
  } finally {
    quotaLoading.value = false;
  }
}

// Edit fields
async function updateField(field: string, value: string) {
    try {
        const response = await authFetch(`/admin/tokens/${encodeURIComponent(props.token.refresh_token)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [field]: value })
        });
        const data = await response.json();
        if (data.success) {
            showToast(t('common.saved'), 'success');
            emit('refresh-list');
        } else {
            showToast(t('common.error'), 'error');
        }
    } catch (e: any) {
        showToast(t('common.error'), 'error');
    }
}

function editSingle(field: string, currentValue: string) {
    const label = field === 'projectId' ? t('tokens.id_label') : t('tokens.email_label');
    const newVal = prompt(`${t('common.edit')} ${label}`, currentValue);
    if (newVal !== null && newVal !== currentValue) {
        updateField(field, newVal);
    }
}

onMounted(() => {
  loadSummary();
});
</script>

<template>
  <div 
    class="group relative flex flex-col rounded-lg border p-4 transition-all duration-200 bg-white dark:bg-black shadow-sm hover:border-black dark:hover:border-white hover:shadow-md" 
    :class="{ 
        'opacity-60': !token.enable, 
        'border-gray-200 dark:border-gray-800': !isRefreshing,
        'border-black dark:border-white ring-1 ring-black dark:ring-white': isRefreshing
    }"
  >
    <div class="mb-3 flex items-center justify-between">
        <span class="inline-flex items-center rounded-md px-2 py-1 text-xs font-bold border" :class="token.enable ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white' : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'">
            {{ token.enable ? t('common.enabled') : t('common.disabled') }}
        </span>
        <div class="flex items-center gap-2">
            <button class="flex h-6 w-6 items-center justify-center rounded border border-gray-200 hover:border-black hover:bg-black hover:text-white transition-colors text-xs" @click="$emit('edit', token)" v-tooltip="t('common.edit')">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
            </button>
            <span class="text-xs text-gray-400 font-mono">#{{ index + 1 }}</span>
        </div>
    </div>
    
    <div class="mb-4 flex flex-col gap-2">
        <div class="flex items-center gap-2 text-xs font-mono" v-show="!sensitiveInfoHidden">
            <span class="text-gray-400 w-4">ID</span>
            <span class="truncate text-black dark:text-white" v-tooltip="token.access_token_suffix">{{ token.access_token_suffix }}</span>
        </div>
        <div class="group/row flex cursor-pointer items-center gap-2 rounded px-1 -mx-1 py-0.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-900" v-show="!sensitiveInfoHidden" @click="editSingle('projectId', token.projectId)" v-tooltip="t('common.edit')">
            <span class="text-gray-400 w-4">PR</span>
            <span class="truncate text-gray-700 dark:text-gray-300">{{ token.projectId || t('tokens.project_id_placeholder') }}</span>
        </div>
        <div class="group/row flex cursor-pointer items-center gap-2 rounded px-1 -mx-1 py-0.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-900" v-show="!sensitiveInfoHidden" @click="editSingle('email', token.email)" v-tooltip="t('common.edit')">
             <span class="text-gray-400 w-4">@</span>
             <span class="truncate text-gray-700 dark:text-gray-300">{{ token.email || t('tokens.email_placeholder') }}</span>
        </div>
        <div class="flex items-center gap-2 text-xs mt-1">
             <span class="text-gray-400 w-4">Ex</span>
             <span :class="{ 'text-black font-bold dark:text-white': isExpired, 'text-gray-600 dark:text-gray-400': !isExpired }">
                {{ isRefreshing ? t('tokens.refreshing') : expireStr }}
                <span v-if="isExpired && !isRefreshing"> ({{ t('tokens.expired') }})</span>
             </span>
             <button class="ml-auto p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors" @click="manualRefresh" v-tooltip="t('tokens.refresh_btn')" :disabled="isRefreshing">
                 <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{'animate-spin': isRefreshing}"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
             </button>
        </div>
    </div>

    <!-- Quota Inline -->
    <div class="mb-4 overflow-hidden rounded-md border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/50">
        <div class="flex cursor-pointer items-center justify-between p-2 px-3 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800" @click="toggleQuota">
             <span class="flex min-w-0 flex-1 items-center gap-3 text-xs">
                 <template v-if="quotaSummary && !quotaSummary.error && !quotaSummary.text">
                     <span class="flex-1 min-w-0 truncate font-medium text-gray-900 dark:text-gray-100" v-tooltip="quotaSummary.fullName">{{ quotaSummary.shortName }}</span>
                     <div class="flex items-center gap-2">
                         <span class="h-1.5 w-[60px] shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"><span class="block h-full rounded-full bg-black dark:bg-white" :style="{ width: quotaSummary.percentage + '%' }"></span></span>
                         <span class="min-w-[32px] shrink-0 font-mono text-right text-[10px]">{{ quotaSummary.pctText }}</span>
                     </div>
                 </template>
                 <template v-else-if="quotaSummary && quotaSummary.text">
                     {{ quotaSummary.text }}
                 </template>
                 <template v-else-if="quotaSummary && quotaSummary.error">
                     <span class="text-[10px] text-gray-500">{{ t('common.error') }}</span>
                 </template>
                 <template v-else>
                     {{ t('common.loading') }}
                 </template>
             </span>
             <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-2 text-gray-400 transition-transform duration-200" :class="{ 'rotate-180': isExpanded }"><path d="m6 9 6 6 6-6"/></svg>
        </div>
        
        <div class="border-t border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-black" v-if="isExpanded">
             <div v-if="quotaLoading" class="p-2 text-center text-[10px] text-gray-400">{{ t('common.loading') }}</div>
             <div v-else-if="quotaError" class="p-2 text-center text-[10px] text-gray-500">{{ quotaError }}</div>
             <div v-else class="flex flex-col gap-2">
                 <template v-for="(group, key) in quotaDetail" :key="key">
                    <div v-for="item in group" :key="item.modelId" class="flex items-center gap-2 text-[10px]" v-tooltip="item.modelId">
                        <span class="w-12 shrink-0 truncate text-gray-500 uppercase font-mono">{{ key }}</span>
                        <span class="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-300">{{ item.modelId.split('/').pop() }}</span>
                        <span class="h-1 w-[40px] shrink-0 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                            <span class="block h-full rounded-full bg-black dark:bg-white" :style="{ width: (item.quota.remaining * 100) + '%' }"></span>
                        </span>
                        <span class="min-w-[28px] shrink-0 font-mono text-right text-gray-900 dark:text-gray-100">{{ (item.quota.remaining * 100).toFixed(0) }}%</span>
                    </div>
                 </template>
                 
                 <button class="mt-2 w-full rounded border border-gray-200 py-1 text-center text-[10px] font-medium text-gray-600 hover:bg-gray-50 hover:text-black dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-white transition-colors" @click.stop="loadDetail(true)">{{ t('tokens.quota_refresh') }}</button>
             </div>
        </div>
    </div>

    <div class="flex justify-end gap-2 mt-auto pt-2 border-t border-gray-100 dark:border-gray-800">
        <button class="px-3 py-1.5 text-xs rounded font-medium transition-colors flex items-center justify-center gap-1.5" :class="token.enable ? 'bg-white border border-gray-200 text-black hover:bg-gray-50 dark:bg-black dark:border-gray-700 dark:text-white dark:hover:bg-gray-900' : 'bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200'" @click="toggleToken">
             {{ token.enable ? t('common.disabled') : t('common.enabled') }}
        </button>
        <button class="px-3 py-1.5 text-xs rounded font-medium transition-colors flex items-center justify-center gap-1.5 text-gray-500 hover:text-red-500 hover:bg-transparent" @click="deleteToken" v-tooltip="t('common.delete')">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
    </div>
  </div>
</template>
