<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, useId, watch } from 'vue'
import { useRouter } from 'vue-router'
import copy from '@content/pages/formularios.yaml'
import consents from '@contracts/consents.json'
import validation from '@contracts/validation.json'
import AppIcon from '@/components/ui/AppIcon.vue'
import RichText from '@/components/content/RichText.vue'
import AntiBotTrap from '@/components/forms/AntiBotTrap.vue'
import WaitlistUnavailable from '@/components/forms/WaitlistUnavailable.vue'
import { fetchCollectionStatus } from '@/composables/useCollectionStatus'
import { useFormProof, type AntiBotProof } from '@/composables/useFormProof'
import { captureUtm, readUtm } from '@/composables/useUtm'
import { isValidCpf, maskCpfInput } from '@/lib/cpf'
import { maskPhoneInput, normalizeBrazilianMobile } from '@/lib/phone'
import { trackOnce } from '@/services/analytics'
import { api, ApiError, NETWORK_ERROR_MESSAGE } from '@/services/api'
import { publicConfig } from '@/services/site'
import {
  collapseSpaces,
  errorMessage,
  focusAndReveal,
  isValidEmail,
  looksLikeCity,
  looksLikeEmployer,
  looksLikeFullName,
  stripCountryPrefix,
} from './form-helpers'
import type {
  EmploymentType,
  IncomeRange,
  InterestTopic,
  JobTenure,
  SignupConfirmedState,
  WaitlistReceived,
  WaitlistRequest,
} from './api-types'

/**
 * Cadastro de interesse na lista de aviso (decisão D1, docs/DECISOES.md): nome completo, CPF,
 * WhatsApp, e-mail opcional, empregador, faixas de vínculo, tempo no emprego e salário líquido,
 * cidade/UF, 18+ e consentimentos (textos exatos de contracts/consents.json). Sem confirmação por
 * código: o telefone fica "não validado" até a própria pessoa falar com a Bia no WhatsApp.
 *
 * Anti-robô: prova de trabalho num Web Worker a partir do primeiro foco (useFormProof), token de uso
 * único e campo-armadilha `website`. Se o servidor responder `form_expired`, pega outro token e
 * reenvia UMA vez, sem perder o que foi digitado. Sucesso só depois do 201 do servidor; os dados
 * ficam só na memória da página (nada no dispositivo, nada na URL).
 * Medição (seção 10): `waitlist_start` com a origem do cadastro, uma vez, no primeiro foco ou
 * interação (só com medição habilitada e consentimento; nunca leva o que foi digitado).
 */
const props = withDefaults(defineProps<{ source: string; headingLevel?: 2 | 3 | 4 }>(), { headingLevel: 3 })

type Field =
  | 'fullName'
  | 'cpf'
  | 'phone'
  | 'email'
  | 'employerName'
  | 'employmentType'
  | 'jobTenure'
  | 'incomeRange'
  | 'city'
  | 'uf'
  | 'ageConfirmed'
  | 'launchNotice'
const ORDER: Field[] = [
  'fullName',
  'cpf',
  'phone',
  'email',
  'employerName',
  'employmentType',
  'jobTenure',
  'incomeRange',
  'city',
  'uf',
  'ageConfirmed',
  'launchNotice',
]
/** Campos enviados com o mesmo nome no corpo da API (erros do servidor chegam por esse nome). */
const BODY_FIELDS: Field[] = ['fullName', 'cpf', 'phone', 'email', 'employerName', 'employmentType', 'jobTenure', 'incomeRange', 'city', 'uf', 'ageConfirmed']

const t = copy.waitlist
const common = copy.common
const purposes = consents.purposes
const rules = validation.waitlist
const employmentOptions = rules.employmentTypes as { value: EmploymentType; label: string }[]
const tenureOptions = rules.jobTenureRanges as { value: JobTenure; label: string }[]
const incomeOptions = rules.incomeRanges as { value: IncomeRange; label: string }[]
const topicOptions = rules.interestTopics as { value: InterestTopic; label: string }[]
const ufOptions = rules.ufs as string[]
const router = useRouter()
const antiBot = useFormProof()

const uid = useId()
const id = (name: string) => `${uid}-${name}`

