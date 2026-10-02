<script setup lang="ts">
import BrandLogo from '@/components/site/BrandLogo.vue'
import { formatPhoneBr } from '@/lib/format'
import { availability, publicConfig, site } from '@/services/site'
import type { LinkItem } from '@/types/content'

const groups = site.footer.groups as { title: string; links: LinkItem[] }[]
const id = publicConfig.identity
const year = new Date().getFullYear()

// Dado empresarial ausente só é possível em builds não publicáveis (o release estrito falha antes).
const pending = (label: string) => `[pendente: ${label}]`

function openCookieSettings() {
  window.dispatchEvent(new CustomEvent('mf:open-cookie-settings'))
}
</script>

<template>
  <footer class="site-footer on-dark">
    <div class="container">
      <div class="site-footer__top">
        <div class="site-footer__brand">
          <BrandLogo variant="reverse" :width="168" />
          <p class="site-footer__promise">{{ site.brand.promise }}</p>
        </div>

        <nav class="site-footer__nav" aria-label="Rodapé">
          <div v-for="group in groups" :key="group.title" class="site-footer__group">
            <h2 class="site-footer__title">{{ group.title }}</h2>
            <ul>
              <li v-for="link in group.links" :key="link.to">
                <RouterLink :to="link.to">{{ link.label }}</RouterLink>
              </li>
              <li v-if="group.title === 'Informações legais' && publicConfig.analyticsEnabled">
                <button type="button" class="site-footer__linkbutton" @click="openCookieSettings">Preferências de cookies</button>
              </li>
            </ul>
          </div>
        </nav>
      </div>

      <div class="site-footer__status" role="note" aria-label="Situação da operação de crédito">
        <p>{{ availability.footer }}</p>
      </div>

      <div class="site-footer__identity">
        <dl>
          <div>
            <dt>Empresa</dt>
            <dd>
              {{ id.tradeName }} ·
              <span :class="{ 'pending-data': !id.legalName }">{{ id.legalName ?? pending('razão social') }}</span>
            </dd>
          </div>
          <div>
            <dt>Controladora dos dados</dt>
            <dd>
              <span :class="{ 'pending-data': !id.legalName }">{{ id.legalName ?? pending('controladora') }}</span>
              — <RouterLink to="/privacidade">Aviso de Privacidade</RouterLink>
            </dd>
          </div>
          <div>
            <dt>Endereço</dt>
            <dd :class="{ 'pending-data': !id.address }">{{ id.address ?? pending('endereço') }}</dd>
          </div>
          <div>
            <dt>Contato</dt>
            <dd>
              <template v-if="id.supportContact">
                <a :href="`mailto:${id.supportContact}`">{{ id.supportContact }}</a>
              </template>
              <span v-else class="pending-data">{{ pending('canal de atendimento') }}</span>
              <template v-if="id.supportPhone"> · {{ formatPhoneBr(id.supportPhone) }}</template>
              · <RouterLink to="/atendimento">Atendimento</RouterLink>
            </dd>
          </div>
        </dl>
      </div>

      <div class="site-footer__bottom">
        <p>© {{ year }} {{ id.tradeName }}. Todos os direitos reservados.</p>
        <ul class="site-footer__quick">
          <li><RouterLink to="/privacidade">Privacidade</RouterLink></li>
          <li><RouterLink to="/termos">Termos</RouterLink></li>
          <li><RouterLink to="/seguranca">Segurança</RouterLink></li>
          <li><RouterLink to="/preferencias">Preferências</RouterLink></li>
          <li><RouterLink to="/atendimento">Atendimento</RouterLink></li>
        </ul>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  background: var(--mf-forest);
  color: var(--mf-cream);
  padding-block: var(--mf-space-7) var(--mf-space-5);
  font-size: 0.9375rem;
}

.site-footer a,
.site-footer__linkbutton {
  color: var(--mf-cream);
  text-decoration: none;
}

