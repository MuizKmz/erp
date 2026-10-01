import './assets/main.css'

import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import ToastService from 'primevue/toastservice'
import Tooltip from 'primevue/tooltip'
import { definePreset } from '@primeuix/themes'
import Aura from '@primeuix/themes/aura'

import App from './App.vue'
import router from './router'

/**
 * PrimeVue for the heavy widgets (DataTable, Select, DatePicker, Dialog, Toast). Its primary colour points at
 * the module variables, so dialogs and focus rings follow green Purchase / purple Sales.
 */
const ErpPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: 'var(--mod-light)',
      100: 'var(--mod-light-border)',
      200: 'var(--mod-light-border)',
      300: 'var(--mod-line)',
      400: 'var(--mod-line)',
      500: 'var(--mod-primary)',
      600: 'var(--mod-accent)',
      700: 'var(--mod-active)',
      800: 'var(--mod-active)',
      900: 'var(--mod-active)',
      950: 'var(--mod-active)',
    },
  },
})

createApp(App)
  .use(router)
  .use(PrimeVue, {
    theme: {
      preset: ErpPreset,
      options: {
        darkModeSelector: false,
        cssLayer: { name: 'primevue', order: 'theme, base, primevue, components, utilities' },
      },
    },
  })
  .use(ToastService)
  .use(ConfirmationService)
  .directive('tooltip', Tooltip)
  .mount('#app')
