<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppHeader from '../components/layout/AppHeader.vue'
</script>

<template>
  <div class="min-h-screen bg-background text-text font-sans antialiased selection:bg-black selection:text-white">
    <AppHeader />
    <main class="mx-auto max-w-7xl p-4 sm:px-6 lg:px-8">
       <router-view v-slot="{ Component }">
          <transition 
            enter-active-class="transition duration-200 ease-out" 
            enter-from-class="opacity-0 translate-y-2" 
            enter-to-class="opacity-100 translate-y-0"
            leave-active-class="transition duration-150 ease-in absolute w-full"
            leave-from-class="opacity-100 translate-y-0" 
            leave-to-class="opacity-0 -translate-y-2"
          >
            <component :is="Component" />
          </transition>
       </router-view>
    </main>
  </div>
</template>
