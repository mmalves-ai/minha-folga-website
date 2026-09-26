<script setup lang="ts">
import { computed, nextTick, reactive, ref, useId, watch } from 'vue'
import page from '@content/pages/preferencias.yaml'
import copy from '@content/pages/formularios.yaml'
import consents from '@contracts/consents.json'
import validation from '@contracts/validation.json'
import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/forms/ConfirmDialog.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { formatDate } from '@/lib/format'
import { api, ApiError } from '@/services/api'
import { collapseSpaces, errorMessage, fill, focusAndReveal, looksLikeCity } from './form-helpers'
import type { ConsentPurpose, EmploymentType, IncomeRange, InterestTopic, JobTenure, Preferences, PreferencesPatch } from './api-types'

/**
 * Gestão das finalidades do titular com sessão válida, aberta pelo link seguro da Bia (seções 6.15 e 9;
 * decisão D1). Identificadores (telefone, CPF, e-mail) aparecem só mascarados; a pessoa pode mudar
 * as finalidades, o tema de interesse e os dados gerais não identificadores (vínculo, tempo no
 * emprego, faixa de salário, cidade e UF). Revogar `launch_notice` tira o contato da lista; conceder
 * exige a versão do texto exibido.
 * Acessibilidade das confirmações: quando o botão acionado continua na tela, o foco fica nele e a
 * confirmação é anunciada pela região viva persistente (useAnnouncer); quando o botão some (sair da
 * lista, pedir exclusão), o foco vai para a própria confirmação. Erros recebem o foco (role="alert").
 */
const props = defineProps<{ prefs: Preferences }>()
const emit = defineEmits<{ updated: [prefs: Preferences]; loggedOut: []; sessionExpired: [] }>()

const t = page.manage
const w = copy.waitlist
const purposes = consents.purposes
const rules = validation.waitlist
const topics = rules.interestTopics as { value: InterestTopic; label: string }[]
const employmentOptions = rules.employmentTypes as { value: EmploymentType; label: string }[]
const tenureOptions = rules.jobTenureRanges as { value: JobTenure; label: string }[]
const incomeOptions = rules.incomeRanges as { value: IncomeRange; label: string }[]
const ufOptions = rules.ufs as string[]
const uid = useId()
const { announce } = useAnnouncer()

const displayName = computed(() => (props.prefs.preferredName ?? props.prefs.firstName ?? '').trim())
const greeting = computed(() => (displayName.value ? fill(t.greeting, { name: displayName.value }) : t.greetingNoName))
/** Data da validação (quando a API informa), '' se validado sem data, null se ainda não validado. */
const phoneVerified = computed(() => {
  if (props.prefs.contactVerifiedAt) return props.prefs.contactVerifiedAt
  return props.prefs.contactVerified === true || props.prefs.state === 'verified' ? '' : null
})

// Dados gerais (não identificadores): só aparecem os que a API devolveu.
type GeneralField = 'employmentType' | 'jobTenure' | 'incomeRange' | 'city' | 'uf'
const GENERAL: GeneralField[] = ['employmentType', 'jobTenure', 'incomeRange', 'city', 'uf']
const generalFields = computed(() => GENERAL.filter((f) => props.prefs[f] !== undefined))
const general = reactive<Record<GeneralField, string>>({ employmentType: '', jobTenure: '', incomeRange: '', city: '', uf: '' })
const generalErrors = reactive<Partial<Record<GeneralField, string>>>({})
const generalSubmitted = ref(false)
const savingGeneral = ref(false)
const generalMessage = ref<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null)
const generalMessageEl = ref<HTMLElement | null>(null)
const generalInputs: Record<GeneralField, HTMLElement | null> = { employmentType: null, jobTenure: null, incomeRange: null, city: null, uf: null }
function setGeneralInput(field: GeneralField) {
  return (el: unknown) => {
    generalInputs[field] = (el as HTMLElement | null) ?? null
  }
}

function resetGeneral(p: Preferences) {
  for (const f of GENERAL) general[f] = (p[f] as string | null | undefined) ?? ''
  for (const f of GENERAL) delete generalErrors[f]
  generalSubmitted.value = false
}

const inOptions = (options: { value: string }[], value: string) => options.some((o) => o.value === value)

