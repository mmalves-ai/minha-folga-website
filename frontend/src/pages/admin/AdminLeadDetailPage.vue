<script setup lang="ts">
/**
 * Detalhe do cadastro (leads:read), decisão D1: empresa, faixas, cidade/UF, CPF e e-mail mascarados,
 * validação do telefone pela Bia, submissões do site guardadas para revisão e trilha de eventos.
 * Telefone, e-mail e CPF completos só com leads:read_contact, justificativa e registro em auditoria;
 * ficam apenas em memória desta tela.
 * Foco: revelado o contato, o botão "Revelar" dá lugar aos dados, que recebem o foco (são lidos ao
 * receber o foco); ao ocultar, o foco volta para "Revelar contato" e a mudança é anunciada.
 * Submissões em revisão (privacy:manage): "Aplicar ao cadastro" copia os dados cadastrais da submissão (nunca o
 * telefone nem as preferências); "Descartar" só a tira da revisão. As duas pedem justificativa na própria tela
 * (InlineReasonForm, que recebe o foco); cancelar devolve o foco ao botão de origem; concluir anuncia o resultado
 * pela região viva persistente, recarrega o detalhe e leva o foco ao título da seção (o item saiu da lista).
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import AdminState from '@/components/admin/AdminState.vue'
import AdminStatus from '@/components/admin/AdminStatus.vue'
import InlineReasonForm from '@/components/admin/InlineReasonForm.vue'
import ReasonDialog from '@/components/admin/ReasonDialog.vue'
import {
  ACTOR_TYPES,
  EMPLOYMENT_TYPES,
  INCOME_RANGES,
  INTEREST_TOPICS,
  JOB_TENURES,
  LEAD_EVENTS,
  LEAD_FIELDS,
  LEAD_STATES,
  PURPOSES,
  SUBMISSION_CHANNELS,
  SUBMISSION_REASONS,
  discardOnlyReason,
  label,
  sourceLabel,
  statusMeta,
  submissionApplicable,
} from '@/components/admin/labels'
import type {
  AdminLeadDetail,
  AdminLeadEvent,
  AdminLeadSubmission,
  RevealedContact,
  SubmissionApplied,
  SubmissionDiscarded,
} from '@/components/admin/types'
import { focusIfLost } from '@/components/forms/form-helpers'
import { formatDateTime, formatList, formatPhoneBr } from '@/lib/format'
import { ApiError } from '@/services/api'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { adminApi, errorMessage, useAdminSession } from '@/composables/useAdminSession'
import { useAdminLoader, useAdminTitle } from '@/composables/useAdminLoader'

const route = useRoute()
const router = useRouter()
const session = useAdminSession()
const { announce } = useAnnouncer()
const id = computed(() => String(route.params.id ?? ''))

const loader = useAdminLoader(() => adminApi<AdminLeadDetail>(`/admin/leads/${encodeURIComponent(id.value)}`))
const lead = computed(() => loader.data.value)

const leadName = computed(() => lead.value?.fullName || lead.value?.preferredName || 'Sem nome')
useAdminTitle(() => (lead.value ? `Cadastro de ${lead.value.anonymized ? 'titular anonimizado' : leadName.value}` : 'Cadastro'))

// Volta para a lista com os filtros que estavam aplicados, quando veio dela.
const backTo = computed(() => {
  const back = router.options.history.state.back
  return typeof back === 'string' && back.startsWith('/admin/leads') ? back : { name: 'admin-leads' }
})

const events = computed(() => [...(lead.value?.events ?? [])].sort((a, b) => b.at.localeCompare(a.at)))
const submissions = computed(() => [...(lead.value?.pendingSubmissions ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))

type SubField = keyof NonNullable<AdminLeadSubmission['data']>
/** Campos da submissão comparados com o cadastro atual (identificadores só mascarados, dos dois lados). */
const SUB_FIELDS: { key: SubField; current: (l: AdminLeadDetail) => string | null | undefined; map?: Record<string, string> }[] = [
  { key: 'fullName', current: (l) => l.fullName },
  { key: 'phoneHint', current: (l) => l.phoneHint },
  { key: 'cpfHint', current: (l) => l.cpfHint },
  { key: 'emailHint', current: (l) => l.emailHint },
  { key: 'employerName', current: (l) => l.employerName },
  { key: 'employmentType', current: (l) => l.employmentType, map: EMPLOYMENT_TYPES },
  { key: 'jobTenure', current: (l) => l.jobTenure, map: JOB_TENURES },
  { key: 'incomeRange', current: (l) => l.incomeRange, map: INCOME_RANGES },
  { key: 'city', current: (l) => l.city },
  { key: 'uf', current: (l) => l.uf },
  { key: 'interestTopic', current: (l) => l.interestTopic, map: INTEREST_TOPICS },
]
const SUB_LABELS: Record<SubField, string> = {
  fullName: LEAD_FIELDS.fullName!,
  phoneHint: LEAD_FIELDS.phone!,
  cpfHint: LEAD_FIELDS.cpf!,
  emailHint: LEAD_FIELDS.email!,
  employerName: LEAD_FIELDS.employerName!,
  employmentType: LEAD_FIELDS.employmentType!,
  jobTenure: LEAD_FIELDS.jobTenure!,
  incomeRange: LEAD_FIELDS.incomeRange!,
  city: LEAD_FIELDS.city!,
  uf: LEAD_FIELDS.uf!,
  interestTopic: LEAD_FIELDS.interestTopic!,
}

