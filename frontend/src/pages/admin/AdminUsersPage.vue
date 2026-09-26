<script setup lang="ts">
/**
 * Usuários do painel (users:manage): contas individuais, papel, desativação e redefinição de
 * senha/MFA com confirmação. A senha temporária é exibida uma única vez e não fica guardada.
 * O servidor impede remover o último admin (`last_admin`).
 * Acessibilidade: durante o envio os botões ficam com aria-disabled (o foco não cai no <body>);
 * erros aparecem no próprio diálogo, com foco; confirmações são anunciadas pela região viva
 * persistente (useAnnouncer); ao fechar o aviso da senha temporária, o foco volta para a pessoa.
 */
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AdminDialog from '@/components/admin/AdminDialog.vue'
import AdminState from '@/components/admin/AdminState.vue'
import AdminStatus from '@/components/admin/AdminStatus.vue'
import TemporaryPassword from '@/components/admin/TemporaryPassword.vue'
import { ROLES } from '@/components/admin/labels'
import type { AdminRole, AdminUser, UserWithPassword } from '@/components/admin/types'
import { formatDateTime } from '@/lib/format'
import { ApiError } from '@/services/api'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { adminApi, errorMessage, useAdminSession } from '@/composables/useAdminSession'
import { useAdminLoader, useAdminTitle } from '@/composables/useAdminLoader'

useAdminTitle('Usuários')

const LAST_ADMIN_MESSAGE = 'Não é possível: o painel precisa manter pelo menos uma pessoa ativa com papel de Administração.'
const ROLE_HINT = 'As permissões de cada papel são definidas no servidor. Dê a cada pessoa só o acesso de que o trabalho precisa.'

const session = useAdminSession()
const { announce } = useAnnouncer()
const me = computed(() => session.state.user?.id ?? '')
// E-mail quebra só depois do "@" (sem picotar letra a letra na tabela).
function emailParts(email: string): [string, string] {
  const at = email.lastIndexOf('@')
  return at > 0 ? [email.slice(0, at + 1), email.slice(at + 1)] : [email, '']
}

const roleOptions = Object.entries(ROLES).map(([value, text]) => ({ value: value as AdminRole, label: text }))

const loader = useAdminLoader(() => adminApi<{ items: AdminUser[] }>('/admin/users'))
const users = computed(() =>
  [...(loader.data.value?.items ?? [])].sort((a, b) => Number(a.disabled) - Number(b.disabled) || a.displayName.localeCompare(b.displayName, 'pt-BR')),
)

const feedback = ref('')
const temp = ref<{ password: string; displayName: string; userId: string } | null>(null)
const tempAnchor = ref<HTMLElement | null>(null)

function setFeedback(message: string) {
  feedback.value = message
  announce(message)
}

function friendly(e: unknown): string {
  if (e instanceof ApiError && e.code === 'last_admin') return e.message || LAST_ADMIN_MESSAGE
  return errorMessage(e)
}

async function showTemp(password: string | undefined, displayName: string, userId: string) {
  if (!password) return
  temp.value = { password, displayName, userId }
  await nextTick()
  tempAnchor.value?.focus()
}

/** Aviso da senha temporária fechado: o foco vai para "Gerenciar" da pessoa (o aviso saiu da tela). */
async function closeTemp() {
  const userId = temp.value?.userId
  temp.value = null
  await nextTick()
  const target = userId ? document.querySelector<HTMLElement>(`[data-manage="${CSS.escape(userId)}"]`) : null
  ;(target ?? document.getElementById('conteudo-admin'))?.focus()
}

function upsert(user: AdminUser) {
  const data = loader.data.value
  const items = data?.items ?? []
  loader.data.value = { items: items.some((u) => u.id === user.id) ? items.map((u) => (u.id === user.id ? user : u)) : [...items, user] }
}

// Criar usuário ----------------------------------------------------------------------------------
const createOpen = ref(false)
const createBusy = ref(false)
const createError = ref<string | null>(null)
const createFields = ref<Record<string, string>>({})
const newUser = reactive({ email: '', displayName: '', role: '' as AdminRole | '' })

