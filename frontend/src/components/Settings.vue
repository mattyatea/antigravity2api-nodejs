<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { authFetch } from '../utils/api';
import { useToast } from '../composables/useToast';
import { useSettings } from '../composables/useSettings';
import { useI18n } from 'vue-i18n';
import AppInput from './common/AppInput.vue';

const { showToast } = useToast();
const { fontSize, setFontSize } = useSettings();
const { t } = useI18n();

const config = ref<any>({
  env: {},
  json: { server: {}, defaults: {}, other: {}, rotation: {} }
});

const rotationStatus = ref('');
const showRequestCount = ref(false);

async function loadConfig() {
  try {
    const response = await authFetch('/admin/config');
    const data = await response.json();
    if (data.success) {
      config.value = data.data;
      if (!config.value.json.server) config.value.json.server = {};
      if (!config.value.json.defaults) config.value.json.defaults = {};
      if (!config.value.json.other) config.value.json.other = {};
      if (!config.value.json.rotation) config.value.json.rotation = {};
      
      checkRotationStrategy();
      loadRotationStatus();
    }
  } catch (e: any) {
    showToast(`${t('common.error')}: ${e.message}`, 'error');
  }
}

async function loadRotationStatus() {
  try {
    const response = await authFetch('/admin/rotation');
    const data = await response.json();
    if (data.success) {
       const { strategy, requestCount, currentIndex } = data.data;
       const strategyNames: any = {
           'round_robin': t('settings.strategy_round_robin'),
           'quota_exhausted': t('settings.strategy_quota'),
           'request_count': t('settings.strategy_count')
       };
       let text = strategyNames[strategy] || strategy;
       if (strategy === 'request_count') text += ` (${t('settings.request_count')}: ${requestCount})`;
       text += ` | Index: ${currentIndex}`;
       rotationStatus.value = text;
    }
  } catch (e) {}
}

function checkRotationStrategy() {
    showRequestCount.value = config.value.json.rotation.strategy === 'request_count';
}

async function saveConfig() {
  showToast(t('common.loading'), 'info');
  try {
      const payload = {
          env: config.value.env,
          json: config.value.json
      };
      
      const response = await authFetch('/admin/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
      });
      const data = await response.json();
      
      if (config.value.json.rotation && Object.keys(config.value.json.rotation).length > 0) {
           await authFetch('/admin/rotation', {
               method: 'PUT',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify(config.value.json.rotation)
           });
      }
      
      if (data.success) {
          showToast(t('common.saved'), 'success');
          loadConfig();
      } else {
          showToast(`${t('common.error')}: ${data.message}`, 'error');
      }
  } catch (e: any) {
      showToast(`${t('common.error')}: ${e.message}`, 'error');
  }
}

onMounted(() => {
    loadConfig();
});
</script>

