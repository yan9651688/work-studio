<script setup lang="ts">
import { onMounted, onUnmounted, ref, nextTick } from 'vue';
import AppIcon from './AppIcon.vue';
defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
let previous: Element | null = null;
function keys(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
  if (event.key === 'Tab') {
    const nodes = panel.value?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]',
    );
    if (!nodes?.length) return;
    const first = nodes[0],
      last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
onMounted(async () => {
  previous = document.activeElement;
  document.addEventListener('keydown', keys);
  document.body.style.overflow = 'hidden';
  await nextTick();
  panel.value?.querySelector<HTMLElement>('input,button')?.focus();
});
onUnmounted(() => {
  document.removeEventListener('keydown', keys);
  document.body.style.overflow = '';
  if (previous instanceof HTMLElement) previous.focus();
});
</script>
<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <section
        ref="panel"
        class="modal"
        :class="{ wide }"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header>
          <h2>{{ title }}</h2>
          <button class="icon-button" aria-label="关闭" @click="emit('close')">
            <AppIcon name="x" />
          </button>
        </header>
        <div class="modal-body"><slot /></div>
      </section>
    </div>
  </Teleport>
</template>
