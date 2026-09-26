<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import BrandLogo from '@/components/site/BrandLogo.vue'
import { track } from '@/services/analytics'
import validation from '@contracts/validation.json'
import { publicConfig, site } from '@/services/site'
import type { LinkItem } from '@/types/content'

const nav = site.nav.primary as LinkItem[]
const collecting = publicConfig.collection.waitlistEnabled
const cta = (collecting ? site.nav.cta : site.nav.closedCta) as LinkItem
const route = useRoute()
function trackSignupCta() {
  if (!collecting) return
  const source = route.path === '/' ? 'home' : route.path.split('/')[1]
  if (source && (validation.waitlist.sources as string[]).includes(source)) track('waitlist_cta_click', source)
}

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const toggle = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)

/**
 * Link ativo: a própria rota, uma subrota (ex.: artigos dentro de Conteúdos) ou a seção declarada
 * no meta da rota (ex.: /consignado-privado pertence a Soluções).
 */
function isActive(to: string): boolean {
  const section = route.meta.navSection
  if (section) return section === to
  return route.path === to || route.path.startsWith(`${to}/`)
}

/** "page" para a página atual; "true" para a seção ativa (o destaque visual também chega à tecnologia assistiva). */
function currentAttr(to: string): 'page' | 'true' | undefined {
  if (route.path === to) return 'page'
  return isActive(to) ? 'true' : undefined
}

// Com o painel aberto, o restante da página (link de pular, conteúdo, rodapé, avisos) fica inerte:
// fora do alcance do Tab, do leitor de tela e do ponteiro. Mesma técnica do painel de cookies.
let inertMarked: Element[] = []

function setBackgroundInert(on: boolean) {
  if (!on) {
    for (const el of inertMarked) el.removeAttribute('inert')
    inertMarked = []
    return
  }
  const header = root.value
  const parent = header?.parentElement
  if (!header || !parent) return
  inertMarked = [...parent.children].filter((el) => el !== header && !el.hasAttribute('inert'))
  for (const el of inertMarked) el.setAttribute('inert', '')
}

/**
 * O painel começa na base real do cabeçalho (o token de altura é só o mínimo; zoom de texto pode
 * aumentá-lo). A variável é aplicada pelo CSSOM, não por atributo style: a CSP do site
 * (style-src 'self') bloqueia estilo inline no HTML.
 */
function measurePanelTop() {
  const bottom = root.value?.getBoundingClientRect().bottom
  if (!panel.value) return
  if (bottom && bottom > 0) panel.value.style.setProperty('--mf-menu-top', `${Math.round(bottom)}px`)
  else panel.value.style.removeProperty('--mf-menu-top')
}

function close(returnFocus = true) {
  if (!open.value) return
  open.value = false
  document.body.classList.remove('menu-open')
  setBackgroundInert(false)
  if (returnFocus) nextTick(() => toggle.value?.focus())
}

async function openMenu() {
  measurePanelTop()
  open.value = true
  document.body.classList.add('menu-open')
  setBackgroundInert(true)
  await nextTick()
  panel.value?.querySelector<HTMLElement>('a, button')?.focus()
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab' || !panel.value) return
  // Mantém o foco dentro do menu aberto (botão de fechar + links).
  const focusables = [toggle.value, ...panel.value.querySelectorAll<HTMLElement>('a, button')].filter(Boolean) as HTMLElement[]
  const first = focusables[0]!
  const last = focusables[focusables.length - 1]!
  const current = document.activeElement as HTMLElement | null
  const inside = current ? focusables.includes(current) : false
  if (event.shiftKey && (current === first || !inside)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (current === last || !inside)) {
    event.preventDefault()
    first.focus()
  }
}

const onResize = () => {
  if (window.innerWidth >= 1100) close(false)
  else if (open.value) measurePanelTop()
}

watch(
  () => route.fullPath,
  () => close(false),
)

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  document.body.classList.remove('menu-open')
  setBackgroundInert(false)
})
</script>

<template>
  <header ref="root" class="site-header" :class="{ 'site-header--open': open }">
    <div class="container site-header__bar">
      <RouterLink to="/" class="site-header__brand" aria-label="Minha Folga — página inicial">
        <BrandLogo :width="150" />
      </RouterLink>

      <nav class="site-header__nav" aria-label="Principal">
        <ul>
          <li v-for="item in nav" :key="item.to">
            <RouterLink :to="item.to" class="site-header__link" :class="{ 'is-active': isActive(item.to) }" :aria-current="currentAttr(item.to)">
              {{ item.label }}
            </RouterLink>
          </li>
        </ul>
      </nav>

      <div class="site-header__actions">
        <RouterLink :to="cta.to" :aria-label="cta.label" @click="trackSignupCta" class="btn btn--primary btn--sm site-header__cta"><span class="site-header__cta-full">{{ cta.label }}</span><span class="site-header__cta-short" aria-hidden="true">{{ collecting ? site.nav.ctaMobileLabel : site.nav.closedCtaMobileLabel }}</span></RouterLink>
        <button
          ref="toggle"
          type="button"
          class="site-header__toggle"
          :aria-expanded="open ? 'true' : 'false'"
          aria-controls="menu-principal-movel"
          @click="open ? close() : openMenu()"
        >
          <AppIcon :name="open ? 'close' : 'menu'" />
          <span class="site-header__toggle-text">{{ open ? 'Fechar' : 'Menu' }}</span>
        </button>
      </div>
    </div>

    <div id="menu-principal-movel" ref="panel" :hidden="!open" class="site-header__panel">
      <nav aria-label="Principal (menu)">
        <ul class="container">
          <li>
            <RouterLink to="/" class="site-header__panel-link" :aria-current="route.path === '/' ? 'page' : undefined">Início</RouterLink>
          </li>
          <li v-for="item in nav" :key="item.to">
            <RouterLink :to="item.to" class="site-header__panel-link" :class="{ 'is-active': isActive(item.to) }" :aria-current="currentAttr(item.to)">
              {{ item.label }}
              <AppIcon name="arrow-right" />
            </RouterLink>
          </li>
          <li class="site-header__panel-cta">
            <RouterLink :to="cta.to" @click="trackSignupCta" class="btn btn--primary btn--block">{{ cta.label }}</RouterLink>
          </li>
        </ul>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.site-header {
  position: sticky;
  top: 0;
  z-index: 50;
  border-bottom: 1px solid rgb(199 210 204 / 70%);
}

