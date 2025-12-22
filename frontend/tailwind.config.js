/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{vue,js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // Enforce monochrome palette
                inherit: 'inherit',
                current: 'currentColor',
                transparent: 'transparent',
                black: '#000000',
                white: '#ffffff',
                gray: {
                    50: '#f9fafb',
                    100: '#f3f4f6',
                    200: '#e5e7eb',
                    300: '#d1d5db',
                    400: '#9ca3af',
                    500: '#6b7280',
                    600: '#4b5563',
                    700: '#374151',
                    800: '#1f2937',
                    900: '#111827',
                    950: '#030712',
                },
                // Semantic mappings for monochrome
                primary: {
                    DEFAULT: '#000000', // Black for primary actions
                    foreground: '#ffffff',
                },
                background: '#ffffff',
                surface: '#f3f4f6', // gray-100
                border: '#e5e7eb', // gray-200
                text: {
                    DEFAULT: '#111827', // gray-900
                    muted: '#6b7280', // gray-500
                    light: '#9ca3af', // gray-400
                },
            },
            fontFamily: {
                sans: ['"Inter"', 'system-ui', 'sans-serif'],
                mono: ['"JetBrains Mono"', '"Ubuntu Mono"', 'monospace'],
            },
            container: {
                center: true,
                padding: '2rem',
                screens: {
                    "2xl": "1400px",
                },
            },
        },
    },
    plugins: [],
}