function validateGeneral(field: GeneralField): string | null {
  switch (field) {
    case 'employmentType':
      return inOptions(employmentOptions, general.employmentType) ? null : w.employment.required
    case 'jobTenure':
      return inOptions(tenureOptions, general.jobTenure) ? null : w.tenure.required
    case 'incomeRange':
      return inOptions(incomeOptions, general.incomeRange) ? null : w.income.required
    case 'city': {
      const v = collapseSpaces(general.city)
      if (v.length < 2) return w.city.required
      if (v.length > rules.cityMax) return w.city.tooLong
      return looksLikeCity(v) ? null : w.city.invalid
    }
    case 'uf':
      return ufOptions.includes(general.uf) ? null : w.uf.required
  }
}

const generalShown = computed(() => {
  const out: Partial<Record<GeneralField, string>> = {}
  for (const f of generalFields.value) {
    const message = generalErrors[f] ?? (generalSubmitted.value ? validateGeneral(f) : null)
    if (message) out[f] = message
  }
  return out
})

const generalDirty = computed(() =>
  generalFields.value.some((f) => (f === 'city' ? collapseSpaces(general.city) : general[f]) !== ((props.prefs[f] as string | null | undefined) ?? '')),
)

const draft = reactive({ launch_notice: false, marketing: false, topic: '' as InterestTopic | '' })
function resetDraft(p: Preferences) {
  draft.launch_notice = Boolean(p.purposes.launch_notice?.granted)
  draft.marketing = Boolean(p.purposes.marketing?.granted)
  draft.topic = p.interestTopic ?? ''
}
watch(
  () => props.prefs,
  (p) => {
    resetDraft(p)
    resetGeneral(p)
  },
  { immediate: true },
)

const saving = ref(false)
const leaving = ref(false)
const deleting = ref(false)
const loggingOut = ref(false)
const deletionRequested = ref(false)
const message = ref<{ tone: 'success' | 'error' | 'info'; text: string; reload?: boolean } | null>(null)
const leaveMessage = ref('')
const messageEl = ref<HTMLElement | null>(null)
const leaveStatusEl = ref<HTMLElement | null>(null)
const dialog = ref<InstanceType<typeof ConfirmDialog> | null>(null)

const inList = computed(() => Boolean(props.prefs.purposes.launch_notice?.granted))
const dirty = computed(
  () =>
    draft.launch_notice !== Boolean(props.prefs.purposes.launch_notice?.granted) ||
    draft.marketing !== Boolean(props.prefs.purposes.marketing?.granted) ||
    (draft.topic || null) !== (props.prefs.interestTopic ?? null),
)

function purposeStatus(key: ConsentPurpose): string {
  const state = props.prefs.purposes[key]
  const label = state?.granted ? t.active : t.inactive
  return state?.updatedAt ? `${label}. ${fill(t.updatedAt, { date: formatDate(state.updatedAt) })}` : `${label}.`
}

/** Monta somente as mudanças; ao conceder uma finalidade envia a versão do texto mostrado. */
function buildPatch(): PreferencesPatch {
  const patch: PreferencesPatch = {}
  for (const key of ['launch_notice', 'marketing'] as ConsentPurpose[]) {
    if (draft[key] === Boolean(props.prefs.purposes[key]?.granted)) continue
    patch.purposes = { ...patch.purposes, [key]: draft[key] }
    if (draft[key]) patch.consentVersions = { ...patch.consentVersions, [key]: purposes[key].version }
  }
  if ((draft.topic || null) !== (props.prefs.interestTopic ?? null)) patch.interestTopic = draft.topic || null
  return patch
}

/**
 * Mostra a mensagem. Erros (e confirmações cujo botão de origem sumiu) recebem o foco; as demais
 * confirmações são anunciadas sem tirar o foco do botão acionado.
 */
async function showMessage(tone: 'success' | 'error' | 'info', text: string, reload = false, focus = tone === 'error') {
  message.value = { tone, text, reload }
  await nextTick()
  if (focus) focusAndReveal(messageEl.value)
  else announce(text)
}

function handleError(e: unknown): void {
  if (e instanceof ApiError && e.code === 'session_required') {
    emit('sessionExpired')
    return
  }
  if (e instanceof ApiError && e.code === 'consent_version_outdated') {
    void showMessage('error', t.consentOutdated, true)
    return
  }
  void showMessage('error', errorMessage(e))
}

