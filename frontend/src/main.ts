import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import './assets/main.css'
import tooltip from './directives/tooltip'

const app = createApp(App)

app.directive('tooltip', tooltip)

app.use(createPinia())
app.use(router)
app.use(i18n)

app.mount('#app')
