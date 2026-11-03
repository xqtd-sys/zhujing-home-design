import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import VueKonva from 'vue-konva'
import 'element-plus/dist/index.css'
import './styles.css'
import App from './App.vue'
import router from './router'

createApp(App).use(createPinia()).use(router).use(ElementPlus).use(VueKonva).mount('#app')
