import type { RouteRecordRaw } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    layout?: 'default' | 'admin'
    noindex?: boolean
    /** Item da navegação principal que fica ativo nesta rota quando o caminho não começa por ele. */
    navSection?: string
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('../pages/HomePage.vue') },
  { path: '/sobre', name: 'sobre', component: () => import('../pages/AboutPage.vue') },
  { path: '/solucoes', name: 'solucoes', component: () => import('../pages/SolutionsPage.vue') },
  {
    path: '/consignado-privado',
    name: 'consignado',
    component: () => import('../pages/PayrollLoanPage.vue'),
    meta: { navSection: '/solucoes' },
  },
  { path: '/como-funciona', name: 'como-funciona', component: () => import('../pages/HowItWorksPage.vue') },
  { path: '/bia', name: 'bia', component: () => import('../pages/BiaPage.vue') },
  { path: '/conteudos', name: 'conteudos', component: () => import('../pages/ContentHubPage.vue') },
  { path: '/conteudos/:slug', name: 'artigo', component: () => import('../pages/ArticlePage.vue') },
  { path: '/ajuda', name: 'ajuda', component: () => import('../pages/HelpPage.vue') },
  { path: '/atendimento', name: 'atendimento', component: () => import('../pages/SupportPage.vue') },
  {
    path: '/atendimento/acompanhar',
    name: 'atendimento-acompanhar',
    component: () => import('../pages/SupportTrackPage.vue'),
    meta: { noindex: true },
  },
  { path: '/seguranca', name: 'seguranca', component: () => import('../pages/SecurityPage.vue') },
  { path: '/avise-me', name: 'avise-me', component: () => import('../pages/WaitlistLandingPage.vue') },
  { path: '/lancamento', name: 'lancamento', component: () => import('../pages/LaunchStatusPage.vue') },
  {
    path: '/cadastro-confirmado',
    name: 'cadastro-confirmado',
    component: () => import('../pages/SignupConfirmedPage.vue'),
    meta: { noindex: true },
  },
  {
    path: '/preferencias',
    name: 'preferencias',
    component: () => import('../pages/PreferencesPage.vue'),
    meta: { noindex: true },
  },
  { path: '/privacidade', name: 'privacidade', component: () => import('../pages/PrivacyPage.vue') },
  { path: '/termos', name: 'termos', component: () => import('../pages/TermsPage.vue') },
  { path: '/cookies', name: 'cookies', component: () => import('../pages/CookiesPage.vue') },
  {
    path: '/admin',
    component: () => import('../pages/admin/AdminShell.vue'),
    meta: { layout: 'admin', noindex: true },
    // Toda rota administrativa nova precisa entrar também na lista de rotas conhecidas do servidor web
    // (deploy/nginx.minhafolga.conf.example, deploy/apache.minhafolga.conf.example e scripts/static-server.mjs):
    // as demais URLs sob /admin/ respondem 404. O scripts/smoke.sh confere a lista a partir deste arquivo.
    children: [
      { path: '', name: 'admin-login', component: () => import('../pages/admin/AdminLoginPage.vue') },
      { path: 'painel', name: 'admin-painel', component: () => import('../pages/admin/AdminDashboardPage.vue') },
      { path: 'leads', name: 'admin-leads', component: () => import('../pages/admin/AdminLeadsPage.vue') },
      { path: 'leads/:id', name: 'admin-lead', component: () => import('../pages/admin/AdminLeadDetailPage.vue') },
      { path: 'atendimentos', name: 'admin-atendimentos', component: () => import('../pages/admin/AdminSupportListPage.vue') },
      { path: 'atendimentos/:id', name: 'admin-atendimento', component: () => import('../pages/admin/AdminSupportDetailPage.vue') },
      { path: 'privacidade', name: 'admin-privacidade', component: () => import('../pages/admin/AdminPrivacyPage.vue') },
      { path: 'auditoria', name: 'admin-auditoria', component: () => import('../pages/admin/AdminAuditPage.vue') },
      { path: 'notificacoes', name: 'admin-notificacoes', component: () => import('../pages/admin/AdminNotificationsPage.vue') },
      { path: 'usuarios', name: 'admin-usuarios', component: () => import('../pages/admin/AdminUsersPage.vue') },
      { path: 'conta', name: 'admin-conta', component: () => import('../pages/admin/AdminAccountPage.vue') },
    ],
  },
  { path: '/404', name: 'nao-encontrada', component: () => import('../pages/NotFoundPage.vue'), meta: { noindex: true } },
  { path: '/:pathMatch(.*)*', name: 'nao-encontrada-cliente', component: () => import('../pages/NotFoundPage.vue'), meta: { noindex: true } },
]
