import tippy, { type Props } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/shift-away.css';

export default {
    mounted(el: HTMLElement, binding: any) {
        let content = binding.value;
        if (!content) return;

        // Use a custom theme matching the app's monochrome design
        tippy(el, {
            content: content,
            animation: 'shift-away',
            theme: 'antigravity', // We will define this in main.css
            arrow: true,
            placement: binding.arg || 'top',
            delay: [200, 0],
        } as Partial<Props>);
    },
    updated(el: HTMLElement, binding: any) {
        const instance = (el as any)._tippy;
        if (instance) {
            instance.setContent(binding.value);
            if (!binding.value) {
                instance.disable();
            } else {
                instance.enable();
            }
        }
    },
    unmounted(el: HTMLElement) {
        if ((el as any)._tippy) {
            (el as any)._tippy.destroy();
        }
    }
};
