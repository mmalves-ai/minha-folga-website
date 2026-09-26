<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import contract from '@contracts/notifications.json'
import AdminDialog from '@/components/admin/AdminDialog.vue'
import AdminState from '@/components/admin/AdminState.vue'
import AdminStatus from '@/components/admin/AdminStatus.vue'
import ReasonDialog from '@/components/admin/ReasonDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { ROLES } from '@/components/admin/labels'
import type { AdminNotifications, NotificationCampaign, NotificationGrant, NotificationQueued } from '@/components/admin/notifications'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useAdminLoader, useAdminTitle } from '@/composables/useAdminLoader'
import { adminApi, errorMessage, useAdminSession } from '@/composables/useAdminSession'
import { formatDateTime } from '@/lib/format'

useAdminTitle('Notificações')
const session = useAdminSession()
const { announce } = useAnnouncer()
const canSend = computed(() => session.can('notifications:send'))
const canManage = computed(() => session.can('notifications:manage'))
const allowed = computed(() => canSend.value || canManage.value)
const loader = useAdminLoader(() => adminApi<AdminNotifications>('/admin/notifications'))
const grantsLoader = useAdminLoader(() => adminApi<{ users: NotificationGrant[] }>('/admin/notifications/grants'))
const data = computed(() => loader.data.value)
const destinations = computed(() => (data.value?.destinations ?? []).filter(path => contract.destinations.includes(path)))
const names: Record<string, string> = { '/': 'Início', '/avise-me': 'Cadastro', '/lancamento': 'Abertura', '/consignado-privado': 'Consignado privado', '/bia': 'Bia', '/conteudos': 'Conteúdos', '/ajuda': 'Ajuda' }
const limits = contract.limits
const draft = reactive({ title: '', body: '', url: '/lancamento' })
const fieldErrors = ref<Record<string, string>>({})
const formError = ref<string | null>(null)
const feedback = ref('')
const reviewing = ref(false)
const preparing = ref(false)
const sending = ref(false)
const confirmed = ref(false)
const sendError = ref<string | null>(null)
const historyHeading = ref<HTMLElement | null>(null)
const grantsHeading = ref<HTMLElement | null>(null)
const prepared = ref<{ title: string; body: string; url: string; requestKey: string; subscribers: number } | null>(null)
// Mantido em memória, inclusive após falha de rede ou fechar/reabrir a mesma prévia. Nunca vai para URL/storage.
let lastSignature = ''
let lastRequestKey = ''

const mayPrepare = computed(() => canSend.value && Boolean(data.value?.enabled) && (data.value?.subscribers ?? 0) > 0 && !loader.error.value)
const grants = computed(() => [...(grantsLoader.data.value?.users ?? [])].sort((a,b) => a.displayName.localeCompare(b.displayName, 'pt-BR')))
function say(message: string) { feedback.value = message; announce(message) }
function mayCancel(campaign: NotificationCampaign) {
  return canSend.value && (session.state.user?.role === 'admin' || campaign.createdBy === session.state.user?.id)
}
function creator(campaign: NotificationCampaign) {
  if (campaign.createdBy === session.state.user?.id) return 'Você'
  return grants.value.find(person => person.id === campaign.createdBy)?.displayName ?? 'Outro usuário autorizado'
}
async function reload() {
  const loads: Promise<void>[] = []
  if (allowed.value) loads.push(loader.load())
  if (canManage.value) loads.push(grantsLoader.load())
  await Promise.all(loads)
}