/*
 * Fundo translúcido com desfoque num pseudo-elemento. `backdrop-filter` (assim como filter e
 * transform) no próprio cabeçalho o tornaria o bloco de contenção do painel `position: fixed`,
 * que passaria a medir a altura do cabeçalho (uma faixa de ~45 px) em vez da janela.
 */
.site-header::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: rgb(248 246 240 / 94%);
  backdrop-filter: saturate(1.2) blur(10px);
  pointer-events: none;
}

/* Menu aberto: acima do aviso de cookies (z-index 60) e abaixo do diálogo de cookies (80). */
.site-header--open {
  z-index: 70;
}

.site-header__bar {
  display: flex;
  align-items: center;
  gap: 24px;
  min-height: var(--mf-header-height);
}

.site-header__brand {
  display: inline-flex;
  align-items: center;
  flex: none;
  min-height: 44px;
  padding: 6px 0;
  border-radius: 8px;
}

.site-header__nav {
  flex: 1;
}

.site-header__nav ul {
  display: flex;
  justify-content: center;
  gap: 4px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.site-header__nav li {
  margin: 0;
}

.site-header__link {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 12px;
  border-radius: 10px;
  color: var(--mf-ink);
  font-weight: 500;
  font-size: 0.975rem;
  text-decoration: none;
  white-space: nowrap;
}

.site-header__link:hover {
  color: var(--mf-forest);
  background: rgb(221 236 226 / 60%);
}

.site-header__link.is-active {
  color: var(--mf-forest);
  font-weight: 600;
}

.site-header__link.is-active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 4px;
  height: 2px;
  border-radius: 2px;
  background: var(--mf-coral);
}

.site-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.site-header__cta-short { display: none; }

.site-header__toggle {
  display: none;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 8px 12px;
  border: 1.5px solid var(--mf-control-border);
  border-radius: var(--mf-radius-control);
  background: var(--mf-paper);
  color: var(--mf-forest);
  font-weight: 600;
  font-size: 0.9375rem;
}

.site-header__toggle .icon {
  width: 20px;
  height: 20px;
}

/* Painel do menu: da base do cabeçalho até o fim da janela; rola por dentro se não couber (zoom, tela baixa). */
.site-header__panel {
  position: fixed;
  inset: var(--mf-menu-top, var(--mf-header-height)) 0 0 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--mf-cream);
  border-top: 1px solid var(--mf-border);
  padding-block: 12px 32px;
}

.site-header__panel ul {
  list-style: none;
  margin: 0;
}

.site-header__panel li {
  margin: 0;
  border-bottom: 1px solid var(--mf-border);
}

.site-header__panel-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  font-family: var(--mf-font-heading);
  font-size: 1.25rem;
  font-weight: 500;
  color: var(--mf-ink);
  text-decoration: none;
}

.site-header__panel-link .icon {
  width: 20px;
  height: 20px;
  color: var(--mf-forest);
}

.site-header__panel-link.is-active,
.site-header__panel-link[aria-current='page'] {
  color: var(--mf-forest);
  font-weight: 600;
}

.site-header__panel-cta {
  padding-top: 24px;
  border-bottom: 0 !important;
}

@media (max-width: 1099px) {
  .site-header__nav {
    display: none;
  }
  .site-header__toggle {
    display: inline-flex;
  }
}

@media (max-width: 479px) {
  /* No celular, o rótulo curto mantém o CTA em uma linha; seu nome acessível continua completo. */
  .site-header__cta-full { display: none; }
  .site-header__cta-short { display: inline; }
  .site-header__bar {
    gap: 8px;
  }
  .site-header__brand :deep(img) {
    width: 140px;
  }
  .site-header__cta {
    max-width: 108px;
    min-height: 44px;
    padding: 5px 10px;
    font-size: 0.8125rem;
    line-height: 1.15;
    white-space: nowrap;
  }
  .site-header__toggle {
    width: 44px;
    padding: 0;
    justify-content: center;
  }
  .site-header__toggle-text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
}
</style>

<style>
body.menu-open {
  overflow: hidden;
}
</style>