const form = reactive({
  fullName: '',
  cpf: '',
  phone: '',
  email: '',
  employerName: '',
  employmentType: '' as EmploymentType | '',
  jobTenure: '' as JobTenure | '',
  incomeRange: '' as IncomeRange | '',
  city: '',
  uf: '',
  interestTopic: '' as InterestTopic | '',
  ageConfirmed: false,
  launchNotice: false,
  marketing: false,
  website: '',
})
const touched = reactive<Record<Field, boolean>>(Object.fromEntries(ORDER.map((f) => [f, false])) as Record<Field, boolean>)
const serverErrors = reactive<Partial<Record<Field, string>>>({})
const step = ref<1 | 2>(1)
const FIRST_FIELDS: Field[] = ['fullName', 'cpf', 'phone', 'email']
const submitted = ref(false)
const submitting = ref(false)
const generalError = ref('')
const needsReload = ref(false)
const status = ref('')
// Estado inicial vem da configuração do build (igual no servidor e no cliente).
const unavailable = ref(!publicConfig.collection.waitlistEnabled)

const nameInput = ref<HTMLInputElement | null>(null)
const cpfInput = ref<HTMLInputElement | null>(null)
const phoneInput = ref<HTMLInputElement | null>(null)
const emailInput = ref<HTMLInputElement | null>(null)
const employerInput = ref<HTMLInputElement | null>(null)
const employmentSelect = ref<HTMLSelectElement | null>(null)
const tenureSelect = ref<HTMLSelectElement | null>(null)
const incomeSelect = ref<HTMLSelectElement | null>(null)
const cityInput = ref<HTMLInputElement | null>(null)
const ufSelect = ref<HTMLSelectElement | null>(null)
const ageInput = ref<HTMLInputElement | null>(null)
const launchInput = ref<HTMLInputElement | null>(null)
const generalErrorEl = ref<HTMLElement | null>(null)
const unavailableRef = ref<InstanceType<typeof WaitlistUnavailable> | null>(null)

const inList = (options: { value: string }[], value: string) => options.some((o) => o.value === value)

function validateField(field: Field): string | null {
  switch (field) {
    case 'fullName': {
      const v = collapseSpaces(form.fullName)
      if (!v) return t.name.required
      // Mesma regra do servidor: o campo de nome não recebe CPF, telefone ou e-mail.
      const name = looksLikeFullName(v)
      if (!name.chars) return t.name.invalid
      if (v.length < rules.fullNameMin || !name.words) return t.name.tooShort
      return v.length > rules.fullNameMax ? t.name.tooLong : null
    }
    case 'cpf':
      if (!form.cpf.replace(/\D/g, '')) return t.cpf.required
      return isValidCpf(form.cpf) ? null : t.cpf.invalid
    case 'phone':
      if (!form.phone.trim()) return t.phone.required
      return normalizeBrazilianMobile(form.phone) ? null : t.phone.invalid
    case 'email': {
      const v = form.email.trim()
      if (!v) return null
      if (v.length > rules.emailMax) return t.email.tooLong
      return isValidEmail(v, rules.emailMax) ? null : t.email.invalid
    }
    case 'employerName': {
      const v = collapseSpaces(form.employerName)
      if (!v) return t.employer.required
      if (v.length < rules.employerNameMin) return t.employer.tooShort
      if (v.length > rules.employerNameMax) return t.employer.tooLong
      return looksLikeEmployer(v) ? null : t.employer.invalid
    }
    case 'employmentType':
      return inList(employmentOptions, form.employmentType) ? null : t.employment.required
    case 'jobTenure':
      return inList(tenureOptions, form.jobTenure) ? null : t.tenure.required
    case 'incomeRange':
      return inList(incomeOptions, form.incomeRange) ? null : t.income.required
    case 'city': {
      const v = collapseSpaces(form.city)
      if (v.length < 2) return t.city.required
      if (v.length > rules.cityMax) return t.city.tooLong
      return looksLikeCity(v) ? null : t.city.invalid
    }
    case 'uf':
      return ufOptions.includes(form.uf) ? null : t.uf.required
    case 'ageConfirmed':
      return form.ageConfirmed ? null : t.age.required
    case 'launchNotice':
      return form.launchNotice ? null : t.consents.required
  }
}