async function patch(body: PreferencesPatch): Promise<Preferences> {
  const res = await api<Preferences>('/preferences', { method: 'PATCH', body })
  emit('updated', res)
  return res
}

async function save() {
  if (saving.value) return
  leaveMessage.value = ''
  const body = buildPatch()
  if (!Object.keys(body).length) {
    await showMessage('info', t.noChanges)
    return
  }
  saving.value = true
  message.value = null
  try {
    await patch(body)
    await showMessage('success', t.saved)
  } catch (e) {
    handleError(e)
  } finally {
    saving.value = false
  }
}

async function showGeneralMessage(tone: 'success' | 'error' | 'info', text: string, focus = tone === 'error') {
  generalMessage.value = { tone, text }
  await nextTick()
  if (focus) focusAndReveal(generalMessageEl.value)
  else announce(text)
}

function buildGeneralPatch(): PreferencesPatch {
  const patch: PreferencesPatch = {}
  for (const f of generalFields.value) {
    const value = f === 'city' ? collapseSpaces(general.city) : general[f]
    if (value === ((props.prefs[f] as string | null | undefined) ?? '')) continue
    ;(patch as Record<string, string>)[f] = value
  }
  return patch
}

async function saveGeneral() {
  if (savingGeneral.value) return
  generalSubmitted.value = true
  generalMessage.value = null
  const invalid = generalFields.value.find((f) => validateGeneral(f))
  if (invalid) {
    await nextTick()
    focusAndReveal(generalInputs[invalid])
    return
  }
  const body = buildGeneralPatch()
  if (!Object.keys(body).length) {
    await showGeneralMessage('info', t.noChanges)
    return
  }
  savingGeneral.value = true
  try {
    await patch(body)
    await showGeneralMessage('success', t.general.saved)
  } catch (e) {
    if (e instanceof ApiError && e.code === 'session_required') {
      emit('sessionExpired')
      return
    }
    if (e instanceof ApiError && e.code === 'validation_error') {
      let mapped: GeneralField | null = null
      for (const [key, text] of Object.entries(e.fields)) {
        if ((GENERAL as string[]).includes(key)) {
          generalErrors[key as GeneralField] = text
          mapped ??= key as GeneralField
        }
      }
      if (mapped) {
        await nextTick()
        focusAndReveal(generalInputs[mapped])
        return
      }
    }
    await showGeneralMessage('error', errorMessage(e))
  } finally {
    savingGeneral.value = false
  }
}

for (const f of GENERAL) {
  watch(
    () => general[f],
    () => {
      delete generalErrors[f]
    },
  )
}

async function leaveList() {
  if (leaving.value || !inList.value) return
  leaving.value = true
  message.value = null
  try {
    const res = await patch({ purposes: { launch_notice: false } })
    leaveMessage.value = res.purposes.marketing?.granted ? `${t.leave.done} ${t.leave.marketingStill}` : t.leave.done
    // O botão "Sair da lista" deixa de existir: o foco vai para a confirmação, lida ao receber o foco.
    await nextTick()
    focusAndReveal(leaveStatusEl.value)
  } catch (e) {
    handleError(e)
  } finally {
    leaving.value = false
  }
}

async function confirmDeletion() {
  if (deleting.value) return
  deleting.value = true
  try {
    await api('/preferences/deletion-request', { method: 'POST', body: {} })
    deletionRequested.value = true
    dialog.value?.close()
    // O botão que abriu o diálogo deixa de existir: o foco vai para a confirmação.
    await showMessage('success', t.deletion.done, false, true)
    // O pedido revoga todas as comunicações no servidor: a tela passa a mostrar o estado real.
    try {
      emit('updated', await api<Preferences>('/preferences'))
    } catch {
      // Sem releitura (sessão encerrada ou rede): o pedido já foi registrado e confirmado acima.
    }
  } catch (e) {
    dialog.value?.close()
    handleError(e)
  } finally {
    deleting.value = false
  }
}

async function logout() {
  if (loggingOut.value) return
  loggingOut.value = true
  try {
    await api('/preferences/logout', { method: 'POST', body: {} })
    emit('loggedOut')
  } catch (e) {
    // Sessão já inexistente também encerra o acesso nesta tela.
    if (e instanceof ApiError && (e.status === 401 || e.code === 'session_required')) emit('loggedOut')
    else void showMessage('error', errorMessage(e))
  } finally {
    loggingOut.value = false
  }
}

