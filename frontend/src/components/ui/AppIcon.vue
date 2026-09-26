<script setup lang="ts">
/**
 * Ícones de linha, decorativos por padrão (aria-hidden). Quando o ícone carregar significado,
 * passe `label` — e nunca dependa só dele: sempre haja texto ao lado.
 */
const props = defineProps<{
  name:
    | 'arrow-right'
    | 'arrow-left'
    | 'check'
    | 'check-circle'
    | 'chat'
    | 'shield'
    | 'book'
    | 'clock'
    | 'bell'
    | 'info'
    | 'alert'
    | 'menu'
    | 'close'
    | 'search'
    | 'lock'
    | 'user'
    | 'calendar'
    | 'external'
    | 'chevron-down'
    | 'spark'
    | 'phone'
    | 'mail'
    | 'compass'
    | 'layers'
    | 'eye'
    | 'list'
    | 'home'
    | 'hand'
    | 'filter'
    | 'logout'
  label?: string
}>()

const paths: Record<string, string> = {
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  'arrow-left': 'M19 12H5M11 18l-6-6 6-6',
  check: 'M5 12.5l4.5 4.5L19 7',
  'check-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12.5l2.8 2.8L16.5 9.5',
  chat: 'M20 11.5c0 4.1-3.6 7.5-8 7.5-1.2 0-2.4-.3-3.4-.7L4 19.5l1.2-3.7C4.4 14.6 4 13.1 4 11.5 4 7.4 7.6 4 12 4s8 3.4 8 7.5Z',
  shield: 'M12 3 5 6v5.5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3ZM9 12l2 2 4-4',
  book: 'M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5c-.8 0-1.5-.7-1.5-1.5v-13ZM20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5v-13Z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
  alert: 'M12 4 2.8 19.5h18.4L12 4ZM12 10v4.5M12 17h.01',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  lock: 'M6 11h12v9H6v-9ZM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20c1-3.5 4-5.5 7.5-5.5s6.5 2 7.5 5.5',
  calendar: 'M5 6h14v14H5V6ZM5 10h14M9 4v4M15 4v4',
  external: 'M14 5h5v5M19 5l-8 8M17 13.5V19H5V7h5.5',
  'chevron-down': 'm6 9 6 6 6-6',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8',
  phone: 'M8 3h8v18H8V3ZM11 18h2',
  mail: 'M4 6h16v12H4V6ZM4 7l8 6 8-6',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15.5 8.5l-2 5-5 2 2-5 5-2Z',
  layers: 'M12 4 3 9l9 5 9-5-9-5ZM3 14l9 5 9-5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z',
  hand: 'M7 11V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5a1.5 1.5 0 0 1 3 0v5m0 0V6.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7-6.5 7S5 17.5 4.2 15.3L3 12.2a1.5 1.5 0 0 1 2.7-1.2L7 13',
  filter: 'M4 5h16l-6 7.5V19l-4-2v-4.5L4 5Z',
  logout: 'M15 17l5-5-5-5M20 12H9M11 20H5V4h6',
}
</script>

<template>
  <svg
    class="icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="props.label ? 'img' : undefined"
    :aria-label="props.label"
    :aria-hidden="props.label ? undefined : 'true'"
    focusable="false"
  >
    <path :d="paths[props.name]" />
  </svg>
</template>