function openCreate() {
  newUser.email = ''
  newUser.displayName = ''
  newUser.role = ''
  createError.value = null
  createFields.value = {}
  createOpen.value = true
}

async function createUser() {
  if (createBusy.value) return
  const fields: Record<string, string> = {}
  const email = newUser.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Informe um e-mail válido.'
  if (newUser.displayName.trim().length < 2) fields.displayName = 'Informe o nome com pelo menos 2 caracteres.'
  if (!newUser.role) fields.role = 'Escolha o papel.'
  createFields.value = fields
  createError.value = null
  const first = Object.keys(fields)[0]
  if (first) {
    document.getElementById(`novo-usuario-${first}`)?.focus()
    return
  }
  createBusy.value = true
  try {
    const res = await adminApi<UserWithPassword>('/admin/users', {
      body: { email, displayName: newUser.displayName.trim(), role: newUser.role },
    })
    upsert(res.user)
    createOpen.value = false
    setFeedback(`Usuário ${res.user.displayName} criado.`)
    await showTemp(res.temporaryPassword, res.user.displayName, res.user.id)
  } catch (e) {
    if (e instanceof ApiError && e.code === 'email_in_use') {
      createFields.value = { email: e.message || 'Este e-mail já tem acesso ao painel.' }
      document.getElementById('novo-usuario-email')?.focus()
    } else {
      createError.value = errorMessage(e)
      if (e instanceof ApiError && Object.keys(e.fields).length) createFields.value = { ...e.fields }
    }
  } finally {
    createBusy.value = false
  }
}

// Gerenciar usuário (um diálogo, com etapa de confirmação) ------------------------------------------
type ManageStep = 'menu' | 'resetPassword' | 'resetMfa' | 'disable' | 'enable'
const managed = ref<AdminUser | null>(null)
const manageStep = ref<ManageStep>('menu')
const manageBusy = ref(false)
const manageError = ref<string | null>(null)
const roleDraft = ref<AdminRole | ''>('')
const manageOpen = computed({
  get: () => managed.value !== null,
  set: (v: boolean) => {
    if (!v && !manageBusy.value) managed.value = null
  },
})

const CONFIRM: Record<Exclude<ManageStep, 'menu'>, { title: string; text: string; button: string; danger: boolean }> = {
  resetPassword: {
    title: 'Redefinir a senha',
    text: 'Uma nova senha temporária será gerada e exibida uma única vez. As sessões abertas dessa pessoa são encerradas e ela precisará trocar a senha no próximo acesso.',
    button: 'Gerar senha temporária',
    danger: false,
  },
  resetMfa: {
    title: 'Redefinir o autenticador (MFA)',
    text: 'O autenticador atual deixa de valer. No próximo acesso, a pessoa cadastra um novo aplicativo. Confirme a identidade dela por um canal seguro antes de continuar.',
    button: 'Redefinir MFA',
    danger: false,
  },
  disable: {
    title: 'Desativar o acesso',
    text: 'A pessoa deixa de conseguir entrar e as sessões abertas são encerradas. O histórico e a auditoria permanecem. O acesso pode ser reativado depois.',
    button: 'Desativar acesso',
    danger: true,
  },
  enable: {
    title: 'Reativar o acesso',
    text: 'A pessoa volta a conseguir entrar com a senha e o autenticador atuais.',
    button: 'Reativar acesso',
    danger: false,
  },
}
const confirmMeta = computed(() => (manageStep.value === 'menu' ? null : CONFIRM[manageStep.value]))

function openManage(user: AdminUser) {
  managed.value = user
  manageStep.value = 'menu'
  manageError.value = null
  roleDraft.value = user.role
}

async function goStep(step: ManageStep) {
  if (manageBusy.value) return
  manageStep.value = step
  manageError.value = null
  await nextTick()
  document.getElementById('gerenciar-etapa')?.focus()
}