function reloadPage() {
  window.location.reload()
}
</script>

<template>
  <div class="prefs">
    <header class="prefs__head">
      <h2 id="preferencias-titulo" class="prefs__greeting" tabindex="-1">{{ greeting }}</h2>
      <p class="muted">{{ fill(t.summary, { hint: prefs.contactHint }) }}</p>
      <p v-if="prefs.state === 'invited'" class="notice notice--mint prefs__invited">
        <AppIcon name="info" />
        <span>{{ t.invited }}</span>
      </p>
    </header>

    <!-- Dados que identificam o titular: somente mascarados, sem edição por aqui. -->
    <section class="prefs__data" :aria-labelledby="`${uid}-dados`">
      <h3 :id="`${uid}-dados`" class="prefs__block-title">{{ t.dataTitle }}</h3>
      <dl class="prefs__dl">
        <div>
          <dt>{{ t.labels.phone }}</dt>
          <dd class="prefs__mono">{{ prefs.contactHint }}</dd>
        </div>
        <div>
          <dt>{{ t.labels.validation }}</dt>
          <dd>
            <span v-if="phoneVerified !== null" class="prefs__status prefs__status--on">
              <AppIcon name="check-circle" />
              {{ phoneVerified ? fill(t.phoneVerified, { date: formatDate(phoneVerified) }) : t.phoneVerifiedNoDate }}
            </span>
            <span v-else class="prefs__status">{{ t.phoneNotVerified }}</span>
          </dd>
        </div>
        <div v-if="prefs.nameHint">
          <dt>{{ t.labels.name }}</dt>
          <dd>{{ prefs.nameHint }}</dd>
        </div>
        <div v-if="prefs.employerName">
          <dt>{{ t.labels.employer }}</dt>
          <dd>{{ prefs.employerName }}</dd>
        </div>
        <div v-if="prefs.cpfHint !== undefined">
          <dt>{{ t.labels.cpf }}</dt>
          <dd class="prefs__mono">{{ prefs.cpfHint || '—' }}</dd>
        </div>
        <div v-if="prefs.emailHint !== undefined">
          <dt>{{ t.labels.email }}</dt>
          <dd :class="{ prefs__mono: prefs.emailHint }">{{ prefs.emailHint || t.emailNone }}</dd>
        </div>
      </dl>
      <p class="small muted prefs__data-hint">{{ t.dataHint }}</p>
    </section>

    <!-- Sem role="status" nas confirmações: o anúncio sai pela região viva persistente (useAnnouncer). -->
    <div
      v-if="message"
      ref="messageEl"
      class="notice prefs__message"
      :class="message.tone === 'error' ? 'notice--error' : 'notice--success'"
      :role="message.tone === 'error' ? 'alert' : undefined"
      tabindex="-1"
    >
      <AppIcon :name="message.tone === 'error' ? 'alert' : message.tone === 'success' ? 'check-circle' : 'info'" />
      <div>
        <p>{{ message.text }}</p>
        <p v-if="message.reload">
          <button type="button" class="btn btn--secondary btn--sm" @click="reloadPage">{{ t.reload }}</button>
        </p>
      </div>
    </div>

    <form class="prefs__card" novalidate :aria-labelledby="`${uid}-finalidades`" @submit.prevent="save">
      <h3 :id="`${uid}-finalidades`" class="prefs__card-title">{{ t.purposesTitle }}</h3>
      <p :id="`${uid}-finalidades-dica`" class="muted small">{{ t.purposesHint }}</p>

      <fieldset class="choice-group" :aria-describedby="`${uid}-finalidades-dica`">
        <legend class="visually-hidden">{{ t.purposesTitle }}</legend>
        <label class="choice prefs__purpose">
          <input v-model="draft.launch_notice" type="checkbox" name="launch_notice" :aria-describedby="`${uid}-launch-status`" />
          <span>
            <span class="prefs__tag">{{ t.launchTag }}</span>
            <span class="prefs__purpose-text">{{ purposes.launch_notice.text }}</span>
            <span :id="`${uid}-launch-status`" class="prefs__status" :class="{ 'prefs__status--on': prefs.purposes.launch_notice?.granted }">
              <AppIcon :name="prefs.purposes.launch_notice?.granted ? 'check-circle' : 'close'" />
              {{ purposeStatus('launch_notice') }}
            </span>
          </span>
        </label>
        <label class="choice prefs__purpose">
          <input v-model="draft.marketing" type="checkbox" name="marketing" :aria-describedby="`${uid}-marketing-status`" />
          <span>
            <span class="prefs__tag">{{ t.marketingTag }}</span>
            <span class="prefs__purpose-text">{{ purposes.marketing.text }}</span>
            <span :id="`${uid}-marketing-status`" class="prefs__status" :class="{ 'prefs__status--on': prefs.purposes.marketing?.granted }">
              <AppIcon :name="prefs.purposes.marketing?.granted ? 'check-circle' : 'close'" />
              {{ purposeStatus('marketing') }}
            </span>
          </span>
        </label>
      </fieldset>

      <div class="field prefs__topic">
        <label :for="`${uid}-tema`" class="field__label">{{ t.topicLabel }}</label>
        <p :id="`${uid}-tema-dica`" class="field__hint">{{ t.topicHint }}</p>
        <select :id="`${uid}-tema`" v-model="draft.topic" class="select" name="interestTopic" :aria-describedby="`${uid}-tema-dica`">
          <option value="">{{ t.topicNone }}</option>
          <option v-for="topic in topics" :key="topic.value" :value="topic.value">{{ topic.label }}</option>
        </select>
      </div>

      <div class="prefs__actions">
        <button type="submit" class="btn btn--primary" :aria-disabled="saving ? 'true' : 'false'">
          <span v-if="saving" class="spinner" aria-hidden="true" />
          {{ saving ? t.saving : t.save }}
        </button>
        <span v-if="dirty && !saving" class="small muted">{{ t.unsaved }}</span>
      </div>
    </form>

    <form v-if="generalFields.length" class="prefs__card" novalidate :aria-labelledby="`${uid}-gerais`" @submit.prevent="saveGeneral">
      <h3 :id="`${uid}-gerais`" class="prefs__card-title">{{ t.general.title }}</h3>
      <p :id="`${uid}-gerais-dica`" class="muted small">{{ t.general.hint }}</p>

      <div class="prefs__general">
        <div v-if="generalFields.includes('employmentType')" class="field">
          <label :for="`${uid}-vinculo`" class="field__label">{{ w.employment.label }}</label>
          <select
            :id="`${uid}-vinculo`"
            :ref="setGeneralInput('employmentType')"
            v-model="general.employmentType"
            class="select"
            name="employmentType"
            :aria-invalid="generalShown.employmentType ? 'true' : 'false'"
            :aria-describedby="generalShown.employmentType ? `${uid}-vinculo-erro` : undefined"
          >
            <option value="" disabled>{{ w.employment.placeholder }}</option>
            <option v-for="o in employmentOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <p v-if="generalShown.employmentType" :id="`${uid}-vinculo-erro`" class="field__error">
            <AppIcon name="alert" /><span>{{ generalShown.employmentType }}</span>
          </p>
        </div>

        <div v-if="generalFields.includes('jobTenure')" class="field">
          <label :for="`${uid}-tempo`" class="field__label">{{ w.tenure.label }}</label>
          <select
            :id="`${uid}-tempo`"
            :ref="setGeneralInput('jobTenure')"
            v-model="general.jobTenure"
            class="select"
            name="jobTenure"
            :aria-invalid="generalShown.jobTenure ? 'true' : 'false'"
            :aria-describedby="generalShown.jobTenure ? `${uid}-tempo-erro` : undefined"
          >
            <option value="" disabled>{{ w.tenure.placeholder }}</option>
            <option v-for="o in tenureOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <p v-if="generalShown.jobTenure" :id="`${uid}-tempo-erro`" class="field__error">
            <AppIcon name="alert" /><span>{{ generalShown.jobTenure }}</span>
          </p>
        </div>

        <div v-if="generalFields.includes('incomeRange')" class="field">
          <label :for="`${uid}-renda`" class="field__label">{{ w.income.label }}</label>
          <select
            :id="`${uid}-renda`"
            :ref="setGeneralInput('incomeRange')"
            v-model="general.incomeRange"
            class="select"
            name="incomeRange"
            :aria-invalid="generalShown.incomeRange ? 'true' : 'false'"
            :aria-describedby="generalShown.incomeRange ? `${uid}-renda-erro` : undefined"
          >
            <option value="" disabled>{{ w.income.placeholder }}</option>
            <option v-for="o in incomeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <p v-if="generalShown.incomeRange" :id="`${uid}-renda-erro`" class="field__error">
            <AppIcon name="alert" /><span>{{ generalShown.incomeRange }}</span>
          </p>
        </div>

        <div class="prefs__place">
          <div v-if="generalFields.includes('city')" class="field">
            <label :for="`${uid}-cidade`" class="field__label">{{ w.city.label }}</label>
            <input
              :id="`${uid}-cidade`"
              :ref="setGeneralInput('city')"
              v-model="general.city"
              class="input"
              type="text"
              name="city"
              autocomplete="address-level2"
              :maxlength="rules.cityMax"
              :aria-invalid="generalShown.city ? 'true' : 'false'"
              :aria-describedby="generalShown.city ? `${uid}-cidade-erro` : undefined"
            />
            <p v-if="generalShown.city" :id="`${uid}-cidade-erro`" class="field__error"><AppIcon name="alert" /><span>{{ generalShown.city }}</span></p>
          </div>
          <div v-if="generalFields.includes('uf')" class="field">
            <label :for="`${uid}-uf`" class="field__label">{{ w.uf.label }}</label>
            <select
              :id="`${uid}-uf`"
              :ref="setGeneralInput('uf')"
              v-model="general.uf"
              class="select"
              name="uf"
              autocomplete="address-level1"
              :aria-invalid="generalShown.uf ? 'true' : 'false'"
              :aria-describedby="generalShown.uf ? `${uid}-uf-erro` : undefined"
            >
              <option value="" disabled>{{ w.uf.placeholder }}</option>
              <option v-for="uf in ufOptions" :key="uf" :value="uf">{{ uf }}</option>
            </select>
            <p v-if="generalShown.uf" :id="`${uid}-uf-erro`" class="field__error"><AppIcon name="alert" /><span>{{ generalShown.uf }}</span></p>
          </div>
        </div>
      </div>

      <div
        v-if="generalMessage"
        ref="generalMessageEl"
        class="notice prefs__message"
        :class="generalMessage.tone === 'error' ? 'notice--error' : 'notice--success'"
        :role="generalMessage.tone === 'error' ? 'alert' : undefined"
        tabindex="-1"
      >
        <AppIcon :name="generalMessage.tone === 'error' ? 'alert' : generalMessage.tone === 'success' ? 'check-circle' : 'info'" />
        <p>{{ generalMessage.text }}</p>
      </div>

      <div class="prefs__actions">
        <button type="submit" class="btn btn--secondary" :aria-disabled="savingGeneral ? 'true' : 'false'">
          <span v-if="savingGeneral" class="spinner" aria-hidden="true" />
          {{ savingGeneral ? t.saving : t.general.save }}
        </button>
        <span v-if="generalDirty && !savingGeneral" class="small muted">{{ t.unsaved }}</span>
      </div>
    </form>

    <section class="prefs__block" :aria-labelledby="`${uid}-sair`">
      <h3 :id="`${uid}-sair`" class="prefs__block-title">{{ t.leave.title }}</h3>
      <template v-if="inList">
        <p>{{ t.leave.text }}</p>
        <button type="button" class="btn btn--secondary" :aria-disabled="leaving ? 'true' : 'false'" @click="leaveList">
          <span v-if="leaving" class="spinner" aria-hidden="true" />
          {{ leaving ? t.leave.leaving : t.leave.button }}
        </button>
      </template>
      <p v-else class="prefs__out">
        <AppIcon name="info" />
        <span>{{ t.leave.already }}</span>
      </p>
      <p ref="leaveStatusEl" class="prefs__leave-status" tabindex="-1">{{ leaveMessage }}</p>
    </section>

    <section class="prefs__block" :aria-labelledby="`${uid}-excluir`">
      <h3 :id="`${uid}-excluir`" class="prefs__block-title">{{ t.deletion.title }}</h3>
      <p>{{ t.deletion.text }}</p>
      <button v-if="!deletionRequested" type="button" class="btn btn--secondary prefs__danger" @click="dialog?.open()">
        {{ t.deletion.button }}
      </button>
      <p v-else class="prefs__out">
        <AppIcon name="check-circle" />
        <span>{{ t.deletion.done }}</span>
      </p>
    </section>

    <div class="prefs__logout">
      <button type="button" class="btn btn--ghost" :aria-disabled="loggingOut ? 'true' : 'false'" @click="logout">
        <AppIcon name="logout" />
        {{ t.logout }}
      </button>
    </div>

    <ConfirmDialog
      ref="dialog"
      :title="t.deletion.dialogTitle"
      :text="t.deletion.dialogText"
      :confirm-label="t.deletion.confirm"
      :cancel-label="t.deletion.cancel"
      :busy="deleting"
      :busy-label="t.deletion.confirming"
      @confirm="confirmDeletion"
    />
  </div>
