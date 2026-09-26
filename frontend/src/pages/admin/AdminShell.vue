<script setup lang="ts">
/**
 * Casca do painel interno. No SSR/pré-render (e no primeiro render do cliente) mostra só um
 * estado neutro de carregamento: nenhuma chamada de API no servidor, nenhum dado no HTML.
 * No cliente consulta a sessão e decide: entrada (senha/MFA), troca obrigatória de senha ou painel.
 * Esconder itens aqui é conveniência; a autorização de verdade é do backend.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrandLogo from '@/components/site/BrandLogo.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { ROLES } from '@/components/admin/labels'
import { ADMIN_NAV, ROUTE_PERMISSIONS, defaultAdminRoute } from '@/components/admin/nav'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useSeo } from '@/composables/useSeo'
import { useAdminSession, type AdminSessionStatus } from '@/composables/useAdminSession'
import AdminLoginPage from './AdminLoginPage.vue'
import '@/components/admin/admin.css'

useSeo({
  title: 'Painel interno | Minha Folga',
  description: 'Área interna e restrita da equipe da Minha Folga para operar cadastros, atendimentos e pedidos de privacidade.',
  noindex: true,
})

const route = useRoute()
const router = useRouter()
const session = useAdminSession()
// Região viva persistente das confirmações do painel, criada antes de qualquer ação (useAnnouncer).
useAnnouncer()
const status = computed(() => session.state.status)

const LOGIN_STEPS: AdminSessionStatus[] = ['anonymous', 'mfa_required', 'mfa_setup_required']
const needsLogin = computed(() => LOGIN_STEPS.includes(status.value))
const routeName = computed(() => String(route.name ?? ''))
const routePermission = computed(() => ROUTE_PERMISSIONS[routeName.value] ?? null)
const routeAllowed = computed(() => !routePermission.value || session.can(routePermission.value))
const homeRoute = computed(() => (session.mustChangePassword.value ? 'admin-conta' : defaultAdminRoute(session.can)))
const redirecting = computed(
  () =>
    status.value === 'authenticated' &&
    (routeName.value === 'admin-login' || (session.mustChangePassword.value && routeName.value !== 'admin-conta')),
)

const navItems = computed(() =>
  session.mustChangePassword.value
    ? ADMIN_NAV.filter((item) => item.name === 'admin-conta')
    : ADMIN_NAV.filter((item) => !item.permission || session.can(item.permission)),
)
const isActive = (item: (typeof ADMIN_NAV)[number]) =>
  item.name === routeName.value || Boolean(item.children?.includes(routeName.value))

const roleLabel = computed(() => (session.state.user ? ROLES[session.state.user.role] ?? session.state.user.role : ''))

// Encaminhamentos: depois de entrar, na troca obrigatória de senha e em rota sem permissão logo após o login.
let lastStatus: AdminSessionStatus = status.value
watch(
  [status, routeName, session.mustChangePassword],
  () => {
    const justSignedIn = status.value === 'authenticated' && lastStatus !== 'authenticated'
    lastStatus = status.value
    if (status.value !== 'authenticated') return
    if (session.mustChangePassword.value) {
      if (routeName.value !== 'admin-conta') void router.replace({ name: 'admin-conta' })
      return
    }
    if (routeName.value === 'admin-login' || (justSignedIn && !routeAllowed.value)) {
      void router.replace({ name: defaultAdminRoute(session.can) })
    }
  },
  { flush: 'post' },
)

// Menu lateral em telas menores (disclosure).
const navOpen = ref(false)
const navToggle = ref<HTMLButtonElement | null>(null)
const sidebar = ref<HTMLElement | null>(null)

async function toggleNav() {
  navOpen.value = !navOpen.value
  if (navOpen.value) {
    await nextTick()
    sidebar.value?.querySelector<HTMLElement>('a')?.focus()
  }
}

function closeNav(returnFocus = false) {
  if (!navOpen.value) return
  navOpen.value = false
  if (returnFocus) navToggle.value?.focus()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && navOpen.value) closeNav(true)
}

// Navegação no cliente: leva o foco ao conteúdo e anuncia a nova tela.
const main = ref<HTMLElement | null>(null)
const announcement = ref('')
watch(
  () => route.path,
  async (to, from) => {
    closeNav()
    if (!from || to === from) return
    await nextTick()
    // Só move o foco se ninguém interagiu com a nova tela nesse intervalo (foco ainda no link de navegação ou no body).
    const origin = document.activeElement
    setTimeout(() => {
      const current = document.activeElement
      if (current === origin || current === document.body || !main.value?.contains(current)) {
        main.value?.focus({ preventScroll: true })
      }
      announcement.value = document.title.replace(/ \| Minha Folga$/, '')
    }, 80)
  },
)

async function signOut() {
  await session.logout()
  await router.replace({ name: 'admin-login' })
}

function retry() {
  session.refresh().catch(() => undefined)
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  session.refresh().catch(() => undefined)
})

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="admin-app">
    <!-- Estado neutro: é também o HTML pré-renderizado. -->
    <main v-if="status === 'loading'" id="conteudo-admin" class="admin-boot" tabindex="-1">
      <div class="admin-boot__card" role="status">
        <BrandLogo :width="156" />
        <p class="admin-boot__text"><span class="spinner" aria-hidden="true" /> Carregando o painel interno…</p>
      </div>
    </main>

    <main v-else-if="status === 'unavailable'" id="conteudo-admin" class="admin-boot" tabindex="-1">
      <div class="admin-boot__card">
        <BrandLogo :width="156" />
        <h1 class="admin-boot__title">Não foi possível abrir o painel</h1>
        <div class="notice notice--error" role="alert">
          <AppIcon name="alert" />
          <p>{{ session.state.error }}</p>
        </div>
        <div class="cluster">
          <button type="button" class="btn btn--primary" @click="retry">Tentar novamente</button>
          <a class="btn btn--ghost" href="/">Ir para o site</a>
        </div>
      </div>
    </main>

    <main v-else-if="needsLogin" id="conteudo-admin" class="admin-boot admin-boot--login" tabindex="-1">
      <AdminLoginPage />
    </main>

    <template v-else>
      <header class="admin-topbar">
        <button
          ref="navToggle"
          type="button"
          class="btn btn--outline-light btn--sm admin-topbar__menu"
          :aria-expanded="navOpen ? 'true' : 'false'"
          aria-controls="admin-sidebar"
          @click="toggleNav"
        >
          <AppIcon :name="navOpen ? 'close' : 'menu'" />
          <span>Menu</span>
        </button>
        <RouterLink :to="{ name: homeRoute }" class="admin-topbar__brand">
          <BrandLogo variant="reverse" :width="140" />
          <span class="admin-topbar__area">Painel interno</span>
        </RouterLink>
        <span class="admin-topbar__spacer" />
        <p v-if="session.state.user" class="admin-topbar__user">
          <strong>{{ session.state.user.displayName }}</strong>
          <span>{{ roleLabel }}</span>
        </p>
        <button type="button" class="btn btn--outline-light btn--sm" @click="signOut">
          <AppIcon name="logout" />
          <span class="admin-topbar__logout-text">Sair</span>
        </button>
      </header>

      <div class="admin-body">
        <button v-if="navOpen" type="button" class="admin-scrim" tabindex="-1" aria-hidden="true" @click="closeNav()" />
        <aside id="admin-sidebar" ref="sidebar" class="admin-sidebar" :class="{ 'admin-sidebar--open': navOpen }">
          <p v-if="session.state.user" class="admin-sidebar__who">
            <strong>{{ session.state.user.displayName }}</strong>
            <span>{{ roleLabel }}</span>
          </p>
          <nav class="admin-nav" aria-label="Painel interno">
            <ul>
              <template v-for="item in navItems" :key="item.name">
                <li v-if="item.name === 'admin-conta' && navItems.length > 1" class="admin-nav__sep" aria-hidden="true" />
                <li>
                  <RouterLink
                    :to="{ name: item.name }"
                    class="admin-nav__link"
                    :aria-current="isActive(item) ? 'page' : undefined"
                  >
                    <AppIcon :name="item.icon" />
                    {{ item.label }}
                  </RouterLink>
                </li>
              </template>
            </ul>
          </nav>
          <p class="admin-sidebar__foot">
            Acesso individual e auditado. Dados pessoais só quando o trabalho exigir.
          </p>
        </aside>

        <main id="conteudo-admin" ref="main" class="admin-main" tabindex="-1">
          <div class="admin-main__inner">
            <div v-if="redirecting" class="admin-state admin-state--loading" role="status">
              <span class="spinner" aria-hidden="true" />
              <span>Abrindo…</span>
            </div>
            <section v-else-if="!routeAllowed" class="admin-state admin-forbidden" aria-labelledby="sem-permissao">
              <h1 id="sem-permissao">Sem acesso a esta área</h1>
              <p>Seu perfil não tem a permissão necessária. Se o seu trabalho exigir esse acesso, fale com a administração do painel.</p>
              <RouterLink :to="{ name: homeRoute }" class="btn btn--secondary btn--sm">Ir para a minha tela inicial</RouterLink>
            </section>
            <RouterView v-else />
          </div>
        </main>
      </div>
    </template>

    <p class="visually-hidden" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.admin-boot {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: var(--mf-space-5) 16px;
}

.admin-boot:focus {
  outline: none;
}

.admin-boot__card {
  display: grid;
  justify-items: start;
  gap: var(--mf-space-3);
  width: min(440px, 100%);
  padding: var(--mf-space-5);
  background: var(--mf-paper);
  border: 1px solid var(--mf-border);
  border-radius: 24px;
}

.admin-boot__text {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--mf-muted);
}

.admin-boot__title {
  font-size: 1.5rem;
  margin: 0;
}

.admin-boot--login {
  align-items: start;
  padding-top: clamp(24px, 8vh, 96px);
}

.admin-forbidden h1 {
  font-size: 1.375rem;
  margin: 0;
}
</style>
