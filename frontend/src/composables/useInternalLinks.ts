import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { useRouter } from 'vue-router'

/**
 * Conteúdo renderizado de Markdown (v-html) usa <a href="/rota">. Este composable intercepta cliques
 * em links internos para navegar pelo roteador, sem recarregar a página. Links externos seguem normais.
 */
export function useInternalLinks(root: Ref<HTMLElement | null>) {
  const router = useRouter()
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as HTMLElement | null)?.closest('a')
    if (!anchor || !root.value?.contains(anchor)) return
    const href = anchor.getAttribute('href')
    if (!href || !href.startsWith('/') || href.startsWith('//') || anchor.target === '_blank') return
    event.preventDefault()
    void router.push(href)
  }
  onMounted(() => root.value?.addEventListener('click', onClick))
  onBeforeUnmount(() => root.value?.removeEventListener('click', onClick))
}