function differences(sub: AdminLeadSubmission): { label: string; current: string; sent: string }[] {
  const current = lead.value
  if (!current || !sub.data) return []
  const show = (v: string | null | undefined, map?: Record<string, string>) => (v ? (map ? label(map, v) : v) : '—')
  return SUB_FIELDS.filter((f) => (sub.data![f.key] ?? null) !== (f.current(current) ?? null)).map((f) => ({
    label: SUB_LABELS[f.key],
    current: show(f.current(current), f.map),
    sent: show(sub.data![f.key], f.map),
  }))
}
const place = computed(() => [lead.value?.city, lead.value?.uf].filter(Boolean).join(' / '))

function eventDetail(e: AdminLeadEvent): string {
  const parts: string[] = []
  if (e.fromState || e.toState) {
    parts.push(`${e.fromState ? statusMeta(LEAD_STATES, e.fromState).label : 'início'} → ${e.toState ? statusMeta(LEAD_STATES, e.toState).label : '—'}`)
  }
  if (e.purpose) {
    const g = e.granted === null ? '' : e.granted ? ': autorizada' : ': não autorizada'
    parts.push(`${label(PURPOSES, e.purpose)}${g}`)
  }
  return parts.join(' · ')
}

// Revelar contato ----------------------------------------------------------------------------------
const revealOpen = ref(false)
const revealBusy = ref(false)
const revealError = ref<string | null>(null)
const revealed = ref<RevealedContact | null>(null)
const revealedEl = ref<HTMLElement | null>(null)
const revealButton = ref<HTMLButtonElement | null>(null)
const contactHeading = ref<HTMLElement | null>(null)

async function reveal(reason: string) {
  if (revealBusy.value) return
  revealBusy.value = true
  revealError.value = null
  try {
    revealed.value = await adminApi<RevealedContact>(`/admin/leads/${encodeURIComponent(id.value)}/reveal-contact`, { body: { reason } })
    revealBusy.value = false
    revealOpen.value = false
    // O diálogo fecha e o botão de origem sumiu: o foco vai para o telefone revelado.
    await nextTick()
    revealedEl.value?.focus()
  } catch (e) {
    revealError.value = errorMessage(e)
  } finally {
    revealBusy.value = false
  }
}

