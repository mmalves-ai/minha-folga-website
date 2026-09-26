<script setup lang="ts">
import content from '@content/pages/aquisicao.yaml'
import type { AcquisitionContent } from '@/types/acquisition'
import AppIcon from '@/components/ui/AppIcon.vue'
import { publicConfig } from '@/services/site'
const t = (content as AcquisitionContent).trust
</script>
<template>
  <section class="acquisition-trust" aria-labelledby="confianca-titulo"><div class="container acquisition-trust__inner">
    <div class="acquisition-trust__identity"><img src="/brand/minha-folga-simbolo.svg" alt="" width="48" height="43" loading="lazy" /><div><h2 id="confianca-titulo">{{ t.title }}</h2><p v-if="publicConfig.identity.legalName">{{ publicConfig.identity.legalName }}<template v-if="publicConfig.identity.cnpj"> · {{ t.cnpjLabel }} {{ publicConfig.identity.cnpj }}</template></p><p v-else>{{ t.pendingIdentity }}</p></div></div>
    <div class="acquisition-trust__links"><RouterLink to="/sobre" class="link-arrow">{{ t.aboutLink }} <AppIcon name="arrow-right" /></RouterLink><RouterLink to="/atendimento" class="link-arrow">{{ t.supportLink }} <AppIcon name="arrow-right" /></RouterLink></div>
  </div></section>
</template>
<style scoped>
.acquisition-trust { padding-block: 40px; background: var(--mf-paper); border-top: 1px solid var(--mf-border); }
.acquisition-trust__inner { display: flex; justify-content: space-between; align-items: center; gap: 32px; }
.acquisition-trust__identity { display: flex; gap: 22px; align-items: center; }
.acquisition-trust__identity img { flex: none; }
.acquisition-trust h2 { font-size: 1.125rem; margin-bottom: 8px; }
.acquisition-trust p { font-size: .875rem; color: var(--mf-muted); margin: 0; max-width: 55ch; }
.acquisition-trust__links { display: flex; gap: 24px; flex: none; font-size: .875rem; }
@media (max-width: 1023px) { .acquisition-trust__inner { flex-wrap: wrap; gap: 12px; } }
@media (max-width: 767px) { .acquisition-trust__identity { align-items: start; gap: 16px; } .acquisition-trust__identity img { width: 36px; height: auto; } }
</style>
