import { ViteSSG } from 'vite-ssg'
import App from './App.vue'
import { routes } from './router/routes'
import './styles/main.css'

/**
 * Páginas públicas são pré-renderizadas no build (vite-ssg) e hidratadas no navegador.
 * Área administrativa e jornadas de sessão rodam no cliente, com autorização no backend.
 */
export const createApp = ViteSSG(
  App,
  {
    routes,
    scrollBehavior(to, from, saved) {
      if (saved) return saved
      if (to.hash) return { el: to.hash, top: 96 }
      if (to.path !== from.path) return { top: 0 }
      return undefined
    },
  },
  undefined,
  { hydration: true },
)
