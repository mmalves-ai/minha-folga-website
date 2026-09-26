<script setup lang="ts">
import { computed, onMounted } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import contract from '@contracts/notifications.json'
import { useBrowserNotifications } from '@/composables/useBrowserNotifications'
const props = withDefaults(defineProps<{ manage?: boolean }>(), { manage: false })
const { config, loaded, supported, needsHomeScreen, subscribed, saved, hasBrowserSubscription, interrupted, needsRecovery, busy, message, failed, permission, load, enable, disable } = useBrowserNotifications()
const visible = computed(() => loaded.value && (props.manage || subscribed.value || hasBrowserSubscription.value || Boolean(saved.value) || (config.value?.enabled && (supported.value || needsHomeScreen.value))))
onMounted(() => { void load(true) })
</script>
<template>
  <section v-if="visible" class="browser-notifications" aria-label="Avisos neste aparelho">
    <span class="browser-notifications__icon" aria-hidden="true"><AppIcon name="bell" /></span>
    <div class="browser-notifications__content">
      <h2>{{ manage ? 'Avisos neste aparelho' : 'Quer receber um lembrete por aqui?' }}</h2>
      <p v-if="subscribed">Seus avisos estão ativados neste aparelho. Você pode desativar quando quiser.</p>
      <p v-else-if="needsHomeScreen && !supported">No iPhone ou iPad, abra no Safari e use Compartilhar → Adicionar à Tela de Início. Depois abra a Minha Folga por lá para ativar os avisos.</p>
      <p v-else-if="!supported">Este navegador não recebe esses avisos. Você pode receber a abertura pelo WhatsApp ao se cadastrar.</p>
      <p v-else-if="!config?.enabled && !saved">Os avisos por aqui ainda não estão disponíveis. Você pode se cadastrar para receber a abertura pelo WhatsApp.</p>
      <p v-else-if="permission === 'denied'">Os avisos estão bloqueados. Para ativar, mude a permissão de notificações deste site no seu navegador.</p>
      <p v-else-if="interrupted">Os avisos foram interrompidos neste aparelho. {{ config?.enabled ? 'Você pode reativar ou concluir a desativação.' : 'Toque em desativar para concluir.' }}</p>
      <p v-else-if="needsRecovery">Não conseguimos confirmar a ativação dos avisos. Você pode reativar ou desativar neste aparelho.</p>
      <p v-if="!subscribed && supported && config?.enabled && permission !== 'denied'">{{ contract.consent.text }}</p>
      <div class="browser-notifications__actions">
        <button v-if="saved || subscribed || hasBrowserSubscription" type="button" class="btn btn--secondary btn--sm" :disabled="busy" @click="disable">{{ busy ? 'Aguarde…' : 'Desativar avisos neste aparelho' }}</button>
        <button v-if="!subscribed && supported && config?.enabled && permission !== 'denied'" type="button" class="btn btn--primary btn--sm" :disabled="busy" @click="enable">{{ busy ? 'Aguarde…' : needsRecovery ? 'Reativar avisos neste aparelho' : 'Ativar avisos neste aparelho' }}</button>
        <RouterLink v-if="!manage" to="/preferencias#avisos-navegador">Gerenciar meus avisos</RouterLink>
      </div>
      <p v-if="!manage" class="browser-notifications__note">Ativar avisos não substitui o cadastro na fila.</p>
      <p v-if="message" :role="failed ? 'alert' : 'status'" class="browser-notifications__status">{{ message }}</p>
    </div>
  </section>
</template>
<style scoped>
.browser-notifications { display: flex; align-items: start; gap: 20px; padding: 28px; background: var(--mf-lilac); border-radius: 22px; margin-block: 24px; }
.browser-notifications__icon { width: 44px; height: 44px; flex: none; background: white; border-radius: 50%; display: grid; place-items: center; }
.browser-notifications__icon .icon { width: 22px; height: 22px; }
.browser-notifications h2 { font-size: 1.25rem; margin-bottom: 10px; letter-spacing: -.025em; }
.browser-notifications__content { min-width: 0; }
.browser-notifications__content > p { max-width: 66ch; font-size: .9375rem; margin-bottom: 12px; }
.browser-notifications__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; }
.browser-notifications__actions a { display: inline-flex; min-height: 44px; align-items: center; font-size: .875rem; font-weight: 600; }
.browser-notifications__content p.browser-notifications__note { color: var(--mf-muted); font-size: .8125rem; margin: 10px 0 0; }
.browser-notifications__status { font-weight: 600; margin: 14px 0 0; }
@media (max-width: 767px) {
 .browser-notifications { padding: 20px; gap: 12px; }
 .browser-notifications__icon { width: 32px; height: 32px; }
 .browser-notifications__icon .icon { width: 18px; height: 18px; }
 .browser-notifications h2 { font-size: 1.125rem; }
 .browser-notifications__actions .btn { width: 100%; white-space: normal; text-align: center; }
}
</style>
