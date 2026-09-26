<script setup lang="ts">
/**
 * Minha conta: dados do próprio usuário, permissões do perfil e troca de senha (mínimo de 12
 * caracteres, com confirmação). Com senha temporária, esta é a única tela liberada até a troca.
 */
import { computed, nextTick, reactive, ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { PERMISSIONS, ROLES } from '@/components/admin/labels'
import { defaultAdminRoute } from '@/components/admin/nav'
import { formatDateTime } from '@/lib/format'
import { ApiError } from '@/services/api'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { errorMessage, useAdminSession } from '@/composables/useAdminSession'
import { useAdminTitle } from '@/composables/useAdminLoader'

useAdminTitle('Minha conta')

const MIN = 12
const MAX = 200

const session = useAdminSession()
const { announce } = useAnnouncer()
const user = computed(() => session.state.user)
const forced = computed(() => session.mustChangePassword.value)
const permissions = computed(() => [...session.state.permissions].sort((a, b) => (PERMISSIONS[a] ?? a).localeCompare(PERMISSIONS[b] ?? b, 'pt-BR')))

const form = reactive({ current: '', next: '', confirm: '' })
const fields = ref<{ current?: string; next?: string; confirm?: string }>({})
const busy = ref(false)
const error = ref('')
const success = ref(false)
const wasForced = ref(false)
const show = ref(false)

const strength = computed(() => {
  const n = form.next.length
  if (!n) return ''
  if (n < MIN) return `${n} de ${MIN} caracteres mínimos`
  return `${n} caracteres`
})

async function submit() {
  if (busy.value) return
  error.value = ''
  success.value = false
  const f: typeof fields.value = {}
  if (!form.current) f.current = 'Informe a senha atual.'
  if (form.next.length < MIN) f.next = `A nova senha precisa ter pelo menos ${MIN} caracteres.`
  else if (form.next.length > MAX) f.next = `A nova senha pode ter no máximo ${MAX} caracteres.`
  else if (form.next === form.current) f.next = 'Escolha uma senha diferente da atual.'
  if (!f.next && form.confirm !== form.next) f.confirm = 'A confirmação não é igual à nova senha.'
  fields.value = f
  const first = (['current', 'next', 'confirm'] as const).find((k) => f[k])
  if (first) {
    await nextTick()
    document.getElementById(`conta-${first}`)?.focus()
    return
  }
  busy.value = true
  wasForced.value = forced.value
  try {
    await session.changePassword(form.current, form.next)
    form.current = ''
    form.next = ''
    form.confirm = ''
    success.value = true
    // O foco fica no botão "Trocar senha"; a confirmação é anunciada.
    announce('Senha alterada. Outras sessões abertas com a sua conta foram encerradas.')
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.code === 'invalid_credentials' || e.code === 'invalid_password')) {
      fields.value = { current: e.message || 'A senha atual não confere.' }
      form.current = ''
      await nextTick()
      document.getElementById('conta-current')?.focus()
    } else if (e instanceof ApiError && Object.keys(e.fields).length) {
      // Ex.: senha atual incorreta ou nova senha fora da política (contém o e-mail etc.).
      fields.value = {
        current: e.fields.currentPassword,
        next: e.fields.newPassword,
      }
      error.value = e.message
      if (e.fields.currentPassword) form.current = ''
      await nextTick()
      document.getElementById(e.fields.currentPassword ? 'conta-current' : 'conta-next')?.focus()
    } else {
      error.value = errorMessage(e)
    }
  } finally {
    busy.value = false
  }
}

const homeRoute = computed(() => defaultAdminRoute(session.can))
</script>