async function patchUser(body: Record<string, unknown>, done: (res: UserWithPassword) => string) {
  const user = managed.value
  if (!user || manageBusy.value) return
  manageBusy.value = true
  manageError.value = null
  try {
    const res = await adminApi<UserWithPassword>(`/admin/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body })
    upsert(res.user)
    setFeedback(done(res))
    manageBusy.value = false
    managed.value = null
    await showTemp(res.temporaryPassword, res.user.displayName, res.user.id)
    // Mudanças no próprio usuário podem alterar permissões da sessão atual.
    if (res.user.id === me.value) void session.refresh().catch(() => undefined)
  } catch (e) {
    manageError.value = friendly(e)
  } finally {
    manageBusy.value = false
  }
}

function saveRole() {
  if (!managed.value || !roleDraft.value || roleDraft.value === managed.value.role) return
  const role = roleDraft.value
  void patchUser({ role }, (res) => `Papel de ${res.user.displayName} alterado para ${ROLES[res.user.role]}.`)
}

function confirmStep() {
  const step = manageStep.value
  if (step === 'resetPassword') void patchUser({ resetPassword: true }, (res) => `Senha de ${res.user.displayName} redefinida.`)
  else if (step === 'resetMfa') void patchUser({ resetMfa: true }, (res) => `Autenticador de ${res.user.displayName} redefinido.`)
  else if (step === 'disable') void patchUser({ disabled: true }, (res) => `Acesso de ${res.user.displayName} desativado.`)
  else if (step === 'enable') void patchUser({ disabled: false }, (res) => `Acesso de ${res.user.displayName} reativado.`)
}

onMounted(() => void loader.load())
</script>

<template>
  <div>
    <header class="admin-page-head">
      <div class="admin-page-head__text">
        <h1>Usuários</h1>
        <p>Cada pessoa tem acesso individual com senha e autenticador. Nada de contas compartilhadas.</p>
      </div>
      <div class="admin-page-head__actions">
        <button type="button" class="btn btn--primary" @click="openCreate">Criar usuário</button>
      </div>
    </header>

    <div v-if="temp" ref="tempAnchor" tabindex="-1" class="users__temp">
      <TemporaryPassword :password="temp.password" :display-name="temp.displayName" @done="closeTemp" />
    </div>

    <!-- Sem role="status": a confirmação é anunciada pela região viva persistente (useAnnouncer). -->
    <p v-if="feedback" class="notice notice--success users__feedback">
      <AppIcon name="check-circle" />
      <span>{{ feedback }}</span>
    </p>

    <AdminState
      :loading="loader.loading.value && !loader.data.value"
      :error="loader.error.value"
      :empty="!!loader.data.value && users.length === 0 && !loader.error.value"
      loading-text="Carregando usuários…"
      empty-title="Nenhum usuário"
      @retry="loader.load"
    />

    <div v-if="users.length && !loader.error.value" class="admin-table-wrap" tabindex="0" role="region" aria-labelledby="usuarios-caption">
      <table class="admin-table">
        <caption id="usuarios-caption">
          Usuários do painel
          <span>· {{ users.filter((u) => !u.disabled).length }} ativos de {{ users.length }}</span>
        </caption>
        <thead>
          <tr>
            <th scope="col">Nome</th>
            <th scope="col">E-mail</th>
            <th scope="col">Papel</th>
            <th scope="col">Situação</th>
            <th scope="col">Autenticador</th>
            <th scope="col">Último acesso</th>
            <th scope="col"><span class="visually-hidden">Ações</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id" :class="{ 'users__row--off': u.disabled }">
            <th scope="row" class="admin-table__primary">
              {{ u.displayName }}
              <span v-if="u.id === me" class="badge badge--outline users__you">você</span>
            </th>
            <td class="users__email"><span class="admin-mono">{{ emailParts(u.email)[0] }}<wbr />{{ emailParts(u.email)[1] }}</span></td>
            <td class="nowrap">{{ ROLES[u.role] ?? u.role }}</td>
            <td>
              <AdminStatus v-if="u.disabled" label="Desativado" tone="muted" />
              <AdminStatus v-else-if="u.mustChangePassword" label="Troca de senha pendente" tone="pending" />
              <AdminStatus v-else label="Ativo" tone="success" />
            </td>
            <td class="nowrap">
              <span class="users__mfa">
                <AppIcon :name="u.mfaEnabled ? 'check-circle' : 'clock'" />
                {{ u.mfaEnabled ? 'Cadastrado' : 'Pendente' }}
              </span>
            </td>
            <td class="nowrap">{{ u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Nunca' }}</td>
            <td class="nowrap">
              <button type="button" class="btn btn--secondary btn--sm" :data-manage="u.id" @click="openManage(u)">
                Gerenciar<span class="visually-hidden"> {{ u.displayName }}</span>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Criar -->
    <AdminDialog v-model:open="createOpen" title="Criar usuário" :busy="createBusy" :error="createError">
      <form id="form-novo-usuario" class="form" novalidate @submit.prevent="createUser">
        <div class="field">
          <label class="field__label" for="novo-usuario-displayName">Nome</label>
          <input id="novo-usuario-displayName" v-model="newUser.displayName" class="input" type="text" maxlength="80" autocomplete="off" :aria-invalid="createFields.displayName ? 'true' : undefined" :aria-describedby="createFields.displayName ? 'novo-usuario-displayName-erro' : undefined" />
          <p v-if="createFields.displayName" id="novo-usuario-displayName-erro" class="field__error"><AppIcon name="alert" />{{ createFields.displayName }}</p>
        </div>
        <div class="field">
          <label class="field__label" for="novo-usuario-email">E-mail de acesso</label>
          <input id="novo-usuario-email" v-model="newUser.email" class="input" type="email" maxlength="200" autocomplete="off" spellcheck="false" :aria-invalid="createFields.email ? 'true' : undefined" :aria-describedby="createFields.email ? 'novo-usuario-email-erro' : 'novo-usuario-email-dica'" />
          <p v-if="createFields.email" id="novo-usuario-email-erro" class="field__error"><AppIcon name="alert" />{{ createFields.email }}</p>
          <p v-else id="novo-usuario-email-dica" class="field__hint">E-mail individual da pessoa, nunca uma caixa compartilhada.</p>
        </div>
        <div class="field">
          <label class="field__label" for="novo-usuario-role">Papel</label>
          <select id="novo-usuario-role" v-model="newUser.role" class="select" :aria-invalid="createFields.role ? 'true' : undefined" :aria-describedby="`novo-usuario-role-dica${createFields.role ? ' novo-usuario-role-erro' : ''}`">
            <option value="" disabled>Escolha</option>
            <option v-for="o in roleOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <p id="novo-usuario-role-dica" class="field__hint">{{ ROLE_HINT }}</p>
          <p v-if="createFields.role" id="novo-usuario-role-erro" class="field__error"><AppIcon name="alert" />{{ createFields.role }}</p>
        </div>
        <p class="field__hint">Uma senha temporária será exibida uma única vez depois de criar. No primeiro acesso, a pessoa troca a senha e cadastra o autenticador.</p>
      </form>
      <template #actions>
        <button type="button" class="btn btn--secondary" :aria-disabled="createBusy ? 'true' : undefined" @click="!createBusy && (createOpen = false)">
          Cancelar
        </button>
        <button type="submit" form="form-novo-usuario" class="btn btn--primary" :aria-disabled="createBusy ? 'true' : undefined">
          <span v-if="createBusy" class="spinner" aria-hidden="true" />
          {{ createBusy ? 'Criando…' : 'Criar usuário' }}
        </button>
      </template>
    </AdminDialog>

    <!-- Gerenciar -->
    <AdminDialog
      v-model:open="manageOpen"
      :title="managed ? `Gerenciar ${managed.displayName}` : 'Gerenciar'"
      :busy="manageBusy"
      :error="manageError"
    >
      <template v-if="managed">
        <p v-if="managed.id === me" class="notice notice--pending">
          <AppIcon name="alert" />
          <span>Você está alterando o seu próprio acesso.</span>
        </p>
        <dl class="admin-dl users__summary">
          <dt>E-mail</dt>
          <dd class="admin-mono">{{ managed.email }}</dd>
          <dt>Criado em</dt>
          <dd>{{ formatDateTime(managed.createdAt) }}</dd>
          <dt>Autenticador</dt>
          <dd>{{ managed.mfaEnabled ? 'Cadastrado' : 'Pendente de cadastro' }}</dd>
        </dl>

        <template v-if="manageStep === 'menu'">
          <form class="users__role" novalidate @submit.prevent="saveRole">
            <div class="field">
              <label class="field__label" for="gerenciar-papel">Papel</label>
              <select id="gerenciar-papel" v-model="roleDraft" class="select" :disabled="managed.disabled || manageBusy" aria-describedby="gerenciar-papel-dica">
                <option v-for="o in roleOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
              <p id="gerenciar-papel-dica" class="field__hint">{{ managed.disabled ? 'Reative o acesso para alterar o papel.' : ROLE_HINT }}</p>
            </div>
            <button
              type="submit"
              class="btn btn--primary btn--sm"
              :disabled="managed.disabled"
              :aria-disabled="manageBusy || roleDraft === managed.role ? 'true' : undefined"
            >
              <span v-if="manageBusy" class="spinner" aria-hidden="true" />
              Salvar papel
            </button>
          </form>
          <div class="users__actions">
            <button type="button" class="btn btn--secondary btn--sm" :disabled="managed.disabled" :aria-disabled="manageBusy ? 'true' : undefined" @click="goStep('resetPassword')">Redefinir senha…</button>
            <button type="button" class="btn btn--secondary btn--sm" :disabled="managed.disabled" :aria-disabled="manageBusy ? 'true' : undefined" @click="goStep('resetMfa')">Redefinir MFA…</button>
            <button v-if="!managed.disabled" type="button" class="btn btn--secondary btn--sm users__danger" :aria-disabled="manageBusy ? 'true' : undefined" @click="goStep('disable')">Desativar acesso…</button>
            <button v-else type="button" class="btn btn--secondary btn--sm" :aria-disabled="manageBusy ? 'true' : undefined" @click="goStep('enable')">Reativar acesso…</button>
          </div>
        </template>

        <div v-else-if="confirmMeta" class="users__confirm">
          <h3 id="gerenciar-etapa" tabindex="-1">{{ confirmMeta.title }}</h3>
          <p>{{ confirmMeta.text }}</p>
        </div>

      </template>
      <template #actions>
        <template v-if="manageStep === 'menu'">
          <button type="button" class="btn btn--secondary" :aria-disabled="manageBusy ? 'true' : undefined" @click="manageOpen = false">Fechar</button>
        </template>
        <template v-else-if="confirmMeta">
          <button type="button" class="btn btn--secondary" :aria-disabled="manageBusy ? 'true' : undefined" @click="goStep('menu')">Voltar</button>
          <button type="button" class="btn" :class="confirmMeta.danger ? 'btn--danger' : 'btn--primary'" :aria-disabled="manageBusy ? 'true' : undefined" @click="confirmStep">
            <span v-if="manageBusy" class="spinner" aria-hidden="true" />
            {{ manageBusy ? 'Aplicando…' : confirmMeta.button }}
          </button>
        </template>
      </template>
    </AdminDialog>
  </div>
</template>

<style scoped>
.users__email .admin-mono {
  overflow-wrap: normal;
}

.users__temp {
  margin-bottom: var(--mf-space-4);
}

.users__temp:focus {
  outline: none;
}

.users__feedback {
  margin-bottom: var(--mf-space-4);
  align-items: center;
}

.users__you {
  margin-left: 6px;
  padding: 0 8px;
  font-size: 0.75rem;
  vertical-align: middle;
}

.users__mfa {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.users__mfa .icon {
  width: 18px;
  height: 18px;
  color: var(--mf-forest);
}

.users__row--off > * {
  color: var(--mf-muted);
}

.users__summary {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--mf-cream);
}

.users__role {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 12px;
}

.users__role .field {
  flex: 1 1 240px;
}

.users__role .field__hint {
  min-height: 0;
}

.users__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: var(--mf-space-3);
  border-top: 1px solid var(--mf-border);
}

.users__danger {
  color: var(--mf-error);
  border-color: var(--mf-error);
}

.users__danger:hover {
  background: var(--mf-error-bg);
  color: var(--mf-error);
}

.users__confirm {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--mf-border);
}

.users__confirm h3 {
  margin: 0 0 6px;
}

.users__confirm h3:focus {
  outline: none;
}
</style>