/** Erros visíveis: do servidor ou, no cliente, só depois de sair do campo ou tentar enviar. */
const shown = computed(() => {
  const out: Partial<Record<Field, string>> = {}
  for (const field of ORDER) {
    const message = serverErrors[field] ?? (touched[field] || submitted.value ? validateField(field) : null)
    if (message) out[field] = message
  }
  return out
})

// Ao alterar um campo, o erro devolvido pelo servidor para ele deixa de valer.
for (const field of ORDER) {
  watch(
    () => form[field],
    () => {
      delete serverErrors[field]
    },
  )
}

/** Dica(s) do campo + erro, na ordem em que aparecem na tela. */
function describedBy(field: Field, hints: string[] = [id(`${field}-dica`)]): string | undefined {
  const parts = [...hints, shown.value[field] ? id(`${field}-erro`) : ''].filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

function focusTarget(field: Field): HTMLElement | null {
  const map: Record<Field, HTMLElement | null> = {
    fullName: nameInput.value,
    cpf: cpfInput.value,
    phone: phoneInput.value,
    email: emailInput.value,
    employerName: employerInput.value,
    employmentType: employmentSelect.value,
    jobTenure: tenureSelect.value,
    incomeRange: incomeSelect.value,
    city: cityInput.value,
    uf: ufSelect.value,
    ageConfirmed: ageInput.value,
    launchNotice: launchInput.value,
  }
  return map[field]
}

function onPhoneInput(event: Event) {
  const el = event.target as HTMLInputElement
  form.phone = maskPhoneInput(stripCountryPrefix(el.value))
  el.value = form.phone
}

function onCpfInput(event: Event) {
  const el = event.target as HTMLInputElement
  form.cpf = maskCpfInput(el.value)
  el.value = form.cpf
}

function touch(field: Field) {
  touched[field] = true
}

/** Troca o formulário pelo aviso. O foco só é movido quando a troca vem de uma ação da pessoa. */
async function showUnavailable(moveFocus = true) {
  unavailable.value = true
  if (!moveFocus) return
  await nextTick()
  focusAndReveal(unavailableRef.value?.focus())
}

function fieldFromServerKey(key: string): Field | null {
  if ((BODY_FIELDS as string[]).includes(key)) return key as Field
  if (key === 'consents' || key === 'consents.launch_notice') return 'launchNotice'
  return null
}

/** Erro de campo que a pessoa não vê (token, prova, armadilha): tratado como prova recusada. */
const isAntiBotKey = (key: string) => key === 'antiBot' || key.startsWith('antiBot.') || key === 'website'

function mapServerFields(fields: Record<string, string>): boolean {
  let mapped = false
  for (const [key, message] of Object.entries(fields)) {
    const field = fieldFromServerKey(key)
    if (field) {
      serverErrors[field] = message
      mapped = true
    }
  }
  return mapped
}

/** Prova de trabalho ou token recusados: vale pegar outro token e reenviar uma vez. */
function proofRejected(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false
  if (e.code === 'form_expired') return true
  const keys = Object.keys(e.fields)
  return e.code === 'validation_error' && keys.length > 0 && keys.every(isAntiBotKey)
}

async function focusFirstInvalid() {
  const first = ORDER.find((f) => shown.value[f])
  if (!first) return
  step.value = FIRST_FIELDS.includes(first) ? 1 : 2
  await nextTick()
  focusAndReveal(focusTarget(first))
}

async function continueForm() {
  for (const field of FIRST_FIELDS) touched[field] = true
  if (FIRST_FIELDS.some((field) => validateField(field))) {
    trackOnce('waitlist_error', props.source)
    status.value = common.checkFields
    await focusFirstInvalid()
    return
  }
  step.value = 2
  status.value = t.steps.secondAnnouncement
  await nextTick()
  focusAndReveal(employerInput.value)
}

async function backToDetails() {
  if (submitting.value) return
  step.value = 1
  status.value = t.steps.firstAnnouncement
  await nextTick()
  focusAndReveal(nameInput.value)
}

/**
 * Primeiro foco ou interação: medição agregada (uma vez, sem dados do formulário) e início da
 * prova de trabalho, que normalmente fica pronta antes de a pessoa terminar de preencher.
 */
let started = false
function markStarted() {
  if (started) return
  started = true
  antiBot.prepare()
  trackOnce('waitlist_start', props.source)
}

function buildBody(proof: AntiBotProof): WaitlistRequest {
  const utm = readUtm()
  const email = form.email.trim()
  return {
    fullName: collapseSpaces(form.fullName),
    cpf: form.cpf.replace(/\D/g, ''),
    phone: normalizeBrazilianMobile(form.phone) ?? '',
    ...(email ? { email } : {}),
    employerName: collapseSpaces(form.employerName),
    employmentType: form.employmentType as EmploymentType,
    jobTenure: form.jobTenure as JobTenure,
    incomeRange: form.incomeRange as IncomeRange,
    city: collapseSpaces(form.city),
    uf: form.uf,
    ageConfirmed: true,
    ...(form.interestTopic ? { interestTopic: form.interestTopic } : {}),
    consents: { launch_notice: true, marketing: form.marketing },
    consentVersions: { launch_notice: purposes.launch_notice.version, marketing: purposes.marketing.version },
    source: props.source,
    ...(utm ? { utm } : {}),
    antiBot: proof,
    website: form.website,
  }
}

/** Um envio com uma prova nova (resolve no 201); erros sobem para quem chamou. */
async function sendOnce(): Promise<void> {
  const proof = await antiBot.take()
  try {
    const result = await api<WaitlistReceived>('/waitlist', { method: 'POST', body: buildBody(proof) })
    // Um 2xx vazio ou fora do contrato nunca pode produzir confirmação de cadastro.
    if (result?.status !== 'received') throw new ApiError(0, 'unexpected_response', NETWORK_ERROR_MESSAGE)
  } catch (e) {
    // Token de uso único: este já foi gasto; o próximo começa a ser preparado para a nova tentativa.
    antiBot.renew()
    throw e
  }
}

async function submit() {
  // Trava contra clique duplo: um único envio por vez.
  if (submitting.value) return
  if (step.value === 1) return continueForm()
  submitted.value = true
  generalError.value = ''
  needsReload.value = false
  if (ORDER.some((f) => validateField(f))) {
    trackOnce('waitlist_error', props.source)
    status.value = common.checkFields
    await focusFirstInvalid()
    return
  }

  submitting.value = true
  status.value = common.submitting
  try {
    try {
      await sendOnce()
    } catch (e) {
      // Prova recusada (token expirado, usado ou fora do tempo): uma única nova tentativa automática.
      if (!proofRejected(e)) throw e
      await sendOnce()
    }
    status.value = ''
    trackOnce('waitlist_confirmed', props.source)
    // Nenhum dado pessoal na URL: só a marca de recebimento e o aviso de vínculo "outro".
    const state: SignupConfirmedState = { mfSignupReceived: true, mfEmploymentOther: form.employmentType === 'outro' }
    await router.push({ path: '/cadastro-confirmado', state: { ...state } })
  } catch (e) {
    status.value = ''
    trackOnce('waitlist_error', props.source)
    await handleSubmitError(e)
  } finally {
    submitting.value = false
  }
}

async function handleSubmitError(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === 'collection_unavailable') return showUnavailable()
    if (e.code === 'consent_version_outdated') {
      needsReload.value = true
      generalError.value = t.consentOutdated
    } else if (proofRejected(e)) {
      generalError.value = t.formExpired
    } else if (e.code === 'validation_error' && mapServerFields(e.fields)) {
      status.value = common.checkFields
      return focusFirstInvalid()
    } else if (e.code === 'validation_error') {
      // Erro em campo que a pessoa não preenche (versão, origem, UTM): nada para destacar.
      generalError.value = NETWORK_ERROR_MESSAGE
    } else if (e.code === 'rate_limited') {
      generalError.value = common.rateLimited
    } else {
      generalError.value = errorMessage(e)
    }
  } else {
    generalError.value = errorMessage(e)
  }
  await nextTick()
  generalErrorEl.value?.focus()
}

