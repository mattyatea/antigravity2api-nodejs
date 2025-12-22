<script setup lang="ts">
defineProps<{
  modelValue: string | number
  label?: string
  type?: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
  id?: string
}>()

defineEmits<{
  (e: 'update:modelValue', value: string | number): void
}>()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="id" class="text-sm font-semibold text-text">{{ label }}</label>
    <input
      :id="id"
      :type="type || 'text'"
      :value="modelValue"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      :placeholder="placeholder"
      :disabled="disabled"
      :required="required"
      class="w-full min-h-[42px] px-3.5 py-2.5 bg-white border border-gray-300 rounded-md text-sm text-black transition shadow-sm
             placeholder:text-gray-400
             focus:outline-none focus:border-black focus:ring-1 focus:ring-black 
             disabled:opacity-50 disabled:cursor-not-allowed
             hover:border-gray-400 dark:bg-black dark:border-gray-700 dark:text-white dark:placeholder:text-gray-600 dark:focus:border-white dark:focus:ring-white"
    />
  </div>
</template>