<template>
  <div class="w-full">
     <!-- Server Config -->
     <div class="grid grid-cols-1 gap-6 mb-6 items-stretch md:grid-cols-2 lg:grid-cols-3">
         <div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:bg-black dark:border-gray-800">
             <h4 class="mb-4 text-sm font-bold text-black dark:text-white flex items-center gap-2 uppercase tracking-wider">
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>
               {{ t('settings.server') }}
             </h4>
             <div class="mb-4 grid grid-cols-2 gap-4">
                 <div class="flex flex-col gap-1">
                     <AppInput 
                       v-model.number="config.json.server.port" 
                       :label="t('settings.server_port')" 
                       type="number" 
                       placeholder="8045" 
                     />
                 </div>
                 <div class="flex flex-col gap-1">
                     <AppInput 
                       v-model="config.json.server.host" 
                       :label="t('settings.server_host')" 
                       placeholder="0.0.0.0" 
                     />
                 </div>
             </div>
             <div class="mb-4 grid grid-cols-2 gap-4">
                  <div class="flex flex-col gap-1">
                      <AppInput 
                        v-model="config.json.server.maxRequestSize" 
                        :label="t('settings.max_request_size')" 
                        placeholder="500mb" 
                      />
                  </div>
                  <div class="flex flex-col gap-1">
                      <AppInput 
                        v-model="config.env.API_KEY" 
                        :label="t('settings.api_key')" 
                        type="password" 
                        placeholder="***" 
                      />
                  </div>
             </div>
             
             <div class="mb-4 flex flex-col gap-2">
                 <div class="flex items-center justify-between gap-3 rounded border border-gray-200 p-2 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900">
                     <label class="flex-1 text-xs font-medium text-gray-700 cursor-pointer dark:text-gray-300" @click="config.json.other.skipProjectIdFetch = !config.json.other.skipProjectIdFetch">{{ t('settings.skip_verify') }}</label>
                     <label class="relative inline-block h-5 w-9 shrink-0 cursor-pointer">
                         <input type="checkbox" v-model="config.json.other.skipProjectIdFetch" class="peer sr-only">
                         <span class="absolute inset-0 rounded-full bg-gray-200 transition-all peer-checked:bg-black dark:bg-gray-700 dark:peer-checked:bg-white"></span>
                         <span class="absolute bottom-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-all peer-checked:translate-x-4 shadow border border-gray-100 dark:border-gray-800 dark:bg-black"></span>
                     </label>
                 </div>
                 <div class="flex items-center justify-between gap-3 rounded border border-gray-200 p-2 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900">
                     <label class="flex-1 text-xs font-medium text-gray-700 cursor-pointer dark:text-gray-300" @click="config.json.other.useNativeAxios = !config.json.other.useNativeAxios">{{ t('settings.native_axios') }}</label>
                     <label class="relative inline-block h-5 w-9 shrink-0 cursor-pointer">
                         <input type="checkbox" v-model="config.json.other.useNativeAxios" class="peer sr-only">
                         <span class="absolute inset-0 rounded-full bg-gray-200 transition-all peer-checked:bg-black dark:bg-gray-700 dark:peer-checked:bg-white"></span>
                         <span class="absolute bottom-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-all peer-checked:translate-x-4 shadow border border-gray-100 dark:border-gray-800 dark:bg-black"></span>
                     </label>
                 </div>
             </div>

             <div class="mb-4 flex flex-col gap-1">
                 <AppInput 
                   v-model="config.env.IMAGE_BASE_URL" 
                   :label="t('settings.image_url')" 
                   placeholder="https://your-domain" 
                 />
             </div>
             <div class="flex flex-col gap-1">
                 <AppInput 
                   v-model="config.env.PROXY" 
                   :label="t('settings.proxy')" 
                   placeholder="http://127.0.0.1:7890" 
                 />
             </div>
         </div>

         <!-- Models -->
         <div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:bg-black dark:border-gray-800">
             <h4 class="mb-4 text-sm font-bold text-black dark:text-white flex items-center gap-2 uppercase tracking-wider">
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M8.5 4.5v.01"/><path d="M15.5 8.5v.01"/></svg>
               {{ t('settings.models') }}
             </h4>
             <div class="mb-4 grid grid-cols-2 gap-4">
                 <div class="flex flex-col gap-1">
                     <AppInput 
                       v-model.number="config.json.defaults.temperature" 
                       :label="t('settings.temperature')" 
                       type="number" 
                       placeholder="1" 
                       step="0.1" 
                     />
                 </div>
                 <div class="flex flex-col gap-1">
                     <AppInput 
                       v-model.number="config.json.defaults.topP" 
                       :label="t('settings.top_p')" 
                       type="number" 
                       placeholder="1" 
                       step="0.01" 
                     />
                 </div>
             </div>
             
             <div class="mb-4 mt-2 flex flex-col gap-1">
                 <AppInput 
                   v-model.number="config.json.defaults.thinkingBudget" 
                   :label="t('settings.thinking_budget')" 
                   type="number" 
                   placeholder="16000" 
                 />
             </div>

             <div class="mb-4 flex flex-col gap-2">
                  <div class="flex items-center justify-between gap-3 rounded border border-gray-200 p-2 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900">
                      <label class="flex-1 text-xs font-medium text-gray-700 cursor-pointer dark:text-gray-300" @click="config.json.other.useContextSystemPrompt = !config.json.other.useContextSystemPrompt">{{ t('settings.context_system') }}</label>
                      <label class="relative inline-block h-5 w-9 shrink-0 cursor-pointer">
                          <input type="checkbox" v-model="config.json.other.useContextSystemPrompt" class="peer sr-only">
                          <span class="absolute inset-0 rounded-full bg-gray-200 transition-all peer-checked:bg-black dark:bg-gray-700 dark:peer-checked:bg-white"></span>
                          <span class="absolute bottom-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-all peer-checked:translate-x-4 shadow border border-gray-100 dark:border-gray-800 dark:bg-black"></span>
                      </label>
                  </div>
             </div>
             
             <div class="flex flex-col gap-2">
                 <label class="text-sm font-semibold text-gray-700 dark:text-gray-300">{{ t('settings.system_instruction') }}</label>
                 <textarea 
                   class="w-full min-h-[100px] resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black dark:border-gray-700 dark:bg-black dark:text-white dark:focus:border-white dark:focus:ring-white" 
                   v-model="config.env.SYSTEM_INSTRUCTION" 
                   rows="4"
                 ></textarea>
             </div>
         </div>
         
         <!-- Rotation -->
         <div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:bg-black dark:border-gray-800">
             <h4 class="mb-4 text-sm font-bold text-black dark:text-white flex items-center gap-2 uppercase tracking-wider">
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
               {{ t('settings.rotation') }}
             </h4>
             <div class="mb-4 flex flex-col gap-2">
                  <div class="flex items-center justify-between gap-3 rounded border border-gray-200 p-2 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900">
                      <label class="flex-1 text-xs font-medium text-gray-700 cursor-pointer dark:text-gray-300" @click="config.json.other.passSignatureToClient = !config.json.other.passSignatureToClient">{{ t('settings.pass_signature') }}</label>
                      <label class="relative inline-block h-5 w-9 shrink-0 cursor-pointer">
                          <input type="checkbox" v-model="config.json.other.passSignatureToClient" class="peer sr-only">
                          <span class="absolute inset-0 rounded-full bg-gray-200 transition-all peer-checked:bg-black dark:bg-gray-700 dark:peer-checked:bg-white"></span>
                          <span class="absolute bottom-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-all peer-checked:translate-x-4 shadow border border-gray-100 dark:border-gray-800 dark:bg-black"></span>
                      </label>
                  </div>
             </div>
             <div class="mb-4 grid grid-cols-2 gap-4">
                 <div class="flex flex-col gap-1">
                     <label class="text-sm font-semibold text-gray-700 dark:text-gray-300">{{ t('settings.strategy') }}</label>
                     <div class="relative">
                        <select 
                            class="w-full appearance-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:border-black focus:outline-none focus:ring-1 focus:ring-black dark:border-gray-700 dark:bg-black dark:text-white dark:focus:border-white dark:focus:ring-white cursor-pointer" 
                            style="background-image: url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E'); background-position: right 0.75rem center; background-repeat: no-repeat; background-size: 1.25em 1.25em;"
                            v-model="config.json.rotation.strategy" 
                            @change="checkRotationStrategy"
                        >
                            <option value="round_robin">{{ t('settings.strategy_round_robin') }}</option>
                            <option value="quota_exhausted">{{ t('settings.strategy_quota') }}</option>
                            <option value="request_count">{{ t('settings.strategy_count') }}</option>
                        </select>
                     </div>
                 </div>
                 <div class="flex flex-col gap-1" v-if="showRequestCount">
                     <AppInput 
                       v-model.number="config.json.rotation.requestCount" 
                       :label="t('settings.request_count')" 
                       type="number" 
                       min="1" 
                       placeholder="10" 
                     />
                 </div>
             </div>
             <div class="mt-2 flex items-center gap-2 rounded bg-gray-50 px-3 py-2 text-xs font-mono text-gray-600 border border-gray-100 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-400" v-if="rotationStatus">
                 {{ rotationStatus }}
             </div>

             <div class="mt-6 flex flex-col gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
                 <label class="text-sm font-semibold text-gray-700 dark:text-gray-300">{{ t('settings.font_size') }} (px)</label>
                 <div class="flex items-center gap-3">
                     <input class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 accent-black dark:bg-gray-800 dark:accent-white" type="range" min="10" max="24" v-model="fontSize" @input="setFontSize(fontSize)">
                     <input class="w-[60px] rounded-md border border-gray-300 bg-white px-2 py-1 text-center text-sm text-black focus:border-black focus:outline-none focus:ring-1 focus:ring-black dark:border-gray-700 dark:bg-black dark:text-white" type="number" min="10" max="24" v-model="fontSize" @change="setFontSize(fontSize)">
                 </div>
             </div>
         </div>
     </div>

     <div class="flex justify-start gap-4 mt-8">
         <button @click="saveConfig" class="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed h-11 bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200 min-w-[120px] justify-center">{{ t('settings.save_config') }}</button>
         <button @click="loadConfig" class="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-opacity-50 disabled:cursor-not-allowed h-11 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-black dark:text-gray-300 dark:hover:bg-gray-900 min-w-[120px] justify-center">{{ t('settings.reload_config') }}</button>
     </div>
  </div>
</template>