async function hideContact() {
  revealed.value = null
  await nextTick()
  ;(revealButton.value ?? contactHeading.value)?.focus()
  announce('Contato ocultado.')
}

// Revisão das submissões (privacy:manage) ---------------------------------------------------------
type ReviewAction = 'apply' | 'discard'

const canReview = computed(() => session.can('privacy:manage'))
const review = ref<{ id: string; action: ReviewAction } | null>(null)
const reviewBusy = ref(false)
const reviewError = ref<string | null>(null)
const reviewFieldError = ref<string | null>(null)
/** Confirmação visível (o anúncio sai pela região viva persistente; aqui sem role="status"). */
const reviewFeedback = ref('')
/** A lista estava desatualizada (submissão já revisada, removida ou cadastro anonimizado). */
const reviewStale = ref('')
const submissionsPanel = ref<HTMLElement | null>(null)
const submissionsHeading = ref<HTMLElement | null>(null)

const STALE_CODES = new Set(['submission_already_reviewed', 'not_found', 'lead_anonymized'])

const REVIEW_COPY: Record<ReviewAction, { title: string; confirm: string; busy: string; text: string }> = {
  apply: {
    title: 'Aplicar esta submissão ao cadastro',
    confirm: 'Confirmar aplicação',
    busy: 'Aplicando…',
    text: 'Os dados cadastrais desta submissão substituem os do cadastro. O telefone e as preferências de comunicação não mudam.',
  },
  discard: {
    title: 'Descartar esta submissão',
    confirm: 'Confirmar descarte',
    busy: 'Descartando…',
    text: 'A submissão sai da revisão e o cadastro continua como está.',
  },
}

function canApply(sub: AdminLeadSubmission): boolean {
  return !lead.value?.anonymized && submissionApplicable(sub)
}

/** Aplicar troca o CPF do cadastro (CPF diferente para o mesmo telefone). */
function swapsCpf(sub: AdminLeadSubmission): boolean {
  if (sub.reason === 'cpf_mismatch') return true
  const sent = sub.data?.cpfHint
  return sub.reason === 'existing_phone' && Boolean(sent) && sent !== (lead.value?.cpfHint ?? null)
}

function reviewButton(subId: string, action: ReviewAction): HTMLElement | null {
  const key = `${subId}:${action}`
  const buttons = submissionsPanel.value?.querySelectorAll<HTMLElement>('[data-review]') ?? []
  return [...buttons].find((b) => b.dataset.review === key) ?? null
}

function openReview(sub: AdminLeadSubmission, action: ReviewAction) {
  if (reviewBusy.value) return
  review.value = { id: sub.id, action }
  reviewError.value = null
  reviewFieldError.value = null
  reviewFeedback.value = ''
  reviewStale.value = ''
}

async function cancelReview() {
  const current = review.value
  if (!current || reviewBusy.value) return
  review.value = null
  await nextTick()
  ;(reviewButton(current.id, current.action) ?? submissionsHeading.value)?.focus()
}

function appliedMessage(changed: string[]): string {
  if (!changed.length) return 'Submissão aplicada. Nenhum dado do cadastro mudou: os valores já eram iguais.'
  const names = formatList(changed.map((f) => label(LEAD_FIELDS, f)))
  return `Submissão aplicada ao cadastro. ${changed.length === 1 ? 'Campo alterado' : 'Campos alterados'}: ${names}.`
}

/** Depois de concluir: o item saiu da lista, então o foco vai para o título da seção. */
async function afterReview() {
  reviewBusy.value = false
  await nextTick()
  focusIfLost(submissionsHeading.value ?? document.getElementById('conteudo-admin'))
}

