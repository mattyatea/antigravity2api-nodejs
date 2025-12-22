<script setup lang="ts">
import { ref, watch } from 'vue';
import { authFetch } from '../utils/api';
import { useToast } from '../composables/useToast';
import { useI18n } from 'vue-i18n';
import AppInput from './common/AppInput.vue';

const props = defineProps<{
  token: any;
  show: boolean;
}>();

const emit = defineEmits(['close', 'saved']);

const { showToast } = useToast();
const { t } = useI18n();

const form = ref({
    projectId: '',
    email: ''
});

watch(() => props.token, (newVal) => {
    if (newVal) {
        form.value.projectId = newVal.projectId || '';
        form.value.email = newVal.email || '';
    }
}, { immediate: true });

async function save() {
    try {
        const response = await authFetch(`/admin/tokens/${encodeURIComponent(props.token.refresh_token)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form.value)
        });
        const data = await response.json();
        if (data.success) {
            showToast(t('common.saved'), 'success');
            emit('saved');
            emit('close');
        } else {
            showToast(`${t('common.error')}: ${data.message}`, 'error');
        }
    } catch (e: any) {
        showToast(`${t('common.error')}: ${e.message}`, 'error');
    }
}
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" @click.self="$emit('close')">
      <div class="w-full max-w-[400px] rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-black">
          <div class="mb-4 text-base font-bold text-black dark:text-white">{{ t('common.edit') }}</div>
          <div class="mb-4">
              <label class="block mb-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ t('tokens.access_token') }}</label>
              <div class="rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-600 break-all overflow-y-auto max-h-[80px] select-all cursor-text dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">{{ token.access_token || '' }}</div>
          </div>
          <div class="mb-4">
              <label class="block mb-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ t('tokens.refresh_token') }}</label>
              <div class="rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-600 break-all overflow-y-auto max-h-[80px] select-all cursor-text dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">{{ token.refresh_token }}</div>
          </div>
          <div class="mb-4">
              <AppInput 
                v-model="form.projectId" 
                :label="t('tokens.id_label')" 
                :placeholder="t('tokens.project_id_placeholder')" 
              />
          </div>
          <div class="mb-4">
              <AppInput 
                v-model="form.email" 
                :label="t('tokens.email_label')" 
                type="email" 
                :placeholder="t('tokens.email_placeholder')" 
              />
          </div>
           <div class="mb-4">
                <label class="block mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ t('tokens.expire_time') }}</label>
                <input class="w-full min-h-[36px] px-3 py-2 text-xs border border-gray-200 rounded-md bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 opacity-80 cursor-not-allowed focus:outline-none font-mono" type="text" :value="new Date(token.timestamp + token.expires_in * 1000).toLocaleString()" readonly>
            </div>
          <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
              <button class="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed text-gray-600 hover:bg-gray-100 hover:text-black dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-white" @click="$emit('close')">{{ t('common.cancel') }}</button>
              <button class="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200" @click="save">{{ t('common.save') }}</button>
          </div>
      </div>
  </div>
</template>
