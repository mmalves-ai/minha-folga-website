<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import copy from '@content/pages/formularios.yaml'
import AppIcon from '@/components/ui/AppIcon.vue'
import AntiBotTrap from '@/components/forms/AntiBotTrap.vue'
import { useFormProof } from '@/composables/useFormProof'
import { maskPhoneInput, normalizeBrazilianMobile } from '@/lib/phone'
import { api, ApiError } from '@/services/api'
import { errorMessage, focusAndReveal, stripCountryPrefix } from './form-helpers'

/**
 * "Pedir saída das comunicações" sem link de preferências (decisão D1):
 * POST /api/preferences/opt-out { phone, antiBot } → 202 genérico. A tela nunca revela se o número
 * está cadastrado nem mostra dados. Com o campo-armadilha preenchido (robô), nada é enviado e a
 * resposta visível é a mesma. Se a prova for recusada (`form_expired`), reenvia uma vez.
 */
withDefaults(defineProps<{ headingLevel?: 2 | 3 }>(), { headingLevel: 2 })

const t = copy.optOut
const f = copy.waitlist.phone
const uid = useId()
const antiBot = useFormProof()

const phone = ref('')
const trap = ref('')
const touched = ref(false)
const submitted = ref(false)
const submitting = ref(false)
const serverError = ref('')
const generalError = ref('')
const status = ref('')
const done = ref(false)
const phoneInput = ref<HTMLInputElement | null>(null)
const generalErrorEl = ref<HTMLElement | null>(null)
const doneEl = ref<HTMLElement | null>(null)

const clientError = computed(() => {
  if (!phone.value.trim()) return f.required
  return normalizeBrazilianMobile(phone.value) ? null : f.invalid
})
const shownError = computed(() => serverError.value || (touched.value || submitted.value ? clientError.value : null))

function onInput(event: Event) {
  const el = event.target as HTMLInputElement
  phone.value = maskPhoneInput(stripCountryPrefix(el.value))
  el.value = phone.value
  serverError.value = ''
}

function proofRejected(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false
  const keys = Object.keys(e.fields)
  return e.code === 'form_expired' || (e.code === 'validation_error' && keys.length > 0 && keys.every((k) => k.startsWith('antiBot')))
}

async function sendOnce(number: string) {
  const proof = await antiBot.take()
  try {
    await api('/preferences/opt-out', { method: 'POST', body: { phone: number, antiBot: proof } })
  } catch (e) {
    antiBot.renew()
    throw e
  }
}

async function showDone() {
  status.value = ''
  done.value = true
  await nextTick()
  // O formulário saiu da tela: o foco vai para a confirmação (lida ao receber o foco).
  focusAndReveal(doneEl.value)
}

async function submit() {
  if (submitting.value) return
  submitted.value = true
  generalError.value = ''
  if (clientError.value) {
    await nextTick()
    phoneInput.value?.focus()
    return
  }
  submitting.value = true
  status.value = copy.common.submitting
  try {
    // Campo-armadilha preenchido: mesma resposta visível, sem chamar a API.
    if (!trap.value) {
      const number = normalizeBrazilianMobile(phone.value)!
      try {
        await sendOnce(number)
      } catch (e) {
        if (!proofRejected(e)) throw e
        await sendOnce(number)
      }
    }
    await showDone()
  } catch (e) {
    status.value = ''
    if (e instanceof ApiError && e.code === 'validation_error' && e.fields.phone) {
      serverError.value = e.fields.phone
      await nextTick()
      phoneInput.value?.focus()
      return
    }
    generalError.value =
      e instanceof ApiError && e.code === 'rate_limited'
        ? copy.common.rateLimited
        : proofRejected(e)
          ? copy.waitlist.formExpired
          : errorMessage(e)
    await nextTick()
    generalErrorEl.value?.focus()
  } finally {
    submitting.value = false
  }
}

async function another() {
  done.value = false
  phone.value = ''
  touched.value = false
  submitted.value = false
  await nextTick()
  phoneInput.value?.focus()
}

const hintId = `${uid}-phone-dica`
const phoneMax = 16
</script>

<template>
  <section class="optout" :aria-labelledby="`${uid}-titulo`">
    <component :is="`h${headingLevel}`" :id="`${uid}-titulo`" class="optout__title">{{ t.title }}</component>

    <div v-if="done" ref="doneEl" class="notice notice--success optout__done" tabindex="-1">
      <AppIcon name="check-circle" />
      <div>
        <p>{{ t.done }}</p>
        <p>
          <button type="button" class="btn btn--secondary btn--sm optout__another" @click="another">{{ t.another }}</button>
        </p>
      </div>
    </div>

    <template v-else>
      <p>{{ t.text }}</p>
      <form class="form" novalidate @submit.prevent="submit" @focusin="antiBot.prepare()">
        <div class="field">
          <label :for="`${uid}-phone`" class="field__label">{{ f.label }}</label>
          <p :id="hintId" class="field__hint">{{ f.hint }}</p>
          <div class="optout__row">
            <input
              :id="`${uid}-phone`"
              ref="phoneInput"
              :value="phone"
              class="input"
              type="tel"
              name="phone"
              inputmode="tel"
              autocomplete="tel-national"
              :maxlength="phoneMax"
              required
              :aria-invalid="shownError ? 'true' : 'false'"
              :aria-describedby="[hintId, `${uid}-privacidade`, shownError ? `${uid}-phone-erro` : ''].filter(Boolean).join(' ')"
              @input="onInput"
              @blur="touched = true"
            />
            <button type="submit" class="btn btn--primary" :aria-disabled="submitting ? 'true' : 'false'">
              <span v-if="submitting" class="spinner" aria-hidden="true" />
              {{ submitting ? copy.common.submitting : t.submit }}
            </button>
          </div>
          <p v-if="shownError" :id="`${uid}-phone-erro`" class="field__error"><AppIcon name="alert" /><span>{{ shownError }}</span></p>
        </div>
        <AntiBotTrap v-model="trap" name="website" />
        <div v-if="generalError" ref="generalErrorEl" class="notice notice--error" role="alert" tabindex="-1">
          <AppIcon name="alert" />
          <p>{{ generalError }}</p>
        </div>
        <p :id="`${uid}-privacidade`" class="small muted optout__privacy">
          <AppIcon name="lock" />
          <span>{{ t.privacy }}</span>
        </p>
      </form>
    </template>
    <p class="visually-hidden" role="status" aria-live="polite">{{ status }}</p>
  </section>
</template>

<style scoped>
.optout {
  position: relative;
}

.optout__title {
  font-size: clamp(1.375rem, 1vw + 1rem, 1.75rem);
}

.optout__row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.optout__row .input {
  flex: 1 1 220px;
  max-width: 320px;
  min-width: 0;
}

.optout__another {
  margin-top: 8px;
  text-align: left;
}

.optout__privacy {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 0;
}

.optout__privacy .icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
}

.optout__done:focus,
.notice:focus {
  outline: 3px solid var(--mf-focus);
  outline-offset: 2px;
}

@media (max-width: 479px) {
  .optout__row .input,
  .optout__row .btn {
    flex: 1 1 100%;
    max-width: none;
  }
}
</style>
