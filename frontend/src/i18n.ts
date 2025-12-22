import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'
import jaJP from './locales/ja-JP.json'

// Get locale from localStorage or browser default
const savedLocale = localStorage.getItem('locale')
const browserLanguage = navigator.language
let defaultLocale = 'en-US'

if (browserLanguage === 'zh-CN' || browserLanguage === 'zh') {
    defaultLocale = 'zh-CN'
} else if (browserLanguage === 'ja-JP' || browserLanguage === 'ja') {
    defaultLocale = 'ja-JP'
}

const locale = savedLocale || defaultLocale

const i18n = createI18n({
    legacy: false, // Use Composition API
    locale: locale,
    fallbackLocale: 'en-US',
    messages: {
        'zh-CN': zhCN,
        'en-US': enUS,
        'ja-JP': jaJP
    }
})

export default i18n