async function review() {
  if (preparing.value || sending.value || !mayPrepare.value) return
  const title = draft.title.trim(); const body = draft.body.trim(); const url = draft.url
  const errors: Record<string, string> = {}
  if (!title || title.length > limits.titleMax) errors.title = `Escreva um título de até ${limits.titleMax} caracteres.`
  if (!body || body.length > limits.bodyMax) errors.body = `Escreva uma mensagem de até ${limits.bodyMax} caracteres.`
  if (!destinations.value.includes(url)) errors.url = 'Escolha uma das páginas permitidas.'
  fieldErrors.value = errors; formError.value = null
  if (Object.keys(errors).length) {
    await nextTick(); document.getElementById(`notification-${Object.keys(errors)[0]}`)?.focus(); return
  }
  preparing.value = true
  // Reconsulta o público e a disponibilidade antes da confirmação concreta.
  await loader.load()
  preparing.value = false
  if (loader.error.value) { formError.value = loader.error.value; return }
  if (!mayPrepare.value || !destinations.value.includes(url)) { formError.value = 'O envio não está disponível. Confira a situação e o público antes de tentar novamente.'; return }
  const signature = JSON.stringify({ title, body, url })
  if (signature !== lastSignature || !lastRequestKey) { lastSignature = signature; lastRequestKey = crypto.randomUUID() }
  prepared.value = { title, body, url, requestKey: lastRequestKey, subscribers: data.value!.subscribers }
  confirmed.value = false; sendError.value = null; reviewing.value = true
}
async function send() {
  const message = prepared.value
  if (!message || sending.value || !confirmed.value || !canSend.value || !reviewing.value) return
  sending.value = true; sendError.value = null
  try {
    const result = await adminApi<NotificationQueued>('/admin/notifications/campaigns', {
      body: { requestKey: message.requestKey, title: message.title, body: message.body, url: message.url, confirm: true },
    })
    reviewing.value = false
    draft.title = ''; draft.body = ''; lastSignature = ''; lastRequestKey = ''; prepared.value = null
    say(`Campanha colocada na fila para ${result.audienceCount} aparelhos. Acompanhe o processamento no histórico.`)
    await loader.load()
    await nextTick(); historyHeading.value?.focus()
  } catch (error) { sendError.value = errorMessage(error, true) }
  finally { sending.value = false }
}

const cancelTarget = ref<NotificationCampaign | null>(null)
const cancelBusy = ref(false)
const cancelError = ref<string | null>(null)
const cancelOpen = computed({ get: () => Boolean(cancelTarget.value), set: (open: boolean) => { if (!open && !cancelBusy.value) cancelTarget.value = null } })
function askCancel(campaign: NotificationCampaign) {
  if (!mayCancel(campaign) || campaign.cancelled) return
  cancelTarget.value = campaign; cancelError.value = null
}
async function cancelCampaign() {
  const campaign = cancelTarget.value
  if (!campaign || cancelBusy.value || !mayCancel(campaign)) return
  cancelBusy.value = true; cancelError.value = null
  try {
    await adminApi(`/admin/notifications/campaigns/${encodeURIComponent(campaign.id)}/cancel`, { body: {} })
    cancelTarget.value = null
    say('Campanha cancelada. Um envio que já estava em andamento pode ser concluído.')
    await loader.load(); await nextTick(); historyHeading.value?.focus()
  } catch (error) { cancelError.value = errorMessage(error, true) }
  finally { cancelBusy.value = false }
}

const grantTarget = ref<NotificationGrant | null>(null)
const grantEnabled = ref(false)
const grantBusy = ref(false)
const grantError = ref<string | null>(null)
const grantOpen = computed({ get: () => Boolean(grantTarget.value), set: (open: boolean) => { if (!open && !grantBusy.value) grantTarget.value = null } })
function askGrant(user: NotificationGrant) {
  if (!canManage.value || user.role === 'admin' || (user.disabled && !user.allowed)) return
  grantTarget.value = user; grantEnabled.value = !user.allowed; grantError.value = null
}
async function saveGrant(reason: string) {
  const person = grantTarget.value
  if (!person || grantBusy.value || !canManage.value || reason.trim().length < 5 || reason.trim().length > 200) return
  grantBusy.value = true; grantError.value = null
  try {
    await adminApi(`/admin/notifications/grants/${encodeURIComponent(person.id)}`, { method: 'PUT', body: { enabled: grantEnabled.value, reason: reason.trim() } })
    const message = grantEnabled.value ? `Envio de notificações autorizado para ${person.displayName}.` : `Permissão de envio revogada para ${person.displayName}.`
    await grantsLoader.load(); grantTarget.value = null; say(message); await nextTick(); grantsHeading.value?.focus()
  } catch (error) { grantError.value = errorMessage(error, true) }
  finally { grantBusy.value = false }
}
onMounted(() => { if (allowed.value) void reload() })
</script>

