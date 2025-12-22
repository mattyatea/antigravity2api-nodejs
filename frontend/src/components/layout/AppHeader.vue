<script setup lang="ts">
import { useAuthStore } from '../../stores/auth'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()
const { t, locale } = useI18n()

const toggleLanguage = () => {
  if (locale.value === 'en-US') {
    locale.value = 'zh-CN'
  } else if (locale.value === 'zh-CN') {
    locale.value = 'ja-JP'
  } else {
    locale.value = 'en-US'
  }
}

const handleLogout = async () => {
  if (confirm(t('app.confirm_logout'))) {
    authStore.logout()
    router.push('/login')
  }
}

const navItems = computed(() => [
  { name: t('app.menu_tokens'), path: '/tokens', icon: '🎯' },
  { name: t('app.menu_settings'), path: '/settings', icon: '⚙️' },
])


</script>

<template>
  <header class="sticky top-0 z-40 w-full border-b border-gray-200 bg-white/80 backdrop-blur-md dark:border-gray-800 dark:bg-black/80">
    <div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
      <!-- Logo / Title -->
      <div class="flex items-center gap-3 cursor-pointer group" @click="router.push('/')">
        <div class="flex h-8 w-8 items-center justify-center rounded-md bg-black text-white dark:bg-white dark:text-black transition-transform group-hover:scale-105">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m12 16 4-4-4-4"/><path d="M8 12h8"/></svg>
        </div>
        <span class="text-lg font-bold tracking-tight text-black dark:text-white hidden sm:block">
          Antigravity
        </span>
      </div>

      <!-- Navigation -->
      <nav class="flex items-center gap-1">
        <router-link 
          v-for="item in navItems" 
          :key="item.path" 
          :to="item.path"
          class="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors"
          :class="[
            route.path.startsWith(item.path) || (item.path === '/tokens' && route.path === '/') 
              ? 'bg-gray-100 text-black dark:bg-gray-800 dark:text-white' 
              : 'text-gray-500 hover:text-black hover:bg-gray-50 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-900'
          ]"
        >
          <span v-if="item.path === '/tokens'">
             <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
          </span>
          <span v-else-if="item.path === '/settings'">
             <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.39a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          </span>
          <span class="hidden sm:inline">{{ item.name }}</span>
        </router-link>
      </nav>

      <!-- Actions -->
      <div class="flex items-center gap-2">
         <button 
           @click="toggleLanguage" 
           class="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black dark:border-gray-800 dark:bg-black dark:text-gray-300 dark:hover:bg-gray-900 dark:focus:ring-white transition-colors"
           v-tooltip:bottom="t('app.toggle_lang')"
        >
          <span class="text-xs font-bold">{{ locale === 'en-US' ? 'EN' : (locale === 'zh-CN' ? 'CN' : 'JP') }}</span>
        </button>
        <button 
          @click="handleLogout" 
          class="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-black dark:border-gray-800 dark:bg-black dark:text-gray-300 dark:hover:bg-gray-900 dark:hover:text-white transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
          <span class="hidden sm:inline">{{ t('app.logout') }}</span>
        </button>
      </div>
    </div>
  </header>
</template>
