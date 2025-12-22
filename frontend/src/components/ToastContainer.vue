<script setup lang="ts">
import { useToast } from '../composables/useToast';

const { toasts, removeToast } = useToast();

const icons = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️'
};

const titles = {
  success: '成功',
  error: '错误',
  warning: '警告',
  info: '提示'
};
</script>

<template>
  <div class="fixed top-5 right-5 z-[9999] flex flex-col gap-2">
    <TransitionGroup 
      enter-active-class="transform transition duration-300 ease-out"
      enter-from-class="translate-x-full opacity-0"
      enter-to-class="translate-x-0 opacity-100"
      leave-active-class="transform transition duration-300 ease-in"
      leave-from-class="translate-x-0 opacity-100"
      leave-to-class="translate-x-full opacity-0"
    >
      <div 
        v-for="toast in toasts" 
        :key="toast.id" 
        class="flex min-w-[240px] max-w-[360px] cursor-pointer items-center gap-3 rounded-xl border-l-[3px] bg-white p-3 px-4 shadow-xl transition-all hover:-translate-x-1 dark:bg-slate-800"
        :class="{
          'border-l-success': toast.type === 'success',
          'border-l-danger': toast.type === 'error',
          'border-l-warning': toast.type === 'warning',
          'border-l-info': toast.type === 'info'
        }"
        @click="removeToast(toast.id)"
      >
        <div class="text-lg shrink-0">{{ icons[toast.type] }}</div>
        <div class="flex-1">
          <div class="text-sm font-bold text-text">{{ toast.title || titles[toast.type] }}</div>
          <div class="text-xs text-text-light">{{ toast.message }}</div>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/* Scoped styles removed in favor of utility classes */
</style>