async function submitReview(reason: string) {
  const current = review.value
  if (!current || reviewBusy.value) return
  reviewBusy.value = true
  reviewError.value = null
  reviewFieldError.value = null
  const path = `/admin/leads/${encodeURIComponent(id.value)}/submissions/${encodeURIComponent(current.id)}/${current.action}`
  try {
    const result = await adminApi<SubmissionApplied | SubmissionDiscarded>(path, { body: { reason } })
    const changed = result.status === 'applied' ? (result.changed ?? []) : []
    const message = current.action === 'apply' ? appliedMessage(changed) : 'Submissão descartada. O cadastro não mudou.'
    // CPF ou e-mail revelados antes podem ter mudado: saem da tela (revele de novo, se precisar).
    if (changed.includes('cpf') || changed.includes('email')) revealed.value = null
    await loader.load()
    review.value = null
    reviewFeedback.value = message
    announce(message)
    await afterReview()
  } catch (e) {
    if (e instanceof ApiError && STALE_CODES.has(e.code)) {
      review.value = null
      reviewStale.value = errorMessage(e)
      await loader.load()
      await afterReview()
    } else if (e instanceof ApiError && e.code === 'validation_error' && e.fields.reason) {
      reviewFieldError.value = e.fields.reason
    } else {
      reviewError.value = errorMessage(e)
    }
  } finally {
    reviewBusy.value = false
  }
}

function resetReview() {
  review.value = null
  reviewError.value = null
  reviewFieldError.value = null
  reviewFeedback.value = ''
  reviewStale.value = ''
}

watch(id, () => {
  if (route.name !== 'admin-lead') return
  revealed.value = null
  resetReview()
  void loader.load()
})

onMounted(() => void loader.load())
</script>

