<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, useId, watch } from 'vue'
import { useRoute } from 'vue-router'
import copy from '@content/pages/formularios.yaml'
import validation from '@contracts/validation.json'
import AppIcon from '@/components/ui/AppIcon.vue'
import RichText from '@/components/content/RichText.vue'
import { fetchCollectionStatus } from '@/composables/useCollectionStatus'
import { maskPhoneInput, normalizeBrazilianMobile } from '@/lib/phone'
import { trackOnce } from '@/services/analytics'
import { api, ApiError, NETWORK_ERROR_MESSAGE } from '@/services/api'
import { publicConfig } from '@/services/site'
import { errorMessage, fill, focusAndReveal, isValidEmail, stripCountryPrefix, trackingPath } from './form-helpers'
import type { SupportCreated, SupportStage } from './api-types'

/**
 * Formulário de atendimento (seção 6.14): persiste a solicitação e mostra o protocolo e o link seguro
 * de acompanhamento, que aparece uma única vez. Sem anexos nesta fase e sem adesão a marketing.
 * Medição (seção 10): `support_form_start`, sem dimensão, uma vez, no primeiro foco ou interação com o
 * formulário (só sai com medição habilitada e consentimento; nunca leva o que foi digitado).
 */
const props = withDefaults(defineProps<{ headingLevel?: 2 | 3 | 4 }>(), { headingLevel: 3 })
// Etapa exibida (formulário, sucesso ou aviso), para a página ajustar o texto ao redor.
const emit = defineEmits<{ stage: [value: SupportStage] }>()

type Field = 'name' | 'contactMethod' | 'contact' | 'subject' | 'message'
type Method = 'email' | 'whatsapp'
const ORDER: Field[] = ['name', 'contactMethod', 'contact', 'subject', 'message']

const t = copy.support
const common = copy.common
const rules = validation.support
const route = useRoute()
const uid = useId()
const id = (name: string) => `${uid}-${name}`

// WhatsApp como meio de retorno só existe com número oficial configurado.
const methods = (rules.contactMethods as { value: Method; label: string; requires: string | null }[]).filter(
  (m) => m.requires === null || (m.requires === 'whatsapp_channel' && Boolean(publicConfig.channels.whatsappNumber)),
)
const subjects = rules.subjects as { value: string; label: string }[]
const hours = publicConfig.identity.supportHours
const responseTime = publicConfig.identity.supportResponseTime

const form = reactive({ name: '', contactMethod: 'email' as Method, email: '', whatsapp: '', subject: '', message: '' })
const touched = reactive<Record<Field, boolean>>({ name: false, contactMethod: false, contact: false, subject: false, message: false })
const serverErrors = reactive<Partial<Record<Field, string>>>({})
const submitted = ref(false)
const submitting = ref(false)
const generalError = ref('')
const status = ref('')
const limitAnnouncement = ref('')
const created = ref<{ protocol: string; link: string; method: Method } | null>(null)
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const unavailable = ref(!publicConfig.collection.supportEnabled)

const nameInput = ref<HTMLInputElement | null>(null)
const methodInputs = ref<HTMLInputElement[]>([])
const contactInput = ref<HTMLInputElement | null>(null)
const subjectInput = ref<HTMLSelectElement | null>(null)
const messageInput = ref<HTMLTextAreaElement | null>(null)
const generalErrorEl = ref<HTMLElement | null>(null)
const successHeading = ref<HTMLElement | null>(null)
const unavailableHeading = ref<HTMLElement | null>(null)
const linkInput = ref<HTMLInputElement | null>(null)

const stage = computed<SupportStage>(() => (unavailable.value ? 'unavailable' : created.value ? 'success' : 'form'))
watch(stage, (value) => emit('stage', value))

const contactValue = computed(() => (form.contactMethod === 'email' ? form.email : form.whatsapp))
const contactCopy = computed(() => (form.contactMethod === 'email' ? t.email : t.whatsapp))
const messageLength = computed(() => form.message.length)

