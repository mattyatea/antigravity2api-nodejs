import { useAuthStore } from '../stores/auth';
import router from '../router';

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const authStore = useAuthStore();

    // Add headers
    const headers = new Headers(options.headers || {});
    if (authStore.token) {
        headers.set('Authorization', `Bearer ${authStore.token}`);
    }

    const finalOptions = {
        ...options,
        headers
    };

    try {
        const response = await fetch(url, finalOptions);

        if (response.status === 401) {
            authStore.logout();
            router.push('/login');
            // Allow caller to handle error but already redirected
            throw new Error('Unauthorized');
        }

        return response;
    } catch (error) {
        throw error;
    }
}