function reloadPage() {
  window.location.reload()
}

onMounted(async () => {
  // Página de entrada com campanha: guarda as UTMs permitidas para acompanhar o cadastro.
  captureUtm()
  if (unavailable.value) return
  const collection = await fetchCollectionStatus()
  // Checagem ao carregar: sem mover o foco nem rolar a página.
  if (collection && collection.waitlistEnabled === false) await showUnavailable(false)
})

defineExpose({
  /**
   * Foco no primeiro ponto útil (campo de nome ou aviso de indisponibilidade), sem rolar a página:
   * devolve o elemento focado para quem chamou decidir como trazê-lo à área visível.
   */
  focusFirst(): HTMLElement | null {
    if (unavailable.value) return unavailableRef.value?.focus() ?? null
    const target = step.value === 1 ? nameInput.value : employerInput.value
    target?.focus({ preventScroll: true })
    return target
  },
})
</script>

<template>
  <div class="waitlist">
    <WaitlistUnavailable v-if="unavailable" ref="unavailableRef" :heading-level="headingLevel" />

    <form
      v-else
      class="form waitlist__form"
      novalidate
      @submit.prevent="submit"
      @focusin="markStarted"
      @input="markStarted"
      @change="markStarted"
    >
      <ol class="waitlist__progress" :aria-label="t.steps.label">
        <li :class="{ 'is-current': step === 1 }" :aria-current="step === 1 ? 'step' : undefined">
          <span aria-hidden="true">1</span>{{ t.steps.first }}
        </li>
        <li :class="{ 'is-current': step === 2 }" :aria-current="step === 2 ? 'step' : undefined">
          <span aria-hidden="true">2</span>{{ t.steps.second }}
        </li>
      </ol>
      <p class="small muted waitlist__required">{{ common.requiredNote }}</p>

      <!-- Seus dados ------------------------------------------------------------------------------ -->
      <fieldset :hidden="step !== 1" class="waitlist__group">
        <legend class="waitlist__group-title">{{ t.groups.person }}</legend>

        <div class="field">
          <label :for="id('fullName')" class="field__label">{{ t.name.label }}</label>
          <p :id="id('fullName-dica')" class="field__hint">{{ t.name.hint }}</p>
          <input
            :id="id('fullName')"
            ref="nameInput"
            v-model="form.fullName"
            class="input"
            type="text"
            name="fullName"
            autocomplete="name"
            :maxlength="rules.fullNameMax"
            required
            :aria-invalid="shown.fullName ? 'true' : 'false'"
            :aria-describedby="describedBy('fullName')"
            @blur="touch('fullName')"
          />
          <p v-if="shown.fullName" :id="id('fullName-erro')" class="field__error">
            <AppIcon name="alert" /><span>{{ shown.fullName }}</span>
          </p>
        </div>

        <div class="field">
          <label :for="id('cpf')" class="field__label">{{ t.cpf.label }}</label>
          <p :id="id('cpf-dica')" class="field__hint">{{ t.cpf.hint }}</p>
          <input
            :id="id('cpf')"
            ref="cpfInput"
            :value="form.cpf"
            class="input waitlist__short"
            type="text"
            name="cpf"
            inputmode="numeric"
            autocomplete="off"
            spellcheck="false"
            maxlength="14"
            required
            :aria-invalid="shown.cpf ? 'true' : 'false'"
            :aria-describedby="describedBy('cpf', [id('cpf-dica'), id('cpf-uso')])"
            @input="onCpfInput"
            @blur="touch('cpf')"
          />
          <p v-if="shown.cpf" :id="id('cpf-erro')" class="field__error"><AppIcon name="alert" /><span>{{ shown.cpf }}</span></p>
          <div :id="id('cpf-uso')" class="waitlist__why">
            <AppIcon name="shield" />
            <p><strong>{{ t.cpf.purposeTitle }}.</strong> {{ t.cpf.purpose }}</p>
          </div>
        </div>

        <div class="field">
          <label :for="id('phone')" class="field__label">{{ t.phone.label }}</label>
          <p :id="id('phone-dica')" class="field__hint">{{ t.phone.hint }}</p>
          <input
            :id="id('phone')"
            ref="phoneInput"
            :value="form.phone"
            class="input waitlist__short"
            type="tel"
            name="phone"
            inputmode="tel"
            autocomplete="tel-national"
            maxlength="16"
            required
            :aria-invalid="shown.phone ? 'true' : 'false'"
            :aria-describedby="describedBy('phone')"
            @input="onPhoneInput"
            @blur="touch('phone')"
          />
          <p v-if="shown.phone" :id="id('phone-erro')" class="field__error"><AppIcon name="alert" /><span>{{ shown.phone }}</span></p>
        </div>

        <div class="field">
          <label :for="id('email')" class="field__label">
            {{ t.email.label }} <span :id="id('email-tag')" class="waitlist__tag">{{ t.optionalTag }}</span>
          </label>
          <p :id="id('email-dica')" class="field__hint">{{ t.email.hint }}</p>
          <input
            :id="id('email')"
            ref="emailInput"
            v-model="form.email"
            class="input"
            type="email"
            name="email"
            inputmode="email"
            autocomplete="email"
            spellcheck="false"
            :maxlength="rules.emailMax"
            :aria-invalid="shown.email ? 'true' : 'false'"
            :aria-describedby="describedBy('email')"
            @blur="touch('email')"
          />
          <p v-if="shown.email" :id="id('email-erro')" class="field__error"><AppIcon name="alert" /><span>{{ shown.email }}</span></p>
        </div>
      </fieldset>

      <div :hidden="step !== 2" class="waitlist__step">
      <!-- Trabalho e renda ------------------------------------------------------------------------- -->
      <fieldset class="waitlist__group" :aria-describedby="id('trabalho-dica')">
        <legend class="waitlist__group-title">{{ t.groups.work }}</legend>
        <p :id="id('trabalho-dica')" class="field__hint waitlist__group-hint">{{ t.groups.workHint }}</p>

        <div class="field">
          <label :for="id('employerName')" class="field__label">{{ t.employer.label }}</label>
          <p :id="id('employerName-dica')" class="field__hint">{{ t.employer.hint }}</p>
          <input
            :id="id('employerName')"
            ref="employerInput"
            v-model="form.employerName"
            class="input"
            type="text"
            name="employerName"
            autocomplete="organization"
            :maxlength="rules.employerNameMax"
            required
            :aria-invalid="shown.employerName ? 'true' : 'false'"
            :aria-describedby="describedBy('employerName')"
            @blur="touch('employerName')"
          />
          <p v-if="shown.employerName" :id="id('employerName-erro')" class="field__error">
            <AppIcon name="alert" /><span>{{ shown.employerName }}</span>
          </p>
        </div>

        <div class="field">
          <label :for="id('employmentType')" class="field__label">{{ t.employment.label }}</label>
          <select
            :id="id('employmentType')"
            ref="employmentSelect"
            v-model="form.employmentType"
            class="select"
            name="employmentType"
            required
            :aria-invalid="shown.employmentType ? 'true' : 'false'"
            :aria-describedby="describedBy('employmentType', [])"
            @blur="touch('employmentType')"
            @change="touch('employmentType')"
          >
            <option value="" disabled>{{ t.employment.placeholder }}</option>
            <option v-for="o in employmentOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <p v-if="shown.employmentType" :id="id('employmentType-erro')" class="field__error">
            <AppIcon name="alert" /><span>{{ shown.employmentType }}</span>
          </p>
        </div>

        <div class="field">
          <label :for="id('jobTenure')" class="field__label">{{ t.tenure.label }}</label>
          <select
            :id="id('jobTenure')"
            ref="tenureSelect"
            v-model="form.jobTenure"
            class="select"
            name="jobTenure"
            required
            :aria-invalid="shown.jobTenure ? 'true' : 'false'"
            :aria-describedby="describedBy('jobTenure', [])"
            @blur="touch('jobTenure')"
            @change="touch('jobTenure')"
          >
            <option value="" disabled>{{ t.tenure.placeholder }}</option>
            <option v-for="o in tenureOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <p v-if="shown.jobTenure" :id="id('jobTenure-erro')" class="field__error">
            <AppIcon name="alert" /><span>{{ shown.jobTenure }}</span>
          </p>
        </div>

        <div class="field">
          <label :for="id('incomeRange')" class="field__label">{{ t.income.label }}</label>
          <p :id="id('incomeRange-dica')" class="field__hint">{{ t.income.hint }}</p>
          <select
            :id="id('incomeRange')"
            ref="incomeSelect"
            v-model="form.incomeRange"
            class="select"
            name="incomeRange"
            required
            :aria-invalid="shown.incomeRange ? 'true' : 'false'"
            :aria-describedby="describedBy('incomeRange')"
            @blur="touch('incomeRange')"
            @change="touch('incomeRange')"
          >
            <option value="" disabled>{{ t.income.placeholder }}</option>
            <option v-for="o in incomeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <p v-if="shown.incomeRange" :id="id('incomeRange-erro')" class="field__error">
            <AppIcon name="alert" /><span>{{ shown.incomeRange }}</span>
          </p>
        </div>
      </fieldset>

      <!-- Onde você mora ------------------------------------------------------------------------- -->
      <fieldset class="waitlist__group">
        <legend class="waitlist__group-title">{{ t.groups.place }}</legend>
        <div class="waitlist__row">
          <div class="field">
            <label :for="id('city')" class="field__label">{{ t.city.label }}</label>
            <input
              :id="id('city')"
              ref="cityInput"
              v-model="form.city"
              class="input"
              type="text"
              name="city"
              autocomplete="address-level2"
              :maxlength="rules.cityMax"
              required
              :aria-invalid="shown.city ? 'true' : 'false'"
              :aria-describedby="describedBy('city', [])"
              @blur="touch('city')"
            />
            <p v-if="shown.city" :id="id('city-erro')" class="field__error"><AppIcon name="alert" /><span>{{ shown.city }}</span></p>
          </div>
          <div class="field">
            <label :for="id('uf')" class="field__label">{{ t.uf.label }}</label>
            <select
              :id="id('uf')"
              ref="ufSelect"
              v-model="form.uf"
              class="select"
              name="uf"
              autocomplete="address-level1"
              required
              :aria-invalid="shown.uf ? 'true' : 'false'"
              :aria-describedby="describedBy('uf', [])"
              @blur="touch('uf')"
              @change="touch('uf')"
            >
              <option value="" disabled>{{ t.uf.placeholder }}</option>
              <option v-for="uf in ufOptions" :key="uf" :value="uf">{{ uf }}</option>
            </select>
            <p v-if="shown.uf" :id="id('uf-erro')" class="field__error"><AppIcon name="alert" /><span>{{ shown.uf }}</span></p>
          </div>
        </div>
      </fieldset>

      <div class="field">
        <label :for="id('interestTopic')" class="field__label">
          {{ t.topic.label }} <span class="waitlist__tag">{{ t.optionalTag }}</span>
        </label>
        <select :id="id('interestTopic')" v-model="form.interestTopic" class="select" name="interestTopic">
          <option value="">{{ t.topic.none }}</option>
          <option v-for="o in topicOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>

      <div class="field">
        <label class="choice">
          <input
            ref="ageInput"
            v-model="form.ageConfirmed"
            type="checkbox"
            name="ageConfirmed"
            required
            :aria-invalid="shown.ageConfirmed ? 'true' : 'false'"
            :aria-describedby="describedBy('ageConfirmed', [])"
            @change="touch('ageConfirmed')"
          />
          <span>{{ t.age.label }}</span>
        </label>
        <p v-if="shown.ageConfirmed" :id="id('ageConfirmed-erro')" class="field__error">
          <AppIcon name="alert" /><span>{{ shown.ageConfirmed }}</span>
        </p>
      </div>

      <fieldset class="choice-group">
        <legend class="field__label">{{ t.consents.legend }}</legend>
        <label class="choice waitlist__consent">
          <input
            ref="launchInput"
            v-model="form.launchNotice"
            type="checkbox"
            name="launch_notice"
            required
            :aria-invalid="shown.launchNotice ? 'true' : 'false'"
            :aria-describedby="describedBy('launchNotice', [id('launchNotice-tag')])"
            @change="touch('launchNotice')"
          />
          <span>
            {{ purposes.launch_notice.text }}
            <span :id="id('launchNotice-tag')" class="waitlist__tag waitlist__tag--required">{{ t.consents.requiredTag }}</span>
          </span>
        </label>
        <p v-if="shown.launchNotice" :id="id('launchNotice-erro')" class="field__error">
          <AppIcon name="alert" /><span>{{ shown.launchNotice }}</span>
        </p>
        <label class="choice waitlist__consent">
          <input v-model="form.marketing" type="checkbox" name="marketing" :aria-describedby="id('marketing-tag')" />
          <span>
            {{ purposes.marketing.text }}
            <span :id="id('marketing-tag')" class="waitlist__tag">{{ t.consents.optionalTag }}</span>
          </span>
        </label>
      </fieldset>

      </div>

      <AntiBotTrap v-model="form.website" :name="rules.antiBot.honeypotField" />

      <div class="form-actions">
        <div v-if="generalError" ref="generalErrorEl" class="notice notice--error" role="alert" tabindex="-1">
          <AppIcon name="alert" />
          <div>
            <p>{{ generalError }}</p>
            <p v-if="needsReload">
              <button type="button" class="btn btn--secondary btn--sm waitlist__reload" @click="reloadPage">
                {{ common.reload }}
              </button>
            </p>
          </div>
        </div>
        <RichText v-if="step === 2" :html="t.privacy_mdi" tag="p" class="legal-text waitlist__privacy" />
        <button v-if="step === 2" type="button" class="btn btn--secondary btn--block" :disabled="submitting" @click="backToDetails">
          {{ t.steps.back }}
        </button>
        <button
          type="submit"
          class="btn btn--primary btn--block"
          :aria-disabled="submitting ? 'true' : 'false'"
          :aria-describedby="id('abaixo')"
        >
          <span v-if="submitting" class="spinner" aria-hidden="true" />
          {{ submitting ? common.submitting : step === 1 ? t.steps.continue : t.submit }}
        </button>
        <p :id="id('abaixo')" class="legal-text waitlist__below">{{ t.below }}</p>
      </div>

      <p class="visually-hidden" role="status" aria-live="polite">{{ status }}</p>
    </form>
  </div>