function validateField(field: Field): string | null {
  switch (field) {
    case 'name': {
      const v = form.name.trim()
      if (!v) return t.name.required
      return v.length > rules.nameMax ? t.name.tooLong : null
    }
    case 'contactMethod':
      return methods.some((m) => m.value === form.contactMethod) ? null : t.method.required
    case 'contact':
      if (form.contactMethod === 'email') {
        if (!form.email.trim()) return t.email.required
        return isValidEmail(form.email) ? null : t.email.invalid
      }
      if (!form.whatsapp.trim()) return t.whatsapp.required
      return normalizeBrazilianMobile(form.whatsapp) ? null : t.whatsapp.invalid
    case 'subject':
      return subjects.some((s) => s.value === form.subject) ? null : t.subject.required
    case 'message': {
      const v = form.message.trim()
      if (!v) return t.message.required
      if (v.length < rules.messageMin) return t.message.tooShort
      return form.message.length > rules.messageMax ? t.message.tooLong : null
    }
  }
}

const shown = computed(() => {
  const out: Partial<Record<Field, string>> = {}
  for (const field of ORDER) {
    const message = serverErrors[field] ?? (touched[field] || submitted.value ? validateField(field) : null)
    if (message) out[field] = message
  }
  return out
})

watch(() => form.name, () => delete serverErrors.name)
watch(() => form.subject, () => delete serverErrors.subject)
watch(() => form.message, () => delete serverErrors.message)
watch([() => form.email, () => form.whatsapp], () => delete serverErrors.contact)
watch(
  () => form.contactMethod,
  () => {
    delete serverErrors.contactMethod
    delete serverErrors.contact
    // O erro do novo tipo de contato só aparece depois de sair do campo.
    touched.contact = false
  },
)

// Anuncia (sem ruído a cada tecla) quando a mensagem se aproxima do limite.
let lastBucket = 0
watch(messageLength, (len) => {
  const left = rules.messageMax - len
  const bucket = left <= 0 ? 3 : left <= 50 ? 2 : left <= 200 ? 1 : 0
  if (bucket > lastBucket) limitAnnouncement.value = fill(t.message.nearLimit, { n: Math.max(0, left) })
  lastBucket = bucket
})

function describedBy(field: Field, extra: string[] = []): string | undefined {
  const parts = [...extra, shown.value[field] ? id(`${field}-erro`) : ''].filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

function onWhatsappInput(event: Event) {
  const el = event.target as HTMLInputElement
  form.whatsapp = maskPhoneInput(stripCountryPrefix(el.value))
  el.value = form.whatsapp
}

function focusTarget(field: Field): HTMLElement | null {
  switch (field) {
    case 'name':
      return nameInput.value
    case 'contactMethod':
      return methodInputs.value.find((el) => el.checked) ?? methodInputs.value[0] ?? contactInput.value
    case 'contact':
      return contactInput.value
    case 'subject':
      return subjectInput.value
    case 'message':
      return messageInput.value
  }
}

async function focusFirstInvalid() {
  await nextTick()
  const first = ORDER.find((f) => shown.value[f])
  if (first) focusAndReveal(focusTarget(first))
}

function mapServerFields(fields: Record<string, string>): boolean {
  let mapped = false
  for (const [key, message] of Object.entries(fields)) {
    if ((ORDER as string[]).includes(key)) {
      serverErrors[key as Field] = message
      mapped = true
    }
  }
  return mapped
}

/** Início do atendimento (medição agregada): uma vez por página, sem nenhum dado do formulário. */
let started = false
function markStarted() {
  if (started) return
  started = true
  trackOnce('support_form_start')
}

/** Troca o formulário pelo aviso. O foco só é movido quando a troca vem de uma ação da pessoa. */
async function showUnavailable(moveFocus = true) {
  unavailable.value = true
  if (!moveFocus) return
  await nextTick()
  unavailableHeading.value?.focus()
}

async function submit() {
  if (submitting.value) return
  submitted.value = true
  generalError.value = ''
  if (ORDER.some((f) => validateField(f))) {
    status.value = common.checkFields
    await focusFirstInvalid()
    return
  }
  submitting.value = true
  status.value = common.submitting
  const method = form.contactMethod
  try {
    const res = await api<SupportCreated>('/support', {
      method: 'POST',
      body: {
        name: form.name.trim(),
        contactMethod: method,
        contact: method === 'email' ? form.email.trim() : normalizeBrazilianMobile(form.whatsapp),
        subject: form.subject,
        message: form.message.trim(),
      },
    })
    const link = `${window.location.origin}${trackingPath({ protocol: res.protocol, token: res.trackingToken })}`
    created.value = { protocol: res.protocol, link, method }
    status.value = ''
    copyState.value = 'idle'
    await nextTick()
    focusAndReveal(successHeading.value)
  } catch (e) {
    status.value = ''
    await handleError(e)
  } finally {
    submitting.value = false
  }
}

async function handleError(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === 'support_unavailable') return showUnavailable()
    if (e.code === 'validation_error' && mapServerFields(e.fields)) {
      status.value = common.checkFields
      return focusFirstInvalid()
    }
    generalError.value =
      e.code === 'rate_limited' ? common.rateLimited : e.code === 'validation_error' ? NETWORK_ERROR_MESSAGE : errorMessage(e)
  } else {
    generalError.value = errorMessage(e)
  }
  await nextTick()
  generalErrorEl.value?.focus()
}