<template>
  <div>
    <RouterLink :to="backTo" class="admin-back"><AppIcon name="arrow-left" /> Cadastros</RouterLink>

    <AdminState :loading="loader.loading.value && !lead" :error="loader.error.value" loading-text="Carregando cadastro…" @retry="loader.load" />

    <template v-if="lead && !loader.error.value">
      <header class="admin-page-head">
        <div class="admin-page-head__text">
          <h1>{{ lead.anonymized ? 'Cadastro anonimizado' : leadName }}</h1>
          <p class="lead-detail__sub">
            <AdminStatus v-bind="statusMeta(LEAD_STATES, lead.state)" />
            <span>Recebido em {{ formatDateTime(lead.createdAt) }}</span>
          </p>
        </div>
      </header>

      <p v-if="lead.anonymized" class="notice notice--mint lead-detail__anon">
        <AppIcon name="shield" />
        <span>Os dados pessoais deste cadastro foram substituídos. A trilha de eventos permanece para comprovar preferências e supressões.</span>
      </p>

      <div class="admin-grid admin-grid--detail">
        <div>
          <section class="admin-panel" aria-labelledby="dados-titulo">
            <h2 id="dados-titulo">Dados do cadastro</h2>
            <dl class="admin-dl">
              <template v-if="lead.employerName !== undefined">
                <dt>Empresa</dt>
                <dd>{{ lead.employerName || 'Não informada' }}</dd>
              </template>
              <dt>Vínculo declarado</dt>
              <dd>{{ label(EMPLOYMENT_TYPES, lead.employmentType) }}</dd>
              <template v-if="lead.jobTenure !== undefined">
                <dt>Tempo no emprego</dt>
                <dd>{{ label(JOB_TENURES, lead.jobTenure) }}</dd>
              </template>
              <template v-if="lead.incomeRange !== undefined">
                <dt>Salário líquido</dt>
                <dd>{{ label(INCOME_RANGES, lead.incomeRange) }}</dd>
              </template>
              <template v-if="lead.city !== undefined || lead.uf !== undefined">
                <dt>Cidade / UF</dt>
                <dd>{{ place || '—' }}</dd>
              </template>
              <dt>Quer entender</dt>
              <dd>{{ lead.interestTopic ? label(INTEREST_TOPICS, lead.interestTopic) : 'Não informado' }}</dd>
              <dt>Origem</dt>
              <dd>{{ sourceLabel(lead.source) }}</dd>
              <dt>Campanha</dt>
              <dd>
                <template v-if="lead.utmSource || lead.utmCampaign">
                  <span class="admin-mono">{{ [lead.utmSource, lead.utmCampaign].filter(Boolean).join(' · ') }}</span>
                </template>
                <template v-else>Sem parâmetros de campanha</template>
              </dd>
            </dl>
            <p class="field__hint lead-detail__note">
              Empresa, vínculo e faixas são autodeclarados. Não confirmam elegibilidade, margem ou aprovação de crédito.
            </p>
          </section>

          <section
            v-if="lead.pendingSubmissions !== undefined"
            ref="submissionsPanel"
            class="admin-panel"
            aria-labelledby="submissoes-titulo"
          >
            <div class="admin-panel__head">
              <h2 id="submissoes-titulo" ref="submissionsHeading" tabindex="-1">Submissões em revisão</h2>
              <p>{{ submissions.length === 1 ? '1 aguardando revisão' : `${submissions.length} aguardando revisão` }}</p>
            </div>
            <p class="field__hint lead-detail__hint">
              Novos envios para o mesmo CPF ou telefone ficam guardados à parte, cifrados, e não mudam o cadastro. Só a Bia (com o
              telefone atestado) ou a equipe de privacidade alteram os dados.
            </p>
            <p v-if="canReview && submissions.length" class="field__hint lead-detail__hint">
              Aplicar copia para o cadastro os dados cadastrais da submissão: nome, CPF, e-mail, empresa, vínculo, tempo no emprego,
              faixa de salário líquido, cidade/UF e tema de interesse. <strong>O telefone e as preferências de comunicação nunca mudam
              por aqui</strong>: a pessoa altera pela Bia ou pelo link de preferências. Aplicar e descartar pedem justificativa e ficam na
              auditoria.
            </p>
            <!-- Sem role="status": a confirmação é anunciada pela região viva persistente (useAnnouncer). -->
            <p v-if="reviewFeedback" class="notice notice--success lead-detail__review-feedback">
              <AppIcon name="check-circle" />
              <span>{{ reviewFeedback }}</span>
            </p>
            <div v-if="reviewStale" class="notice notice--error lead-detail__review-feedback" role="alert">
              <AppIcon name="alert" />
              <p>{{ reviewStale }} A lista foi atualizada.</p>
            </div>
            <ul v-if="submissions.length" class="lead-detail__subs">
              <li v-for="sub in submissions" :key="sub.id">
                <p class="lead-detail__sub-head">
                  <strong>{{ label(SUBMISSION_REASONS, sub.reason) }}</strong>
                  <span class="muted">
                    <time :datetime="sub.createdAt">{{ formatDateTime(sub.createdAt) }}</time> ·
                    {{ label(SUBMISSION_CHANNELS, sub.channel) }} · origem {{ sourceLabel(sub.source) }}
                  </span>
                </p>
                <div v-if="differences(sub).length" class="admin-table-wrap lead-detail__diff-wrap" tabindex="0" role="region" :aria-label="`Diferenças da submissão de ${formatDateTime(sub.createdAt)}`">
                  <table class="admin-table lead-detail__diff">
                    <caption class="visually-hidden">Campos que diferem do cadastro atual</caption>
                    <thead>
                      <tr>
                        <th scope="col">Campo</th>
                        <th scope="col">Cadastro atual</th>
                        <th scope="col">Submissão</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="d in differences(sub)" :key="d.label">
                        <th scope="row">{{ d.label }}</th>
                        <td>{{ d.current }}</td>
                        <td>{{ d.sent }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p v-else class="lead-detail__sub-fields">
                  {{ sub.data ? 'Mesmos dados do cadastro atual.' : 'Conteúdo indisponível para leitura.' }}
                </p>

                <div v-if="canReview" class="lead-detail__review">
                  <div v-if="canApply(sub) && sub.reason === 'existing_cpf'" class="notice notice--pending lead-detail__review-alert">
                    <AppIcon name="alert" />
                    <p>O telefone desta submissão é diferente do cadastrado e não é validado; confirme com a pessoa antes de aplicar.</p>
                  </div>
                  <p v-else-if="canApply(sub) && swapsCpf(sub)" class="lead-detail__review-note">
                    <AppIcon name="info" />
                    <span>Aplicar troca o CPF do cadastro pelo CPF desta submissão.</span>
                  </p>
                  <p v-if="!canApply(sub)" class="lead-detail__review-note">
                    <AppIcon name="info" />
                    <span>{{ lead.anonymized ? 'Cadastro anonimizado: a submissão só pode ser descartada.' : discardOnlyReason(sub) }}</span>
                  </p>

                  <InlineReasonForm
                    v-if="review?.id === sub.id"
                    :key="review.action"
                    :title="REVIEW_COPY[review.action].title"
                    :confirm-label="REVIEW_COPY[review.action].confirm"
                    :busy-label="REVIEW_COPY[review.action].busy"
                    :busy="reviewBusy"
                    :error="reviewError"
                    :field-error="reviewFieldError"
                    @submit="submitReview"
                    @cancel="cancelReview"
                  >
                    <p>{{ REVIEW_COPY[review.action].text }}</p>
                  </InlineReasonForm>
                  <div v-else class="cluster lead-detail__review-actions">
                    <button
                      v-if="canApply(sub)"
                      type="button"
                      class="btn btn--primary btn--sm"
                      :data-review="`${sub.id}:apply`"
                      :aria-disabled="reviewBusy ? 'true' : undefined"
                      @click="openReview(sub, 'apply')"
                    >
                      Aplicar ao cadastro<span class="visually-hidden"> (submissão de {{ formatDateTime(sub.createdAt) }})</span>
                    </button>
                    <button
                      type="button"
                      class="btn btn--secondary btn--sm"
                      :data-review="`${sub.id}:discard`"
                      :aria-disabled="reviewBusy ? 'true' : undefined"
                      @click="openReview(sub, 'discard')"
                    >
                      Descartar<span class="visually-hidden"> (submissão de {{ formatDateTime(sub.createdAt) }})</span>
                    </button>
                  </div>
                </div>
              </li>
            </ul>
            <p v-else class="muted">Nenhuma submissão aguardando revisão.</p>
            <p v-if="!canReview && submissions.length" class="field__hint lead-detail__review-readonly">
              Seu perfil só consulta as submissões. Aplicar ou descartar exige a permissão de privacidade.
            </p>
          </section>

          <section class="admin-panel" aria-labelledby="finalidades-titulo">
            <h2 id="finalidades-titulo">Finalidades de comunicação</h2>
            <ul class="lead-detail__purposes">
              <li v-for="key in ['launch_notice', 'marketing'] as const" :key="key">
                <AppIcon :name="lead.purposes[key] ? 'check-circle' : 'close'" />
                <span>
                  <strong>{{ PURPOSES[key] }}</strong>
                  {{ lead.purposes[key] ? 'Autorizada pelo titular' : 'Não autorizada ou revogada' }}
                </span>
              </li>
            </ul>
            <p class="field__hint">As escolhas do titular prevalecem sobre ações da equipe.</p>
          </section>

          <section class="admin-panel" aria-labelledby="trilha-titulo">
            <div class="admin-panel__head">
              <h2 id="trilha-titulo">Trilha de eventos</h2>
              <p>Mais recentes primeiro</p>
            </div>
            <ol v-if="events.length" class="admin-timeline">
              <li v-for="(e, i) in events" :key="`${e.at}-${i}`">
                <span class="admin-timeline__title">{{ label(LEAD_EVENTS, e.type) }}</span>
                <span v-if="eventDetail(e)" class="lead-detail__event">{{ eventDetail(e) }}</span>
                <span class="admin-timeline__meta">
                  <time :datetime="e.at">{{ formatDateTime(e.at) }}</time> · {{ label(ACTOR_TYPES, e.actorType) }} · via {{ sourceLabel(e.source) }}
                </span>
              </li>
            </ol>
            <p v-else class="muted">Nenhum evento registrado.</p>
          </section>
        </div>

        <div>
          <section class="admin-panel lead-detail__contact" aria-labelledby="contato-titulo">
            <h2 id="contato-titulo" ref="contactHeading" tabindex="-1">Contato e documento</h2>
            <dl v-if="!revealed" class="lead-detail__ids">
              <dt>WhatsApp</dt>
              <dd><span class="admin-mono">{{ lead.phoneHint }}</span> <span class="visually-hidden">(mascarado)</span></dd>
              <template v-if="lead.cpfHint !== undefined">
                <dt>CPF</dt>
                <dd><span class="admin-mono">{{ lead.cpfHint || '—' }}</span> <span class="visually-hidden">(mascarado)</span></dd>
              </template>
              <template v-if="lead.emailHint !== undefined">
                <dt>E-mail</dt>
                <dd>
                  <span v-if="lead.emailHint" class="admin-mono">{{ lead.emailHint }}</span>
                  <template v-else>Não informado</template>
                </dd>
              </template>
            </dl>
            <!-- Recebe o foco ao revelar (e é lido nesse momento); por isso não é região viva. -->
            <div v-else ref="revealedEl" class="lead-detail__revealed" tabindex="-1">
              <dl class="lead-detail__ids">
                <dt>WhatsApp</dt>
                <dd><span class="admin-mono">{{ formatPhoneBr(revealed.phone) }}</span></dd>
                <template v-if="revealed.cpf !== undefined">
                  <dt>CPF</dt>
                  <dd><span class="admin-mono">{{ revealed.cpf || '—' }}</span></dd>
                </template>
                <template v-if="revealed.email !== undefined">
                  <dt>E-mail</dt>
                  <dd>
                    <span v-if="revealed.email" class="admin-mono">{{ revealed.email }}</span>
                    <template v-else>Não informado</template>
                  </dd>
                </template>
              </dl>
              <p class="field__hint">Revelado agora e registrado na auditoria. Não copie para planilhas ou canais não autorizados.</p>
              <button type="button" class="btn btn--secondary btn--sm" @click="hideContact">
                <AppIcon name="lock" />
                Ocultar contato
              </button>
            </div>
            <p class="lead-detail__verified">
              <AppIcon :name="lead.contactVerifiedAt ? 'check-circle' : 'clock'" />
              <span v-if="lead.contactVerifiedAt">Telefone validado pela Bia em {{ formatDateTime(lead.contactVerifiedAt) }}.</span>
              <span v-else>Telefone não validado: a pessoa ainda não conversou com a Bia pelo WhatsApp.</span>
            </p>
            <template v-if="!revealed && !lead.anonymized">
              <button
                v-if="session.can('leads:read_contact')"
                ref="revealButton"
                type="button"
                class="btn btn--secondary btn--sm"
                @click="revealOpen = true"
              >
                <AppIcon name="eye" />
                Revelar contato
              </button>
              <p v-else class="field__hint">Seu perfil vê apenas os dados mascarados.</p>
            </template>
          </section>

          <section v-if="session.can('privacy:manage')" class="admin-panel" aria-labelledby="privacidade-titulo">
            <h2 id="privacidade-titulo">Pedido do titular</h2>
            <p class="field__hint lead-detail__hint">Recebeu um pedido de acesso, correção, eliminação ou revogação por outro canal? Registre e cumpra pela área de privacidade.</p>
            <RouterLink :to="{ name: 'admin-privacidade', query: { novo: '1', leadId: lead.id } }" class="btn btn--secondary btn--sm">
              <AppIcon name="shield" />
              Registrar pedido de privacidade
            </RouterLink>
          </section>

          <p class="lead-detail__id">
            Identificador: <code class="admin-mono">{{ lead.id }}</code>
          </p>
        </div>
      </div>
    </template>

    <ReasonDialog
      v-model:open="revealOpen"
      title="Revelar o contato"
      confirm-label="Revelar contato"
      busy-label="Revelando…"
      :busy="revealBusy"
      :error="revealError"
      :return-focus="() => revealedEl ?? revealButton"
      @submit="reveal"
    >
      <p>Telefone, e-mail e CPF completos aparecem só nesta tela e somem ao sair dela. Use-os apenas para a finalidade informada.</p>
    </ReasonDialog>
  </div>
</template>

<style scoped>
.lead-detail__sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-top: 6px !important;
}