</template>

<style scoped>
.prefs {
  display: grid;
  gap: var(--mf-space-5);
}

.prefs__greeting {
  margin-bottom: 8px;
  font-size: clamp(1.625rem, 1.4vw + 1rem, 2.25rem);
}

.prefs__greeting:focus {
  outline: none;
}

.prefs__greeting:focus-visible {
  outline: 3px solid var(--mf-focus);
}

.prefs__head p {
  margin-bottom: 0;
}

.prefs__invited {
  margin-top: var(--mf-space-3);
  align-items: center;
}

/* Só leitura: borda em vez de sombra, para não parecer um formulário. */
.prefs__data {
  display: grid;
  gap: var(--mf-space-3);
  padding: var(--mf-space-4) var(--mf-space-5);
  border: 1px solid var(--mf-border);
  border-radius: var(--mf-radius-card);
  background: var(--mf-paper);
}

.prefs__dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--mf-space-3) var(--mf-space-4);
  margin: 0;
}

.prefs__dl dt {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--mf-muted);
}

.prefs__dl dd {
  margin: 2px 0 0;
  overflow-wrap: anywhere;
}

.prefs__mono {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.prefs__data-hint {
  margin: 0;
}

.prefs__general {
  display: grid;
  gap: var(--mf-space-4);
}

.prefs__place {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 140px);
  gap: var(--mf-space-3);
  align-items: start;
}

