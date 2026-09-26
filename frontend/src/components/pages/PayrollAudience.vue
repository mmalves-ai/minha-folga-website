<script setup lang="ts">
import page from '@content/pages/consignado-privado.yaml'

/**
 * Público previsto (seção 2): vínculos e situação prevista, sempre separando o interesse
 * autodeclarado do cadastro da elegibilidade confirmada na futura análise. Status em texto, não só cor.
 */
const audience = page.audience
</script>

<template>
  <section id="para-quem" class="section" aria-labelledby="para-quem-titulo">
    <div class="container">
      <div class="section-head">
        <h2 id="para-quem-titulo">{{ audience.title }}</h2>
        <p class="lead">{{ audience.text }}</p>
      </div>

      <p class="audience-note">{{ audience.simpleNote }}</p>
    </div>
  </section>
</template>

<style scoped>
.audience-note { max-width: 68ch; margin: 0; color: var(--mf-muted); }
.audience {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--mf-border);
}

.audience__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 1.4fr);
  gap: var(--mf-space-2) var(--mf-space-4);
  align-items: baseline;
  margin: 0;
  padding-block: var(--mf-space-4);
  border-bottom: 1px solid var(--mf-border);
}

.audience__title {
  margin: 0;
  font-size: 1.125rem;
  line-height: 1.35;
}

.audience__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-self: start;
  margin: 0;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.4;
}

.audience__status .icon {
  flex: none;
  width: 16px;
  height: 16px;
}

.audience__status--included {
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.audience__status--depends {
  background: var(--mf-lilac);
  color: #2f2a45;
}

.audience__status--not_automatic {
  background: var(--mf-paper);
  border: 1px solid var(--mf-control-border);
  color: var(--mf-ink);
}

.audience__text {
  margin: 0;
  color: var(--mf-ink);
}

.audience-compare {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--mf-space-6);
  margin-top: var(--mf-space-6);
}

.audience-compare__col {
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-card);
}

.audience-compare__col--today {
  background: var(--mf-mint);
}

.audience-compare__col--later {
  background: var(--mf-paper);
  border: 1px dashed var(--mf-control-border);
}

.audience-compare__stage {
  margin: 0 0 4px;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.audience-compare__col h3 {
  margin-bottom: var(--mf-space-2);
}

.audience-compare__col ul {
  margin: 0;
}

.audience-compare__arrow {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--mf-forest);
  color: #fff;
  transform: translate(-50%, -50%);
}

.audience-compare__arrow .icon {
  width: 20px;
  height: 20px;
}

@media (max-width: 1023px) {
  .audience__row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .audience__text {
    grid-column: 1 / -1;
  }
}

@media (max-width: 767px) {
  .audience__row {
    grid-template-columns: minmax(0, 1fr);
  }

  .audience-compare {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-5);
  }

  .audience-compare__col {
    padding: var(--mf-space-4);
  }

  .audience-compare__arrow {
    display: none;
  }
}
</style>