<template>
  <div>
    <header class="admin-page-head">
      <div class="admin-page-head__text"><h1>Notificações</h1><p>Envie avisos aos aparelhos que autorizaram receber mensagens da Minha Folga.</p></div>
      <div v-if="allowed" class="admin-page-head__actions"><button type="button" class="btn btn--secondary" :aria-disabled="loader.loading.value || grantsLoader.loading.value ? 'true' : undefined" @click="!loader.loading.value && !grantsLoader.loading.value && reload()">Atualizar</button></div>
    </header>
    <p v-if="!allowed" class="notice notice--pending">Seu perfil não tem acesso às notificações.</p>
    <template v-else>
      <p v-if="feedback" class="notice notice--success"><AppIcon name="check-circle" /><span>{{ feedback }}</span></p>
      <AdminState :loading="loader.loading.value && !data" :error="loader.error.value" loading-text="Carregando notificações…" @retry="loader.load" />
      <template v-if="data && !loader.error.value">
        <section class="admin-panel notifications-summary" aria-labelledby="notifications-situation">
          <div class="admin-panel__head"><h2 id="notifications-situation">Público e disponibilidade</h2><AdminStatus :label="data.enabled ? 'Envio habilitado' : 'Envio desativado'" :tone="data.enabled ? 'success' : 'muted'" /></div>
          <p><strong>{{ data.subscribers }}</strong> aparelhos com avisos ativados. Limite de <strong>{{ data.dailyCampaignCap }}</strong> campanhas a cada 24 horas.</p>
          <p v-if="!data.enabled" class="field__hint">Novos envios estão desativados. O histórico, o cancelamento e a gestão de permissões continuam disponíveis.</p>
          <p v-else-if="data.subscribers === 0" class="field__hint">Ainda não há aparelhos inscritos para receber uma campanha.</p>
        </section>

        <section v-if="canSend" class="admin-panel" aria-labelledby="notifications-compose">
          <div class="admin-panel__head"><h2 id="notifications-compose">Nova campanha</h2></div>
          <div class="notifications-compose">
            <form class="form" novalidate @submit.prevent="review">
              <fieldset :disabled="!data.enabled || preparing || sending" class="notifications-fields">
                <div class="field"><label for="notification-title" class="field__label">Título</label><input id="notification-title" v-model="draft.title" class="input" type="text" :maxlength="limits.titleMax" autocomplete="off" required :aria-invalid="fieldErrors.title ? 'true' : undefined" :aria-describedby="fieldErrors.title ? 'notification-title-error' : 'notification-title-count'" /><p id="notification-title-count" class="char-count">{{ draft.title.length }}/{{ limits.titleMax }}</p><p v-if="fieldErrors.title" id="notification-title-error" class="field__error">{{ fieldErrors.title }}</p></div>
                <div class="field"><label for="notification-body" class="field__label">Mensagem</label><textarea id="notification-body" v-model="draft.body" class="textarea" rows="4" :maxlength="limits.bodyMax" required :aria-invalid="fieldErrors.body ? 'true' : undefined" :aria-describedby="fieldErrors.body ? 'notification-body-error' : 'notification-body-count'" /><p id="notification-body-count" class="char-count">{{ draft.body.length }}/{{ limits.bodyMax }}</p><p v-if="fieldErrors.body" id="notification-body-error" class="field__error">{{ fieldErrors.body }}</p></div>
                <div class="field"><label for="notification-url" class="field__label">Página aberta ao tocar</label><select id="notification-url" v-model="draft.url" class="select" :aria-invalid="fieldErrors.url ? 'true' : undefined" :aria-describedby="fieldErrors.url ? 'notification-url-error' : undefined"><option v-for="path in destinations" :key="path" :value="path">{{ names[path] ?? path }} — {{ path }}</option></select><p v-if="fieldErrors.url" id="notification-url-error" class="field__error">{{ fieldErrors.url }}</p></div>
              </fieldset>
              <p v-if="formError" class="notice notice--error" role="alert">{{ formError }}</p>
              <button type="submit" class="btn btn--primary" :aria-disabled="!mayPrepare || preparing || sending ? 'true' : undefined"><span v-if="preparing" class="spinner" aria-hidden="true" />{{ preparing ? 'Conferindo público…' : 'Revisar envio' }}</button>
            </form>
            <aside class="notifications-preview" aria-label="Prévia ilustrativa da notificação"><p class="notifications-preview__label">Prévia da mensagem</p><div class="notifications-preview__card"><AppIcon name="bell" /><div><span class="small muted">Minha Folga</span><h3>{{ draft.title || 'Título da notificação' }}</h3><p>{{ draft.body || 'Sua mensagem aparecerá aqui.' }}</p></div></div><p class="field__hint">A aparência varia conforme o aparelho e o navegador. Não inclua dados pessoais ou condições de crédito que não estejam confirmadas.</p></aside>
          </div>
        </section>

        <section class="admin-panel notifications-history" aria-labelledby="notifications-history">
          <div class="admin-panel__head"><h2 id="notifications-history" ref="historyHeading" tabindex="-1">Histórico de campanhas</h2></div>
          <p class="field__hint">“Aceitas pelo serviço” indica recebimento pelo serviço de notificações. Não confirma exibição no aparelho nem leitura.</p>
          <AdminState :empty="data.campaigns.length === 0" empty-title="Nenhuma campanha criada" />
          <ol v-if="data.campaigns.length" class="notifications-campaigns">
            <li v-for="campaign in data.campaigns" :key="campaign.id">
              <div class="notifications-campaigns__head"><div><h3>{{ campaign.title }}</h3><p class="small muted">{{ formatDateTime(campaign.createdAt) }}<template v-if="campaign.createdBy"> · {{ creator(campaign) }}</template></p></div><AdminStatus v-if="campaign.cancelled" label="Cancelada" tone="muted" /></div>
              <p class="notifications-body">{{ campaign.body }}</p><p class="small muted">Destino: {{ names[campaign.url] ?? campaign.url }} · {{ campaign.audienceCount }} aparelhos incluídos</p>
              <dl class="notifications-delivery"><div><dt>Na fila</dt><dd>{{ campaign.delivery.pending }}</dd></div><div><dt>Em processamento</dt><dd>{{ campaign.delivery.sending }}</dd></div><div><dt>Aceitas pelo serviço</dt><dd>{{ campaign.delivery.accepted }}</dd></div><div><dt>Falhas</dt><dd>{{ campaign.delivery.failed }}</dd></div><div><dt>Expiradas</dt><dd>{{ campaign.delivery.expired }}</dd></div><div><dt>Canceladas</dt><dd>{{ campaign.delivery.cancelled }}</dd></div></dl>
              <button v-if="mayCancel(campaign) && !campaign.cancelled && (campaign.delivery.pending > 0 || campaign.delivery.sending > 0)" type="button" class="btn btn--secondary btn--sm" @click="askCancel(campaign)">Cancelar pendentes<span class="visually-hidden"> da campanha {{ campaign.title }}</span></button>
            </li>
          </ol>
        </section>
      </template>

      <section v-if="canManage" class="admin-panel" aria-labelledby="notifications-permissions">
        <div class="admin-panel__head"><h2 id="notifications-permissions" ref="grantsHeading" tabindex="-1">Quem pode enviar</h2></div><p>Autorize pessoas nominalmente. O papel Administração já inclui esse acesso; os demais precisam de autorização nesta lista.</p>
        <AdminState :loading="grantsLoader.loading.value && !grantsLoader.data.value" :error="grantsLoader.error.value" loading-text="Carregando permissões…" @retry="grantsLoader.load" />
        <ul v-if="grantsLoader.data.value && !grantsLoader.error.value" class="notifications-grants">
          <li v-for="person in grants" :key="person.id"><div><strong>{{ person.displayName }}</strong><p class="small muted">{{ ROLES[person.role] ?? person.role }}<template v-if="person.disabled"> · Conta desativada</template><template v-if="person.grantedAt"> · Autorização em {{ formatDateTime(person.grantedAt) }}</template></p></div><div class="notifications-grants__actions"><AdminStatus :label="person.allowed ? 'Autorizado' : 'Sem permissão'" :tone="person.allowed ? 'success' : 'muted'" /><span v-if="person.role === 'admin'" class="small muted">Pelo papel Administração</span><button v-else-if="!person.disabled || person.allowed" type="button" class="btn btn--secondary btn--sm" :aria-label="`${person.allowed ? 'Revogar' : 'Autorizar'} ${person.displayName}`" @click="askGrant(person)">{{ person.allowed ? 'Revogar' : 'Autorizar' }}</button></div></li>
        </ul>
      </section>
    </template>

    <AdminDialog v-model:open="reviewing" title="Conferir envio" :busy="sending" :error="sendError" :return-focus="() => historyHeading">
      <template v-if="prepared"><p>Esta campanha será enviada a <strong>todos os aparelhos com avisos ativados</strong>. Há <strong>{{ prepared.subscribers }} aparelhos</strong> inscritos agora.</p><div class="notifications-review"><h3>{{ prepared.title }}</h3><p>{{ prepared.body }}</p><p class="small">Ao tocar: {{ names[prepared.url] ?? prepared.url }} — {{ prepared.url }}</p></div><p class="field__hint">Inscrições e cancelamentos podem alterar esse total até a criação da campanha. Depois de enviado ao serviço, o aviso não pode ser retirado.</p><label class="notifications-confirm"><input v-model="confirmed" type="checkbox" :disabled="sending" />Revisei a mensagem e confirmo o envio para todos os aparelhos inscritos.</label></template>
      <template #actions><button type="button" class="btn btn--secondary" :aria-disabled="sending ? 'true' : undefined" @click="!sending && (reviewing = false)">Voltar à edição</button><button type="button" class="btn btn--primary" :aria-disabled="sending || !confirmed ? 'true' : undefined" @click="send"><span v-if="sending" class="spinner" aria-hidden="true" />{{ sending ? 'Enfileirando…' : 'Confirmar envio' }}</button></template>
    </AdminDialog>
    <AdminDialog v-model:open="cancelOpen" title="Cancelar campanha?" :busy="cancelBusy" :error="cancelError" :return-focus="() => historyHeading"><template v-if="cancelTarget"><p><strong>{{ cancelTarget.title }}</strong></p><p>Os envios pendentes serão cancelados. Um envio já em andamento pode ser concluído; avisos aceitos pelo serviço não podem ser retirados.</p></template><template #actions><button type="button" class="btn btn--secondary" :aria-disabled="cancelBusy ? 'true' : undefined" @click="!cancelBusy && (cancelOpen = false)">Voltar</button><button type="button" class="btn btn--primary" :aria-disabled="cancelBusy ? 'true' : undefined" @click="cancelCampaign">{{ cancelBusy ? 'Cancelando…' : 'Confirmar cancelamento' }}</button></template></AdminDialog>
    <ReasonDialog v-model:open="grantOpen" :title="`${grantEnabled ? 'Autorizar' : 'Revogar'} envio: ${grantTarget?.displayName ?? ''}`" :confirm-label="grantEnabled ? 'Autorizar envio' : 'Revogar permissão'" :busy="grantBusy" :error="grantError" :return-focus="() => grantsHeading" @submit="saveGrant"><p v-if="grantTarget">{{ grantEnabled ? 'Essa pessoa poderá criar campanhas para todos os aparelhos inscritos e cancelar os envios pendentes das próprias campanhas. Não poderá conceder permissões a outras pessoas.' : 'Essa pessoa deixará de poder criar ou cancelar campanhas. Os demais acessos ao painel serão mantidos.' }}</p></ReasonDialog>
  </div>
