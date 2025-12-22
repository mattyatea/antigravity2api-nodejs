import { ref, watch } from 'vue';
import { useCssVar } from '@vueuse/core';

const fontSize = ref(localStorage.getItem('fontSize') || '18');
const sensitiveInfoHidden = ref(localStorage.getItem('sensitiveInfoHidden') !== 'false');

// Bind CSS variable
const rootFontSize = useCssVar('--font-size-base', document.documentElement);
rootFontSize.value = fontSize.value + 'px';

watch(fontSize, (newVal) => {
    rootFontSize.value = newVal + 'px';
    localStorage.setItem('fontSize', newVal);
});

watch(sensitiveInfoHidden, (newVal) => {
    localStorage.setItem('sensitiveInfoHidden', String(newVal));
});

export function useSettings() {
    function setFontSize(size: string | number) {
        let s = Math.max(10, Math.min(24, parseInt(String(size)) || 14));
        fontSize.value = String(s);
    }

    function toggleSensitiveInfo() {
        sensitiveInfoHidden.value = !sensitiveInfoHidden.value;
    }

    return {
        fontSize,
        sensitiveInfoHidden,
        setFontSize,
        toggleSensitiveInfo
    };
}