async function copyLink() {
  const link = created.value?.link
  if (!link) return
  try {
    await navigator.clipboard.writeText(link)
    copyState.value = 'copied'
  } catch {
    // Sem permissão de área de transferência: seleciona o texto para cópia manual.
    linkInput.value?.focus()
    linkInput.value?.select()
    copyState.value = 'failed'
  }
}

function selectLink() {
  linkInput.value?.select()
}

async function startAnother() {
  created.value = null
  submitted.value = false
  form.subject = ''
  form.message = ''
  touched.subject = false
  touched.message = false
  await nextTick()
  focusAndReveal(subjectInput.value)
}

onMounted(async () => {
  // Pré-seleção do assunto por ?assunto=<valor> (somente valores do contrato), depois da hidratação.
  const wanted = route.query.assunto
  if (typeof wanted === 'string' && subjects.some((s) => s.value === wanted)) form.subject = wanted
  if (unavailable.value) return
  const collection = await fetchCollectionStatus()
  // Checagem ao carregar: sem mover o foco nem rolar a página.
  if (collection && collection.supportEnabled === false) await showUnavailable(false)
})

defineExpose({ focusFirst: () => nameInput.value?.focus() })
</script>

<template>
  <div class="support-form">
    <!-- Atendimento sem coleta: aviso verdadeiro, com os canais da própria página como alternativa. -->
    <section v-if="unavailable" class="support-form__closed" :aria-labelledby="id('indisponivel')">
      <component :is="`h${props.headingLevel}`" :id="id('indisponivel')" ref="unavailableHeading" class="support-form__title" tabindex="-1">
        {{ t.unavailable.title }}
      </component>
      <p>{{ t.unavailable.text }}</p>
      <div class="cluster">
        <RouterLink :to="t.unavailable.help.to" class="btn btn--secondary btn--sm">{{ t.unavailable.help.label }}</RouterLink>
        <RouterLink :to="t.unavailable.security.to" class="link-arrow">{{ t.unavailable.security.label }} <AppIcon name="arrow-right" /></RouterLink>
      </div>
    </section>

    <!-- Sucesso somente após 201 do servidor. -->
    <section v-else-if="created" class="support-form__success" :aria-labelledby="id('sucesso')">
      <div class="support-form__success-icon" aria-hidden="true"><AppIcon name="check-circle" /></div>
      <component :is="`h${props.headingLevel}`" :id="id('sucesso')" ref="successHeading" class="support-form__title" tabindex="-1">
        {{ t.success.title }}
      </component>

      <dl class="support-form__protocol">
        <dt>{{ t.success.protocolLabel }}</dt>
        <dd>{{ created.protocol }}</dd>
      </dl>

      <div class="field support-form__link">
        <label :for="id('link')" class="field__label">{{ t.success.linkLabel }}</label>
        <p :id="id('link-dica')" class="field__hint">{{ t.success.linkHint }}</p>
        <div class="support-form__link-row">
          <input
            :id="id('link')"
            ref="linkInput"
            class="input support-form__link-input"
            type="text"
            readonly
            :value="created.link"
            :aria-describedby="id('link-dica')"
            spellcheck="false"
            @focus="selectLink"
          />
          <button type="button" class="btn btn--primary" @click="copyLink">
            <AppIcon v-if="copyState === 'copied'" name="check" />
            {{ copyState === 'copied' ? t.success.copied : t.success.copy }}
          </button>
        </div>
        <p class="small support-form__copy-status" role="status" aria-live="polite">
          <template v-if="copyState === 'copied'">{{ t.success.copied }}</template>
          <template v-else-if="copyState === 'failed'">{{ t.success.copyFailed }}</template>
        </p>
      </div>

      <component :is="`h${Math.min(props.headingLevel + 1, 6)}`" class="support-form__next-title">{{ t.success.nextTitle }}</component>
      <ul class="support-form__next">
        <li>{{ created.method === 'email' ? t.success.replyByEmail : t.success.replyByWhatsapp }}</li>
        <li v-if="hours">{{ fill(t.success.hours, { hours }) }}</li>
        <li v-if="responseTime">{{ fill(t.success.responseTime, { time: responseTime }) }}</li>
        <li>{{ t.success.keepPrivate }}</li>
      </ul>

      <div class="cluster support-form__success-actions">
        <a :href="created.link" class="btn btn--secondary btn--sm" target="_blank" rel="noopener">
          {{ t.success.open }}<span class="visually-hidden"> {{ t.success.newTab }}</span>
          <AppIcon name="external" />
        </a>
        <button type="button" class="btn btn--ghost" :aria-describedby="id('outra-dica')" @click="startAnother">{{ t.success.another }}</button>
      </div>
      <p :id="id('outra-dica')" class="legal-text">{{ t.success.anotherHint }}</p>
    </section>

    <form v-else class="form" novalidate @submit.prevent="submit" @focusin="markStarted" @input="markStarted" @change="markStarted">
      <p class="small muted support-form__required">{{ t.requiredNote }}</p>

      <div class="field">
        <label :for="id('name')" class="field__label">{{ t.name.label }}</label>
        <p :id="id('name-dica')" class="field__hint">{{ t.name.hint }}</p>
        <input
          :id="id('name')"
          ref="nameInput"
          v-model="form.name"
          class="input"
          type="text"
          name="name"
          autocomplete="name"
          :maxlength="rules.nameMax"
          required
          :aria-invalid="shown.name ? 'true' : 'false'"
          :aria-describedby="describedBy('name', [id('name-dica')])"
          @blur="touched.name = true"
        />
        <p v-if="shown.name" :id="id('name-erro')" class="field__error"><AppIcon name="alert" /><span>{{ shown.name }}</span></p>
      </div>

      <fieldset v-if="methods.length > 1" class="choice-group" :aria-describedby="describedBy('contactMethod')">
        <legend class="field__label">{{ t.method.legend }}</legend>
        <div class="support-form__methods">
          <label v-for="m in methods" :key="m.value" class="choice">
            <input ref="methodInputs" v-model="form.contactMethod" type="radio" :name="id('contactMethod')" :value="m.value" required />
            <span>{{ m.label }}</span>
          </label>
        </div>
        <p v-if="shown.contactMethod" :id="id('contactMethod-erro')" class="field__error">
          <AppIcon name="alert" /><span>{{ shown.contactMethod }}</span>
        </p>
      </fieldset>
      <p v-else class="support-form__method-note small">
        <AppIcon name="mail" />
        <span>{{ t.method.emailOnly }}</span>
      </p>

      <div class="field">
        <label :for="id('contact')" class="field__label">{{ contactCopy.label }}</label>
        <p :id="id('contact-dica')" class="field__hint">{{ contactCopy.hint }}</p>
        <input
          v-if="form.contactMethod === 'email'"
          :id="id('contact')"
          ref="contactInput"
          v-model="form.email"
          class="input"
          type="email"
          name="email"
          inputmode="email"
          autocomplete="email"
          spellcheck="false"
          :maxlength="rules.contactMax"
          required
          :aria-invalid="shown.contact ? 'true' : 'false'"
          :aria-describedby="describedBy('contact', [id('contact-dica')])"
          @blur="touched.contact = true"
        />
        <input
          v-else
          :id="id('contact')"
          ref="contactInput"
          :value="form.whatsapp"
          class="input support-form__phone"
          type="tel"
          name="whatsapp"
          inputmode="tel"
          autocomplete="tel-national"
          maxlength="16"
          required
          :aria-invalid="shown.contact ? 'true' : 'false'"
          :aria-describedby="describedBy('contact', [id('contact-dica')])"
          @input="onWhatsappInput"
          @blur="touched.contact = true"
        />
        <p v-if="shown.contact" :id="id('contact-erro')" class="field__error"><AppIcon name="alert" /><span>{{ shown.contact }}</span></p>
      </div>

      <div class="field">
        <label :for="id('subject')" class="field__label">{{ t.subject.label }}</label>
        <select
          :id="id('subject')"
          ref="subjectInput"
          v-model="form.subject"
          class="select"
          name="subject"
          required
          :aria-invalid="shown.subject ? 'true' : 'false'"
          :aria-describedby="describedBy('subject')"
          @blur="touched.subject = true"
        >
          <option value="" disabled>{{ t.subject.placeholder }}</option>
          <option v-for="s in subjects" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
        <p v-if="shown.subject" :id="id('subject-erro')" class="field__error"><AppIcon name="alert" /><span>{{ shown.subject }}</span></p>
      </div>

      <div class="field">
        <label :for="id('message')" class="field__label">{{ t.message.label }}</label>
        <p :id="id('message-dica')" class="field__hint">{{ t.message.hint }}</p>
        <div :id="id('safety')" class="notice notice--pending support-form__safety">
          <AppIcon name="shield" />
          <p>
            <strong>{{ t.safety }}</strong>
          </p>
        </div>
        <textarea
          :id="id('message')"
          ref="messageInput"
          v-model="form.message"
          class="textarea"
          name="message"
          rows="6"
          :maxlength="rules.messageMax"
          required
          :aria-invalid="shown.message ? 'true' : 'false'"
          :aria-describedby="describedBy('message', [id('message-dica'), id('safety'), id('contador')])"
          @blur="touched.message = true"
        />
        <div class="support-form__message-foot">
          <p v-if="shown.message" :id="id('message-erro')" class="field__error"><AppIcon name="alert" /><span>{{ shown.message }}</span></p>
          <p :id="id('contador')" class="char-count">{{ fill(t.message.counter, { n: messageLength, max: rules.messageMax }) }}</p>
        </div>
        <p class="visually-hidden" aria-live="polite">{{ limitAnnouncement }}</p>
      </div>

      <!-- Anexos desativados nesta fase: controle visível e desabilitado, com o motivo ao lado. -->
      <div class="field">
        <p :id="id('anexos')" class="field__label support-form__attach-label">{{ t.attachments.label }}</p>
        <div class="support-form__attach">
          <button
            type="button"
            class="btn btn--sm"
            disabled
            :aria-labelledby="`${id('anexos')} ${id('anexos-acao')}`"
            :aria-describedby="id('anexos-dica')"
          >
            <span :id="id('anexos-acao')">{{ t.attachments.button }}</span>
          </button>
          <p :id="id('anexos-dica')" class="small support-form__attach-hint">{{ t.attachments.hint }}</p>
        </div>
      </div>

      <div class="form-actions">
        <div v-if="generalError" ref="generalErrorEl" class="notice notice--error" role="alert" tabindex="-1">
          <AppIcon name="alert" />
          <p>{{ generalError }}</p>
        </div>
        <RichText :html="t.privacy_mdi" tag="p" class="legal-text support-form__privacy" />
        <button type="submit" class="btn btn--primary support-form__submit" :aria-disabled="submitting ? 'true' : 'false'">
          <span v-if="submitting" class="spinner" aria-hidden="true" />
          {{ submitting ? common.submitting : t.submit }}
        </button>
      </div>

      <p class="visually-hidden" role="status" aria-live="polite">{{ status }}</p>
    </form>
  </div>