.lead-detail__anon {
  margin-bottom: var(--mf-space-4);
  align-items: center;
}

.lead-detail__note {
  margin-top: var(--mf-space-3);
}

.lead-detail__purposes {
  display: grid;
  gap: 10px;
  list-style: none;
  margin: 0 0 var(--mf-space-2);
  padding: 0;
  font-size: 0.9375rem;
}

.lead-detail__purposes li {
  display: flex;
  gap: 10px;
  margin: 0;
}

.lead-detail__purposes .icon {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  color: var(--mf-forest);
}

.lead-detail__purposes strong {
  display: block;
}

.lead-detail__event {
  display: block;
  font-size: 0.9375rem;
}

.lead-detail__contact {
  display: grid;
  gap: 10px;
  justify-items: start;
}

.lead-detail__contact h2 {
  margin: 0;
}

.lead-detail__ids {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 14px;
  margin: 0;
  align-items: baseline;
}

.lead-detail__ids dt {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--mf-muted);
}

.lead-detail__ids dd {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.lead-detail__verified {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 0;
  font-size: 0.9375rem;
}

.lead-detail__verified .icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  color: var(--mf-forest);
}

.lead-detail__subs {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.lead-detail__subs li {
  min-width: 0;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--mf-border);
  border-radius: 10px;
}