.site-footer a:hover,
.site-footer__linkbutton:hover {
  text-decoration: underline;
  color: #fff;
}

.site-footer__top {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 2.2fr);
  gap: var(--mf-space-6);
  padding-bottom: var(--mf-space-6);
  border-bottom: 1px solid rgb(248 246 240 / 18%);
}

.site-footer__promise {
  margin-top: var(--mf-space-3);
  max-width: 26ch;
  font-family: var(--mf-font-heading);
  font-size: 1.125rem;
  line-height: 1.35;
  color: var(--mf-cream);
}

/*
 * Cada grupo ocupa duas linhas da grade (título e lista) em subgrid: títulos que quebram em duas
 * linhas não desalinham as listas dos outros grupos da mesma fileira.
 */
.site-footer__nav {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0 var(--mf-space-4);
}

.site-footer__group {
  display: grid;
  grid-row: span 2;
  grid-template-rows: subgrid;
  row-gap: 8px;
  align-content: start;
}

.site-footer__title {
  align-self: end;
  margin: 0;
  font-family: var(--mf-font-body);
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-cream-on-dark-muted);
}

.site-footer__group ul {
  list-style: none;
  margin: 0 0 var(--mf-space-3);
  padding: 0;
}

.site-footer__group li {
  margin: 0;
}

/* Área de toque de pelo menos 44 × 44 px (seção 12), inclusive em rótulos curtos como "Bia". */
.site-footer__group a,
.site-footer__linkbutton {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  min-width: 44px;
  padding-block: 4px;
  line-height: 1.35;
}

.site-footer__linkbutton {
  padding: 0;
  border: 0;
  background: none;
  font-size: inherit;
  text-align: left;
}

.site-footer__status {
  margin-block: var(--mf-space-5);
  padding: 16px 20px;
  border-radius: 16px;
  background: rgb(248 246 240 / 8%);
  border-left: 4px solid var(--mf-coral);
}

.site-footer__status p {
  margin: 0;
  color: var(--mf-cream);
}

.site-footer__identity dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px 24px;
  margin: 0;
}

.site-footer__identity dt {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--mf-cream-on-dark-muted);
}

.site-footer__identity dd {
  margin: 2px 0 0;
  font-size: 0.875rem;
  line-height: 1.5;
}

.site-footer__identity a {
  text-decoration: underline;
}

.site-footer__bottom {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  margin-top: var(--mf-space-5);
  padding-top: var(--mf-space-4);
  border-top: 1px solid rgb(248 246 240 / 18%);
  font-size: 0.875rem;
  color: var(--mf-cream-on-dark-muted);
}

.site-footer__bottom p {
  margin: 0;
}

.site-footer__quick {
  display: flex;
  flex-wrap: wrap;
  gap: 0 18px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.site-footer__quick li {
  margin: 0;
}

.site-footer__quick a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  min-width: 44px;
}

.pending-data {
  background: #fff1c2;
  color: #4d3a00;
}

/* Até 1199 px a marca fica acima e os grupos em 3 colunas (em 5 colunas os títulos quebravam em 1024 px). */
@media (max-width: 1199px) {
  .site-footer__top {
    grid-template-columns: minmax(0, 1fr);
  }
  .site-footer__nav {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

/* Celular: grupos em duas colunas até as telas mais estreitas, para o rodapé não ocupar várias telas. */
@media (max-width: 767px) {
  .site-footer__nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--mf-space-3);
  }
  /* Grupo ímpar fica sozinho na última fileira: ocupa a largura toda e o título não quebra. */
  .site-footer__group:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }
}

/* Linha inferior em três colunas no celular: 3 + 2 links, sem um link sozinho na segunda linha. */
@media (max-width: 479px) {
  .site-footer__quick {
    display: grid;
    grid-template-columns: repeat(3, max-content);
    column-gap: 20px;
  }
}
</style>
