<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useToast } from '../composables/useToast';
import { useI18n } from 'vue-i18n';
import AppInput from '../components/common/AppInput.vue';

const username = ref('');
const password = ref('');
const isLoading = ref(false);

const router = useRouter();
const authStore = useAuthStore();
const { showToast } = useToast();
const { t } = useI18n();

async function handleLogin() {
  if (isLoading.value) return;
  
  isLoading.value = true;
  
  try {
    const response = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: password.value })
    });
    
    const data = await response.json();
    
    if (data.success) {
      authStore.setToken(data.token);
      showToast(t('common.success'), 'success');
      router.push('/');
    } else {
      showToast(data.message || t('common.error'), 'error');
    }
  } catch (error: any) {
    showToast(`${t('common.error')}: ${error.message}`, 'error');
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <div class="flex h-screen w-full items-center justify-center bg-gray-50 p-4 dark:bg-black">
    <div id="loginForm" class="w-full max-w-[400px] rounded-lg border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-black">
      <h2 class="mb-2 text-center text-2xl font-bold tracking-tight text-black dark:text-white">
        Antigravity
      </h2>
      <p class="mb-8 text-center text-sm text-gray-500">
        {{ t('app.title') }}
      </p>

      <form @submit.prevent="handleLogin" class="space-y-4">
        <div>
          <AppInput 
            v-model="username" 
            :label="t('app.username')"
            required 
            autocomplete="username"
            :disabled="isLoading"
          />
        </div>
        <div>
           <AppInput 
            v-model="password" 
            :label="t('app.password')"
            type="password"
            required 
            autocomplete="current-password"
            :disabled="isLoading"
          />
        </div>
        <button 
          type="submit" 
          class="flex w-full items-center justify-center rounded-md bg-black px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-white dark:text-black dark:hover:bg-gray-200"
          :disabled="isLoading"
        >
          <span v-if="isLoading" class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
          {{ isLoading ? t('app.logging_in') : t('app.login') }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* Scoped styles removed in favor of utility classes */
</style>