.lead-detail__sub-head {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  align-items: center;
  margin: 0 0 4px;
  font-size: 0.9375rem;
}

.lead-detail__sub-fields {
  margin: 0;
  font-size: 0.9375rem;
}

.lead-detail__diff-wrap {
  margin-top: 6px;
}

.lead-detail__diff {
  font-size: 0.875rem;
}

.lead-detail__diff td {
  overflow-wrap: anywhere;
}

.lead-detail__revealed {
  display: grid;
  gap: 8px;
  justify-items: start;
  border-radius: 8px;
}

.lead-detail__revealed:focus {
  outline: 3px solid var(--mf-focus);
  outline-offset: 4px;
}

#contato-titulo:focus,
#submissoes-titulo:focus {
  outline: none;
}

#submissoes-titulo:focus-visible {
  outline: 3px solid var(--mf-focus);
  outline-offset: 2px;
}

.lead-detail__revealed p {
  margin: 0;
}

.lead-detail__hint {
  margin-bottom: var(--mf-space-3);
}

/* Revisão das submissões ------------------------------------------------------------------------ */
.lead-detail__review-feedback {
  margin-bottom: var(--mf-space-3);
  align-items: center;
}

.lead-detail__review {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.lead-detail__review-alert {
  padding: 10px 12px;
}

.lead-detail__review-note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 0;
  font-size: 0.9375rem;
}

.lead-detail__review-note .icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  color: var(--mf-forest);
}

.lead-detail__review .inline-reason {
  margin-top: 0;
}

.lead-detail__review-readonly {
  margin-top: var(--mf-space-3);
}

.lead-detail__id {
  margin: var(--mf-space-3) 0 0;
  font-size: 0.8125rem;
  color: var(--mf-muted);
}
</style>
