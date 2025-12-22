import { ref } from 'vue';

export interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
    title?: string;
}

const toasts = ref<Toast[]>([]);
let nextId = 0;

export function useToast() {
    function showToast(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', title?: string) {
        const id = nextId++;
        toasts.value.push({ id, message, type, title });
        setTimeout(() => {
            removeToast(id);
        }, 3000);
    }

    function removeToast(id: number) {
        const index = toasts.value.findIndex(t => t.id === id);
        if (index !== -1) {
            toasts.value.splice(index, 1);
        }
    }

    return {
        toasts,
        showToast,
        removeToast
    };
}
