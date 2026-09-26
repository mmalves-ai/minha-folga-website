<script setup lang="ts">
/**
 * Entrada no painel: e-mail e senha → código do autenticador (MFA). No primeiro acesso, cadastra
 * o autenticador (QR gerado no servidor, exibido como imagem, e chave para digitação manual).
 * Mensagens de erro de credencial são as genéricas do servidor (não revelam se a conta existe).
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import BrandLogo from '@/components/site/BrandLogo.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { groupSecret, otpauthInfo, svgToDataUrl } from '@/components/admin/qr'
import type { MfaSetup } from '@/components/admin/types'
import { ApiError } from '@/services/api'
import { errorMessage, useAdminSession } from '@/composables/useAdminSession'
import { useAdminTitle } from '@/composables/useAdminLoader'

const session = useAdminSession()
const step = computed(() => session.state.status)
const isSetup = computed(() => step.value === 'mfa_setup_required')
const isCode = computed(() => step.value === 'mfa_required' || step.value === 'mfa_setup_required')

useAdminTitle(() => (isSetup.value ? 'Cadastrar autenticador' : isCode.value ? 'Confirmar acesso' : 'Entrar'))

const heading = ref<HTMLElement | null>(null)

// Etapa 1: e-mail e senha --------------------------------------------------------------------------
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const credBusy = ref(false)
const credError = ref('')
const credFields = ref<{ email?: string; password?: string }>({})
const emailInput = ref<HTMLInputElement | null>(null)
const passwordInput = ref<HTMLInputElement | null>(null)

async function submitCredentials() {
  if (credBusy.value) return
  credError.value = ''
  const fields: { email?: string; password?: string } = {}
  if (!email.value.trim()) fields.email = 'Informe seu e-mail de acesso.'
  else if (!/^[^\s@]+@[^\s@]+$/.test(email.value.trim())) fields.email = 'Confira o e-mail.'
  if (!password.value) fields.password = 'Informe sua senha.'
  credFields.value = fields
  if (fields.email || fields.password) {
    await nextTick()
    ;(fields.email ? emailInput.value : passwordInput.value)?.focus()
    return
  }
  credBusy.value = true
  try {
    await session.login(email.value.trim(), password.value)
    password.value = ''
  } catch (e) {
    credError.value = rateLimitMessage(e) ?? errorMessage(e)
    password.value = ''
    await nextTick()
    passwordInput.value?.focus()
  } finally {
    credBusy.value = false
  }
}

function rateLimitMessage(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.status !== 429) return null
  const seconds = Number(e.details.retryAfterSeconds)
  if (!Number.isFinite(seconds) || seconds <= 0) return e.message
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  return `${e.message} Tente de novo em cerca de ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`
}

// Cadastro do autenticador (primeiro acesso) --------------------------------------------------------
const setup = ref<MfaSetup | null>(null)
const setupLoading = ref(false)
const setupError = ref('')
const qrUrl = computed(() => (setup.value ? svgToDataUrl(setup.value.qrSvg) : null))
const otp = computed(() => (setup.value ? otpauthInfo(setup.value.otpauthUrl) : { issuer: null, period: 30 }))
const secretCopied = ref(false)

async function loadSetup() {
  if (setupLoading.value) return
  setupLoading.value = true
  setupError.value = ''
  try {
    setup.value = await session.setupMfa()
  } catch (e) {
    setupError.value = errorMessage(e)
  } finally {
    setupLoading.value = false
  }
}

async function copySecret() {
  if (!setup.value) return
  try {
    await navigator.clipboard.writeText(setup.value.secret)
    secretCopied.value = true
  } catch {
    secretCopied.value = false
  }
}

// Etapa 2: código de 6 dígitos ----------------------------------------------------------------------
const code = ref('')
const codeBusy = ref(false)
const codeError = ref('')
const codeFieldError = ref('')
const codeInput = ref<HTMLInputElement | null>(null)

function onCodeInput(event: Event) {
  const value = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6)
  code.value = value
  if (codeFieldError.value && value.length === 6) codeFieldError.value = ''
}

async function submitCode() {
  if (codeBusy.value) return
  codeError.value = ''
  if (!/^\d{6}$/.test(code.value)) {
    codeFieldError.value = 'Digite os 6 números do aplicativo autenticador.'
    codeInput.value?.focus()
    return
  }
  codeFieldError.value = ''
  codeBusy.value = true
  try {
    await session.verifyMfa(code.value)
  } catch (e) {
    const remaining = e instanceof ApiError ? Number(e.details.attemptsRemaining) : NaN
    codeError.value =
      errorMessage(e) +
      (Number.isFinite(remaining) && remaining >= 0 ? ` ${remaining === 1 ? 'Resta 1 tentativa.' : `Restam ${remaining} tentativas.`}` : '')
    code.value = ''
    await nextTick()
    codeInput.value?.focus()
  } finally {
    codeBusy.value = false
  }
}

async function useAnotherAccount() {
  if (codeBusy.value) return
  await session.logout(null)
}

// Troca de etapa: limpa estados, carrega o cadastro do MFA e leva o foco ao título da etapa.
watch(step, async (now, before) => {
  if (now === before) return
  code.value = ''
  codeError.value = ''
  codeFieldError.value = ''
  if (now === 'mfa_setup_required') void loadSetup()
  else setup.value = null
  await nextTick()
  heading.value?.focus()
})

onMounted(() => {
  if (isSetup.value) void loadSetup()
  // Com MFA já cadastrado, o foco vai direto ao campo do código (o rótulo é anunciado).
  if (step.value === 'anonymous') emailInput.value?.focus()
  else if (step.value === 'mfa_required') codeInput.value?.focus()
  else heading.value?.focus()
})
</script>

<template>
  <div class="login" :class="{ 'login--wide': isSetup }">
    <div class="login__brand">
      <BrandLogo :width="156" />
      <span class="login__area">Painel interno</span>
    </div>

    <div class="login__card">
      <p v-if="session.state.notice" class="notice notice--mint login__notice" role="status">
        <AppIcon name="info" />
        <span>{{ session.state.notice }}</span>
      </p>

      <!-- Etapa 1 -->
      <template v-if="step === 'anonymous'">
        <h1 ref="heading" tabindex="-1">Entrar no painel</h1>
        <p class="login__lead">Acesso individual e restrito à equipe da Minha Folga.</p>
        <form class="form" novalidate @submit.prevent="submitCredentials">
          <div class="field">
            <label class="field__label" for="admin-email">E-mail</label>
            <input
              id="admin-email"
              ref="emailInput"
              v-model="email"
              class="input"
              type="email"
              name="email"
              autocomplete="username"
              inputmode="email"
              maxlength="200"
              spellcheck="false"
              autocapitalize="off"
              :aria-invalid="credFields.email ? 'true' : undefined"
              :aria-describedby="credFields.email ? 'admin-email-erro' : undefined"
              required
            />
            <p v-if="credFields.email" id="admin-email-erro" class="field__error"><AppIcon name="alert" />{{ credFields.email }}</p>
          </div>
          <div class="field">
            <label class="field__label" for="admin-senha">Senha</label>
            <div class="login__password">
              <input
                id="admin-senha"
                ref="passwordInput"
                v-model="password"
                class="input"
                :type="showPassword ? 'text' : 'password'"
                name="password"
                autocomplete="current-password"
                maxlength="200"
                :aria-invalid="credFields.password ? 'true' : undefined"
                :aria-describedby="credFields.password ? 'admin-senha-erro' : undefined"
                required
              />
              <!-- Rótulo que alterna (sem aria-pressed): o nome diz a ação e o que ela afeta. -->
              <button
                type="button"
                class="btn btn--ghost btn--sm login__reveal"
                aria-controls="admin-senha"
                @click="showPassword = !showPassword"
              >
                <AppIcon name="eye" />
                {{ showPassword ? 'Ocultar' : 'Mostrar' }}<span class="visually-hidden"> senha</span>
              </button>
            </div>
            <p v-if="credFields.password" id="admin-senha-erro" class="field__error"><AppIcon name="alert" />{{ credFields.password }}</p>
          </div>
          <div v-if="credError" class="notice notice--error" role="alert">
            <AppIcon name="alert" />
            <p>{{ credError }}</p>
          </div>
          <button type="submit" class="btn btn--primary btn--block" :aria-disabled="credBusy ? 'true' : undefined">
            <span v-if="credBusy" class="spinner" aria-hidden="true" />
            {{ credBusy ? 'Verificando…' : 'Continuar' }}
          </button>
        </form>
        <p class="login__help">
          Esqueceu a senha ou perdeu o acesso ao autenticador? Peça à administração do painel para redefinir o seu acesso.
        </p>
      </template>

      <!-- Primeiro acesso: cadastro do autenticador -->
      <template v-else-if="isSetup">
        <p class="login__step">Primeiro acesso · etapa 2 de 2</p>
        <h1 ref="heading" tabindex="-1">Cadastre o autenticador</h1>
        <p class="login__lead">O painel exige um segundo fator. Você vai usar um código de 6 números gerado no seu celular a cada entrada.</p>

        <div v-if="setupLoading" class="admin-state admin-state--loading" role="status">
          <span class="spinner" aria-hidden="true" />
          <span>Gerando o QR code…</span>
        </div>
        <div v-else-if="setupError" class="notice notice--error" role="alert">
          <AppIcon name="alert" />
          <div>
            <p>{{ setupError }}</p>
            <button type="button" class="btn btn--secondary btn--sm login__retry" @click="loadSetup">Tentar novamente</button>
          </div>
        </div>
        <ol v-else-if="setup" class="login__steps">
          <li>
            <strong>Abra um aplicativo autenticador no celular.</strong>
            Use o de sua preferência, desde que gere códigos temporários de 6 números (padrão TOTP).
          </li>
          <li>
            <strong>Adicione uma conta lendo o QR code.</strong>
            <div class="login__qr">
              <img v-if="qrUrl" :src="qrUrl" width="184" height="184" alt="QR code para adicionar o painel interno Minha Folga ao aplicativo autenticador" />
              <p v-else class="field__hint">O QR code não pôde ser exibido. Use a chave abaixo.</p>
              <div class="login__secret">
                <p class="field__hint">Sem câmera? Escolha “inserir chave” no aplicativo e digite:</p>
                <code class="admin-mono login__secret-code">{{ groupSecret(setup.secret) }}</code>
                <p class="field__hint">
                  Tipo: baseado em tempo<span v-if="otp.issuer"> · Emissor: {{ otp.issuer }}</span>
                </p>
                <button type="button" class="btn btn--secondary btn--sm" @click="copySecret">
                  <AppIcon v-if="secretCopied" name="check" />
                  {{ secretCopied ? 'Chave copiada' : 'Copiar chave' }}
                </button>
                <span class="visually-hidden" aria-live="polite">{{ secretCopied ? 'Chave copiada.' : '' }}</span>
              </div>
            </div>
          </li>
          <li>
            <strong>Digite o código que aparecer no aplicativo.</strong>
            Ele muda a cada {{ otp.period }} segundos; use o código atual.
          </li>
        </ol>
      </template>

      <!-- Etapa 2: código -->
      <template v-else-if="step === 'mfa_required'">
        <p class="login__step">Etapa 2 de 2</p>
        <h1 ref="heading" tabindex="-1">Confirme que é você</h1>
        <p class="login__lead">Abra o aplicativo autenticador e digite o código de 6 números do painel interno Minha Folga.</p>
      </template>

      <form v-if="isCode && (!isSetup || setup)" class="form login__code-form" novalidate @submit.prevent="submitCode">
        <div class="field">
          <label class="field__label" for="admin-codigo">Código do autenticador</label>
          <p id="admin-codigo-dica" class="field__hint">6 números, sem espaços.</p>
          <input
            id="admin-codigo"
            ref="codeInput"
            :value="code"
            class="input input--code"
            type="text"
            name="one-time-code"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]*"
            maxlength="6"
            :aria-invalid="codeFieldError ? 'true' : undefined"
            :aria-describedby="`admin-codigo-dica${codeFieldError ? ' admin-codigo-erro' : ''}`"
            required
            @input="onCodeInput"
          />
          <p v-if="codeFieldError" id="admin-codigo-erro" class="field__error"><AppIcon name="alert" />{{ codeFieldError }}</p>
        </div>
        <div v-if="codeError" class="notice notice--error" role="alert">
          <AppIcon name="alert" />
          <p>{{ codeError }}</p>
        </div>
        <button type="submit" class="btn btn--primary btn--block" :aria-disabled="codeBusy ? 'true' : undefined">
          <span v-if="codeBusy" class="spinner" aria-hidden="true" />
          {{ codeBusy ? 'Confirmando…' : isSetup ? 'Ativar e entrar' : 'Confirmar e entrar' }}
        </button>
      </form>

      <template v-if="isCode">
        <p v-if="isSetup" class="login__help">
          Guarde bem o acesso ao aplicativo. Se trocar de celular ou perder o autenticador, a administração do painel precisará redefinir o seu MFA.
        </p>
        <button type="button" class="btn btn--ghost btn--sm login__switch" :aria-disabled="codeBusy ? 'true' : undefined" @click="useAnotherAccount">
          <AppIcon name="arrow-left" />
          Entrar com outra conta
        </button>
      </template>
    </div>

    <p class="login__foot">
      A equipe da Minha Folga nunca pede senha ou código por mensagem.
      <a href="/">Voltar ao site</a>
    </p>
  </div>
</template>

<style scoped>
.login {
  display: grid;
  gap: var(--mf-space-4);
  width: min(440px, 100%);
}

.login--wide {
  width: min(600px, 100%);
}

.login__brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.login__area {
  padding-left: 14px;
  border-left: 1px solid var(--mf-border);
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--mf-muted);
}

.login__card {
  display: grid;
  gap: var(--mf-space-3);
  padding: var(--mf-space-5);
  background: var(--mf-paper);
  border: 1px solid var(--mf-border);
  border-radius: 24px;
  box-shadow: var(--mf-shadow-soft);
}

@media (max-width: 480px) {
  .login__card {
    padding: var(--mf-space-4) 20px;
  }
}

.login__card h1 {
  margin: 0;
  font-size: clamp(26px, 2vw + 16px, 32px);
}

.login__card h1:focus {
  outline: none;
}

.login__lead {
  margin: -4px 0 var(--mf-space-2);
  color: var(--mf-muted);
  font-size: 0.9375rem;
}

.login__step {
  margin: 0 0 -8px;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.login__notice {
  align-items: center;
}

.login__password {
  position: relative;
}

.login__password .input {
  padding-right: 112px;
}

.login__reveal {
  position: absolute;
  top: 0;
  right: 4px;
  gap: 6px;
  font-size: 0.875rem;
}

.login__reveal .icon {
  width: 18px;
  height: 18px;
}

.login__help,
.login__foot {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--mf-muted);
}

.login__foot a {
  font-weight: 600;
}

.login__card .login__switch {
  justify-self: start;
  padding-inline: 0;
}

.login__retry {
  margin-top: 10px;
}

.login__code-form .input--code {
  max-width: 100%;
}

.login__steps {
  display: grid;
  gap: var(--mf-space-3);
  margin: 0;
  padding-left: 1.4em;
  font-size: 0.9375rem;
}

.login__steps li {
  margin: 0;
  padding-left: 4px;
}

.login__steps li::marker {
  font-weight: 700;
  color: var(--mf-forest);
}

.login__steps strong {
  display: block;
  margin-bottom: 2px;
}

.login__qr {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mf-space-3);
  align-items: flex-start;
  margin-top: var(--mf-space-2);
}

.login__qr img {
  flex: none;
  padding: 8px;
  background: #fff;
  border: 1px solid var(--mf-border);
  border-radius: 12px;
}

.login__secret {
  display: grid;
  gap: 8px;
  justify-items: start;
  flex: 1 1 200px;
  min-width: 0;
}

.login__secret p {
  margin: 0;
}

.login__secret-code {
  display: block;
  max-width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--mf-cream);
  border: 1px solid var(--mf-border);
  font-size: 1rem;
  font-weight: 600;
  word-spacing: 0.2em;
}
</style>
