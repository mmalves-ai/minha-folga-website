<script setup lang="ts">
import texts from '@content/legal/cookie-consent.yaml'
import { activeTechnologies, type CookieTechnology } from '@/components/legal/legal'
import { publicConfig } from '@/services/site'

/** Inventário das tecnologias que o código desta versão realmente usa, agrupado por categoria. */
const all = texts.technologies as CookieTechnology[]
const active = activeTechnologies(all, publicConfig.analyticsEnabled)

const groups = [
  {
    id: 'essential',
    title: 'Essenciais',
    status: 'Sempre ativos',
    items: active.filter((t) => t.category === 'essential'),
  },
  {
    id: 'measurement',
    title: 'Medição agregada de uso',
    status: 'Opcional, depende da sua escolha',
    items: active.filter((t) => t.category === 'measurement'),
  },
].filter((g) => g.items.length > 0)

/** Nomes técnicos (chave do cookie ou do armazenamento) aparecem como código. */
const isIdentifier = (name: string) => /^[a-z0-9_]+$/.test(name)
</script>

<template>
  <div class="inventory">
    <section v-for="group in groups" :key="group.id" class="inventory__group" :aria-labelledby="`inventario-${group.id}`">
      <div class="inventory__group-head">
        <h3 :id="`inventario-${group.id}`">{{ group.title }}</h3>
        <span class="badge" :class="group.id === 'essential' ? '' : 'badge--lilac'">{{ group.status }}</span>
      </div>

      <ul class="inventory__list">
        <li v-for="item in group.items" :key="item.id" class="inventory__item">
          <div class="inventory__name">
            <h4><code v-if="isIdentifier(item.name)">{{ item.name }}</code><template v-else>{{ item.name }}</template></h4>
            <p>{{ item.kind }} · {{ item.provider }}</p>
          </div>
          <dl class="inventory__facts">
            <div>
              <dt>Para que serve</dt>
              <dd>{{ item.purpose }}</dd>
            </div>
            <div>
              <dt>O que guarda</dt>
              <dd>{{ item.content }}</dd>
            </div>
            <div>
              <dt>Por quanto tempo</dt>
              <dd>{{ item.duration }}</dd>
            </div>
            <div>
              <dt>Detalhes</dt>
              <dd>{{ item.details }}</dd>
            </div>
          </dl>
        </li>
      </ul>
    </section>

    <p v-if="!publicConfig.analyticsEnabled" class="inventory__none">
      Nesta versão, o site não usa tecnologias opcionais. Por isso não há aviso de cookies para aceitar ou recusar, e nada
      é gravado no seu navegador sobre essa escolha.
    </p>
  </div>
</template>

<style scoped>
.inventory {
  display: grid;
  gap: var(--mf-space-5);
}

.inventory__group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-bottom: var(--mf-space-3);
}

.inventory__group-head h3 {
  margin: 0;
  font-size: 1.25rem;
}

.inventory__list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--mf-border);
  border-radius: 20px;
  overflow: hidden;
}

.inventory__item {
  display: grid;
  grid-template-columns: minmax(180px, 0.34fr) minmax(0, 1fr);
  gap: var(--mf-space-4);
  margin: 0;
  padding: var(--mf-space-4);
  background: var(--mf-paper);
}

.inventory__item + .inventory__item {
  margin-top: 0;
  border-top: 1px solid var(--mf-border);
}

.inventory__name h4 {
  margin: 0 0 4px;
  font-size: 1.0625rem;
  overflow-wrap: anywhere;
}

.inventory__name code {
  padding: 2px 8px;
  border-radius: 8px;
  background: var(--mf-mint);
  color: var(--mf-forest);
  font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 0.9375rem;
  font-weight: 600;
}

.inventory__name p {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--mf-muted);
}

.inventory__facts {
  display: grid;
  gap: 10px;
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.55;
}

.inventory__facts div {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 12px;
}

.inventory__facts dt {
  font-weight: 600;
  color: var(--mf-ink);
}

.inventory__facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.inventory__none {
  margin: 0;
  padding: 16px 20px;
  border-radius: 16px;
  background: var(--mf-mint);
  font-size: 1rem;
}

@media (max-width: 767px) {
  .inventory__item {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-2);
    padding: var(--mf-space-3);
  }

  .inventory__facts div {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
}
</style>
