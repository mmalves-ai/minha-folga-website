import { computed, readonly, ref } from 'vue'
import { api } from '@/services/api'
import contract from '@contracts/notifications.json'

type PushConfig = { enabled: boolean; publicKey: string | null; consentVersion: string }
type SubscriptionReceipt = { status: 'subscribed'; subscriptionId: string; unsubscribeToken: string }
type SavedSubscription = Pick<SubscriptionReceipt, 'subscriptionId' | 'unsubscribeToken'>
export const PUSH_STORAGE_KEY = 'mf_browser_notifications'
const config = ref<PushConfig | null>(null)
const loaded = ref(false)
const supported = ref(false)
const needsHomeScreen = ref(false)
const subscribed = ref(false)
const hasBrowserSubscription = ref(false)
const pendingCleanup = ref(false)
const saved = ref<SavedSubscription | null>(null)
const busy = ref(false)
const message = ref('')
const failed = ref(false)
const permission = ref<NotificationPermission>('default')
const interrupted = computed(() => Boolean(saved.value) && !hasBrowserSubscription.value)
const needsRecovery = computed(() => !subscribed.value && Boolean(saved.value || hasBrowserSubscription.value))
let loading: Promise<void> | null = null

function readSaved(): SavedSubscription | null {
  try {
    const value = window.localStorage.getItem(PUSH_STORAGE_KEY)
    if (!value || value.length > 500) return null
    const data = JSON.parse(value)
    return typeof data.subscriptionId === 'string' && data.subscriptionId.length <= 100 && /^[a-f0-9]{64}$/.test(data.unsubscribeToken)
      ? { subscriptionId: data.subscriptionId, unsubscribeToken: data.unsubscribeToken } : null
  } catch { return null }
}
function saveReceipt(receipt: SavedSubscription) {
  // Conserva a autorização de cancelamento em memória mesmo se o armazenamento falhar.
  saved.value = receipt
  window.localStorage.setItem(PUSH_STORAGE_KEY, JSON.stringify(receipt))
  const stored = readSaved()
  if (stored?.subscriptionId !== receipt.subscriptionId || stored.unsubscribeToken !== receipt.unsubscribeToken) throw new Error('storage_unavailable')
}
function clearReceipt() {
  saved.value = null
  pendingCleanup.value = false
  try { window.localStorage.removeItem(PUSH_STORAGE_KEY) } catch { /* A revogação já foi confirmada. */ }
}
async function existingRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined
  const registration = await navigator.serviceWorker.getRegistration('/')
  const script = registration?.active?.scriptURL ?? registration?.installing?.scriptURL ?? registration?.waiting?.scriptURL
  return script && new URL(script).pathname === '/notifications-sw.js' ? registration : undefined
}
function publicKeyBytes(key: string): ArrayBuffer {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes.buffer
}
async function activated(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active?.state === 'activated') return
  const worker = registration.installing ?? registration.waiting ?? registration.active
  if (!worker) throw new Error('worker_unavailable')
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('worker_timeout')) }, 12000)
    const cleanup = () => { clearTimeout(timer); worker.removeEventListener('statechange', check) }
    const check = () => {
      if (worker.state === 'activated') { cleanup(); resolve() }
      else if (worker.state === 'redundant') { cleanup(); reject(new Error('worker_redundant')) }
    }
    worker.addEventListener('statechange', check)
    check()
  })
}