@media (max-width: 559px) {
  .prefs__dl {
    grid-template-columns: minmax(0, 1fr);
  }
  .prefs__data {
    padding: var(--mf-space-4);
  }
}

@media (max-width: 399px) {
  .prefs__place {
    grid-template-columns: minmax(0, 1fr);
  }
}

.prefs__message:focus {
  outline: 3px solid var(--mf-focus);
  outline-offset: 2px;
}

.prefs__card {
  display: grid;
  gap: var(--mf-space-4);
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-card);
  background: var(--mf-paper);
  box-shadow: var(--mf-shadow-soft);
}

.prefs__card-title,
.prefs__block-title {
  margin-bottom: 4px;
  font-size: 1.3125rem;
}

.prefs__card > p {
  margin: -16px 0 0;
}

.prefs__purpose > span {
  display: grid;
  gap: 6px;
}

.prefs__tag {
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.prefs__purpose-text {
  font-weight: 500;
}

.prefs__status {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 0.875rem;
  color: var(--mf-muted);
}

.prefs__status .icon {
  width: 16px;
  height: 16px;
  flex: none;
}

.prefs__status--on {
  color: var(--mf-forest);
  font-weight: 600;
}

.prefs__topic .select {
  max-width: 420px;
}

.prefs__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  align-items: center;
}

.prefs__block {
  padding-top: var(--mf-space-4);
  border-top: 1px solid var(--mf-border);
}

.prefs__block p {
  max-width: 62ch;
}

.prefs__out {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-weight: 600;
}

.prefs__out .icon {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 2px;
  color: var(--mf-forest);
}

.prefs__leave-status {
  margin: 12px 0 0;
  font-weight: 600;
  color: var(--mf-forest);
}

.prefs__leave-status:empty {
  margin: 0;
}

.prefs__leave-status:focus {
  outline: none;
}

.prefs__leave-status:focus-visible {
  outline: 3px solid var(--mf-focus);
  outline-offset: 2px;
}

.prefs__danger {
  color: var(--mf-error);
  border-color: var(--mf-error);
}

.prefs__danger:hover {
  background: var(--mf-error-bg);
  color: #7f241d;
}

.prefs__logout {
  padding-top: var(--mf-space-3);
  border-top: 1px solid var(--mf-border);
}

@media (max-width: 767px) {
  .prefs__card {
    padding: var(--mf-space-4);
  }
}
</style>