</template>

<style scoped>
.support-form__required,
.support-form__privacy {
  margin: 0;
}

.support-form__title {
  margin-bottom: var(--mf-space-3);
  font-size: clamp(1.375rem, 1vw + 1rem, 1.75rem);
}

.support-form__title:focus {
  outline: none;
}

.support-form__title:focus-visible {
  outline: 3px solid var(--mf-focus);
}

.support-form__methods {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.support-form__method-note {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--mf-radius-control);
  background: var(--mf-cream);
}

.support-form__method-note .icon {
  flex: none;
  width: 20px;
  height: 20px;
  color: var(--mf-forest);
}

.support-form__phone {
  max-width: 320px;
}

.support-form__safety {
  padding: 10px 14px;
}

.support-form__message-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  justify-content: space-between;
  align-items: flex-start;
}

.support-form__message-foot .char-count {
  margin: 0 0 0 auto;
}

.support-form__attach-label {
  margin: 0;
}

.support-form__attach {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  padding: 12px 14px;
  border: 1.5px dashed var(--mf-border);
  border-radius: var(--mf-radius-control);
  background: #f3f5f4;
}

.support-form__attach .btn {
  flex: none;
}

.support-form__attach-hint {
  flex: 1 1 220px;
  margin: 0;
  color: #3f4d47;
}