async function load(force = false): Promise<void> {
  if (typeof window === 'undefined') return
  if (loading && !force) return loading
  if (loaded.value && !force) return
  loading = (async () => {
    needsHomeScreen.value = (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && !window.matchMedia('(display-mode: standalone)').matches
    supported.value = window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
    saved.value = pendingCleanup.value ? saved.value : readSaved()
    permission.value = 'Notification' in window ? Notification.permission : 'default'
    try {
      const result = await api<PushConfig>('/notifications/config', { timeoutMs: 8000 })
      config.value = result && typeof result.enabled === 'boolean' && result.consentVersion === contract.consent.version ? result : null
    } catch { config.value = null }
    // Consulta local independente da API: perder o recibo não deve esconder a ação de desativar.
    try {
      const registration = supported.value ? await existingRegistration() : undefined
      hasBrowserSubscription.value = Boolean(await registration?.pushManager.getSubscription())
      subscribed.value = permission.value === 'granted' && Boolean(saved.value) && hasBrowserSubscription.value && !pendingCleanup.value
    } catch { subscribed.value = false }
    finally { loaded.value = true }
  })()
  try { await loading } finally { loading = null }
}

async function enable(): Promise<void> {
  if (busy.value || subscribed.value || !supported.value || !config.value?.enabled || !config.value.publicKey) return
  busy.value = true
  message.value = ''
  failed.value = false
  let subscription: PushSubscription | null = null
  let createdHere = false
  let receipt: SubscriptionReceipt | null = null
  try {
    // Primeiro await é a permissão nativa: sempre uma ação explícita do visitante.
    permission.value = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (permission.value !== 'granted') {
      message.value = permission.value === 'denied'
        ? 'Os avisos estão bloqueados neste navegador. Você pode mudar isso nas permissões do site.'
        : 'Tudo bem. Você pode ativar os avisos quando quiser.'
      return
    }
    const registration = await navigator.serviceWorker.register('/notifications-sw.js', { scope: '/', updateViaCache: 'none' })
    await activated(registration)
    subscription = await registration.pushManager.getSubscription()
    hasBrowserSubscription.value = Boolean(subscription)
    if (!subscription && saved.value) {
      // Reativação solicitada pelo visitante: encerra o registro interrompido antes de criar outro.
      await api('/notifications/subscriptions', { method: 'DELETE', body: saved.value })
      clearReceipt()
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(config.value.publicKey) })
      createdHere = true
      hasBrowserSubscription.value = true
    }
    receipt = await api<SubscriptionReceipt>('/notifications/subscriptions', {
      method: 'POST', body: { subscription: subscription.toJSON(), consentVersion: config.value.consentVersion },
    })
    if (receipt?.status !== 'subscribed' || typeof receipt.subscriptionId !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.unsubscribeToken)) throw new Error('invalid_receipt')
    saveReceipt({ subscriptionId: receipt.subscriptionId, unsubscribeToken: receipt.unsubscribeToken })
    pendingCleanup.value = false
    subscribed.value = true
    message.value = 'Pronto! Você poderá receber os avisos da Minha Folga neste aparelho.'
  } catch {
    // Rollback é confirmado em cada lado. Se falhar, mantém a credencial e oferece nova tentativa.
    subscribed.value = false
    if (receipt?.status === 'subscribed' && typeof receipt.subscriptionId === 'string' && /^[a-f0-9]{64}$/.test(receipt.unsubscribeToken)) {
      saved.value = { subscriptionId: receipt.subscriptionId, unsubscribeToken: receipt.unsubscribeToken }
      pendingCleanup.value = true
      try {
        await api('/notifications/subscriptions', { method: 'DELETE', body: saved.value })
        clearReceipt()
      } catch { /* A credencial fica disponível em memória para concluir a revogação. */ }
    }
    if (createdHere || receipt) {
      try { await subscription?.unsubscribe(); hasBrowserSubscription.value = false }
      catch { /* O botão de desativar permanece disponível para a assinatura local. */ }
    }
    failed.value = true
    message.value = needsRecovery.value
      ? 'A ativação não foi concluída. Você pode tentar reativar ou desativar os avisos neste aparelho.'
      : 'Não conseguimos ativar os avisos. Tente novamente. Você também pode receber a abertura pelo WhatsApp ao se cadastrar.'
  } finally { busy.value = false }
}

async function disable(): Promise<void> {
  if (busy.value) return
  busy.value = true
  message.value = ''
  failed.value = false
  let serverRevoked = !saved.value
  try {
    if (saved.value) {
      await api('/notifications/subscriptions', { method: 'DELETE', body: saved.value })
      serverRevoked = true
    }
  } catch { failed.value = true }
  try {
    const registration = await existingRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription) await subscription.unsubscribe()
    hasBrowserSubscription.value = false
    subscribed.value = false
    if (serverRevoked) {
      clearReceipt()
      message.value = 'Avisos desativados neste aparelho.'
    } else {
      message.value = 'Avisos pausados neste aparelho. Toque novamente em desativar para concluir.'
    }
  } catch {
    failed.value = true
    message.value = serverRevoked
      ? 'Não conseguimos confirmar a desativação no navegador. Tente novamente ou bloqueie os avisos nas permissões do site.'
      : 'Não conseguimos concluir. Tente novamente ou bloqueie os avisos nas permissões do navegador.'
    if (serverRevoked) {
      subscribed.value = false
      clearReceipt()
    }
  } finally { busy.value = false }
}

export function useBrowserNotifications() {
  return {
    config: readonly(config), loaded: readonly(loaded), supported: readonly(supported), needsHomeScreen: readonly(needsHomeScreen),
    subscribed: readonly(subscribed), saved: readonly(saved), hasBrowserSubscription: readonly(hasBrowserSubscription), interrupted, needsRecovery, busy: readonly(busy),
    message: readonly(message), failed: readonly(failed), permission: readonly(permission),
    load, enable, disable,
  }
}