</template>

<style scoped>
.admin-panel { margin-bottom: 24px; }
.notifications-compose { display: grid; grid-template-columns: minmax(0,1.1fr) minmax(0,1fr); gap: 36px; }
.notifications-fields { border: 0; margin: 0; padding: 0; display: grid; gap: 18px; min-width: 0; }
.notifications-fields .char-count { margin-block: 4px 0; }
.notifications-preview { background: var(--mf-cream); border-radius: 18px; padding: 24px; align-self: start; min-width: 0; }
.notifications-preview__label { font-size: .875rem; font-weight: 600; }
.notifications-preview__card { display: grid; grid-template-columns: 24px minmax(0,1fr); gap: 12px; padding: 16px; background: var(--mf-paper); border: 1px solid var(--mf-border); border-radius: 14px; margin-bottom: 16px; }
.notifications-preview__card > .icon { color: var(--mf-forest); margin-top: 2px; }
.notifications-preview__card h3 { font: 600 1rem/1.4 var(--mf-font-body); margin-block: 4px; }
.notifications-preview__card p, .notifications-review p, .notifications-review h3, .notifications-body { white-space: pre-wrap; overflow-wrap: anywhere; }
.notifications-preview__card p { margin: 0; font-size: .9375rem; }
.notifications-campaigns, .notifications-grants { list-style: none; padding: 0; margin: 20px 0 0; }
.notifications-campaigns > li { padding-block: 24px; border-top: 1px solid var(--mf-border); }
.notifications-campaigns > li:last-child { padding-bottom: 0; }
.notifications-campaigns__head, .notifications-grants > li { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
.notifications-campaigns__head h3 { font-size: 1.125rem; margin-bottom: 4px; overflow-wrap: anywhere; }
.notifications-delivery { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 16px; padding: 16px; margin-block: 16px; background: var(--mf-cream); border-radius: 12px; }
.notifications-delivery dt { font-size: .8125rem; color: var(--mf-muted); }
.notifications-delivery dd { margin: 2px 0 0; font-weight: 700; }
.notifications-grants > li { border-top: 1px solid var(--mf-border); padding-block: 18px; align-items: center; }
.notifications-grants p { margin-block: 4px 0; }
.notifications-grants__actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.notifications-review { padding: 18px; background: var(--mf-mint); border-radius: 14px; display: grid; gap: 10px; }
.notifications-review h3 { font-size: 1.125rem; margin: 0; }
.notifications-confirm { display: flex; align-items: start; gap: 12px; cursor: pointer; font-weight: 600; padding-block: 10px; }
.notifications-confirm input { flex: none; width: 20px; height: 20px; margin-top: 2px; }
@media(max-width: 899px) { .notifications-compose { grid-template-columns: 1fr; } .notifications-grants > li { align-items: start; flex-direction: column; } .notifications-grants__actions { justify-content: flex-start; } }
@media(max-width: 479px) { .notifications-delivery { grid-template-columns: repeat(2,minmax(0,1fr)); } .notifications-preview { padding: 16px; } }
</style>