.support-form__submit {
  justify-self: start;
  min-width: 220px;
}

.notice:focus {
  outline: 3px solid var(--mf-focus);
  outline-offset: 2px;
}

/* Sucesso ---------------------------------------------------------------------------------------- */
.support-form__success-icon {
  display: inline-grid;
  place-items: center;
  width: 52px;
  height: 52px;
  margin-bottom: var(--mf-space-3);
  border-radius: 50%;
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.support-form__success-icon .icon {
  width: 28px;
  height: 28px;
}

.support-form__protocol {
  display: inline-grid;
  gap: 2px;
  margin: 0 0 var(--mf-space-4);
  padding: 14px 20px;
  border-radius: 16px;
  background: var(--mf-cream);
  border: 1px solid var(--mf-border);
}

.support-form__protocol dt {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--mf-muted);
}

.support-form__protocol dd {
  margin: 0;
  font-family: var(--mf-font-heading);
  font-size: clamp(1.25rem, 1.2vw + 1rem, 1.625rem);
  font-weight: 600;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--mf-forest);
  overflow-wrap: anywhere;
}

.support-form__link-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.support-form__link-input {
  flex: 1 1 280px;
  min-width: 0;
  font-size: 0.9375rem;
  font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
}

.support-form__copy-status {
  min-height: 1.5em;
  margin: 0;
  color: var(--mf-forest);
  font-weight: 600;
}

.support-form__next-title {
  margin: var(--mf-space-2) 0 var(--mf-space-2);
}

.support-form__next {
  margin-bottom: var(--mf-space-4);
}

.support-form__success-actions {
  margin-bottom: 8px;
}

@media (max-width: 479px) {
  .support-form__methods {
    grid-template-columns: minmax(0, 1fr);
  }
  .support-form__submit,
  .support-form__link-row .btn {
    width: 100%;
  }
}
</style>
