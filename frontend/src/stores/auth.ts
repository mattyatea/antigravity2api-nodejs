import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
// import { useRouter } from 'vue-router';

export const useAuthStore = defineStore('auth', () => {
    const token = ref<string | null>(localStorage.getItem('authToken'));
    const isAuthenticated = computed(() => !!token.value);

    function setToken(newToken: string) {
        token.value = newToken;
        localStorage.setItem('authToken', newToken);
    }

    function logout() {
        token.value = null;
        localStorage.removeItem('authToken');
    }

    return {
        token,
        isAuthenticated,
        setToken,
        logout
    };
});