<template>
  <div>
    <header class="admin-page-head">
      <div class="admin-page-head__text">
        <h1>Minha conta</h1>
        <p>Seus dados de acesso ao painel interno e a troca de senha.</p>
      </div>
    </header>

    <div v-if="forced" class="notice notice--pending account__forced" role="status">
      <AppIcon name="lock" />
      <div>
        <p><strong>Troque a senha temporária para continuar.</strong></p>
        <p>Depois da troca, as áreas do painel ficam disponíveis conforme o seu perfil.</p>
      </div>
    </div>

    <div class="admin-grid admin-grid--detail">
      <section class="admin-panel" aria-labelledby="senha-titulo">
        <h2 id="senha-titulo">Trocar senha</h2>

        <!-- Sem role="status": a confirmação é anunciada pela região viva persistente (useAnnouncer). -->
        <div v-if="success" class="notice notice--success account__done">
          <AppIcon name="check-circle" />
          <div>
            <p><strong>Senha alterada.</strong> Outras sessões abertas com a sua conta foram encerradas.</p>
            <p v-if="wasForced && !forced">
              <RouterLink :to="{ name: homeRoute }">Ir para o painel</RouterLink>
            </p>
          </div>
        </div>

        <form class="form" novalidate @submit.prevent="submit">
          <input type="text" name="username" autocomplete="username" :value="user?.email ?? ''" class="visually-hidden" tabindex="-1" aria-hidden="true" readonly />
          <div class="field">
            <label class="field__label" for="conta-current">Senha atual{{ forced ? ' (temporária)' : '' }}</label>
            <input
              id="conta-current"
              v-model="form.current"
              class="input"
              :type="show ? 'text' : 'password'"
              autocomplete="current-password"
              :maxlength="MAX"
              :aria-invalid="fields.current ? 'true' : undefined"
              :aria-describedby="fields.current ? 'conta-current-erro' : undefined"
            />
            <p v-if="fields.current" id="conta-current-erro" class="field__error"><AppIcon name="alert" />{{ fields.current }}</p>
          </div>
          <div class="field">
            <label class="field__label" for="conta-next">Nova senha</label>
            <p id="conta-next-dica" class="field__hint">Pelo menos {{ MIN }} caracteres. Prefira uma frase longa, exclusiva deste painel.</p>
            <input
              id="conta-next"
              v-model="form.next"
              class="input"
              :type="show ? 'text' : 'password'"
              autocomplete="new-password"
              :minlength="MIN"
              :maxlength="MAX"
              :aria-invalid="fields.next ? 'true' : undefined"
              :aria-describedby="`conta-next-dica conta-next-conta${fields.next ? ' conta-next-erro' : ''}`"
            />
            <span id="conta-next-conta" class="char-count">{{ strength }}</span>
            <p v-if="fields.next" id="conta-next-erro" class="field__error"><AppIcon name="alert" />{{ fields.next }}</p>
          </div>
          <div class="field">
            <label class="field__label" for="conta-confirm">Confirme a nova senha</label>
            <input
              id="conta-confirm"
              v-model="form.confirm"
              class="input"
              :type="show ? 'text' : 'password'"
              autocomplete="new-password"
              :maxlength="MAX"
              :aria-invalid="fields.confirm ? 'true' : undefined"
              :aria-describedby="fields.confirm ? 'conta-confirm-erro' : undefined"
            />
            <p v-if="fields.confirm" id="conta-confirm-erro" class="field__error"><AppIcon name="alert" />{{ fields.confirm }}</p>
          </div>
          <label class="choice choice--plain" for="conta-mostrar">
            <input id="conta-mostrar" v-model="show" type="checkbox" />
            <span>Mostrar as senhas</span>
          </label>
          <div v-if="error" class="notice notice--error" role="alert">
            <AppIcon name="alert" />
            <p>{{ error }}</p>
          </div>
          <div>
            <button type="submit" class="btn btn--primary" :aria-disabled="busy ? 'true' : undefined">
              <span v-if="busy" class="spinner" aria-hidden="true" />
              {{ busy ? 'Salvando…' : 'Trocar senha' }}
            </button>
          </div>
        </form>
      </section>

      <div>
        <section v-if="user" class="admin-panel" aria-labelledby="dados-conta-titulo">
          <h2 id="dados-conta-titulo">Seus dados</h2>
          <dl class="admin-dl">
            <dt>Nome</dt>
            <dd>{{ user.displayName }}</dd>
            <dt>E-mail</dt>
            <dd class="admin-mono">{{ user.email }}</dd>
            <dt>Papel</dt>
            <dd>{{ ROLES[user.role] ?? user.role }}</dd>
            <dt>Autenticador</dt>
            <dd>{{ user.mfaEnabled ? 'Cadastrado' : 'Pendente' }}</dd>
            <dt>Último acesso</dt>
            <dd>{{ user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—' }}</dd>
            <dt>Conta criada em</dt>
            <dd>{{ formatDateTime(user.createdAt) }}</dd>
          </dl>
          <p class="field__hint account__hint">Para mudar nome, e-mail ou papel, ou se perder o autenticador, fale com a administração do painel.</p>
        </section>

        <section class="admin-panel" aria-labelledby="permissoes-titulo">
          <h2 id="permissoes-titulo">O que o seu perfil permite</h2>
          <ul v-if="permissions.length" class="account__perms">
            <li v-for="p in permissions" :key="p">
              <AppIcon name="check" />
              <span>{{ PERMISSIONS[p] ?? p }}</span>
            </li>
          </ul>
          <p v-else class="muted">Nenhuma permissão além de gerenciar a própria conta.</p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.account__forced {
  margin-bottom: var(--mf-space-4);
}

.account__done {
  margin-bottom: var(--mf-space-3);
}

.account__hint {
  margin-top: var(--mf-space-3);
}

.account__perms {
  display: grid;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 0.9375rem;
}

.account__perms li {
  display: flex;
  gap: 8px;
  margin: 0;
}

.account__perms .icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 3px;
  color: var(--mf-forest);
}
</style>