</template>

<style scoped>
.waitlist [hidden] {
  display: none;
}

.waitlist__progress {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  list-style: none;
  padding: 0;
  margin: 0 0 8px;
  color: var(--mf-muted);
  font-size: 0.875rem;
}

.waitlist__progress li {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 2px solid var(--mf-border);
  padding-bottom: 12px;
}

.waitlist__progress li.is-current {
  border-color: var(--mf-forest);
  color: var(--mf-forest);
  font-weight: 700;
}

.waitlist__progress span {
  display: grid;
  place-items: center;
  flex: 0 0 26px;
  height: 26px;
  border: 1px solid currentColor;
  border-radius: 50%;
}

.waitlist__progress .is-current span {
  color: white;
  background: var(--mf-forest);
  border-color: var(--mf-forest);
}

.waitlist__step {
  display: grid;
  gap: var(--mf-space-5);
}

.waitlist__form {
  position: relative;
}

.waitlist__required {
  margin: 0;
}

.waitlist__group {
  display: grid;
  gap: var(--mf-space-4);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.waitlist__group + .waitlist__group,
.waitlist__group + .field {
  padding-top: var(--mf-space-4);
  border-top: 1px solid var(--mf-border);
}

/* float tira a legenda da borda do fieldset: a divisória fica acima do título, não ao lado. */
.waitlist__group-title {
  float: left;
  width: 100%;
  padding: 0;
  margin-bottom: 4px;
  font-family: var(--mf-font-heading);
  font-size: 1.1875rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--mf-forest);
}

.waitlist__group-hint {
  margin-top: calc(-1 * var(--mf-space-3));
}

.waitlist__short {
  max-width: 320px;
}

.waitlist__why {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: var(--mf-radius-control);
  background: var(--mf-cream);
  font-size: 0.9375rem;
  line-height: 1.5;
}

.waitlist__why p {
  margin: 0;
}

.waitlist__why .icon {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 2px;
  color: var(--mf-forest);
}

.waitlist__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 140px);
  gap: var(--mf-space-3);
  align-items: start;
}

@media (max-width: 399px) {
  .waitlist__row {
    grid-template-columns: minmax(0, 1fr);
  }
}

.waitlist__consent {
  font-size: 0.9875rem;
}

.waitlist__tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--mf-control-border);
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.5;
  color: var(--mf-muted);
  white-space: nowrap;
  vertical-align: 1px;
}

.waitlist__tag--required {
  border-color: var(--mf-forest);
  color: var(--mf-forest);
}

.waitlist__privacy {
  margin: 0;
}

.waitlist__below {
  margin: 0;
}

.waitlist__reload {
  margin-top: 8px;
}

.notice:focus {
  outline: 3px solid var(--mf-focus);
  outline-offset: 2px;
}
</style>
