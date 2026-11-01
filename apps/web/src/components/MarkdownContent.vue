<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { copy } from '../api/http';
const props = defineProps<{ text: string }>();
const html = computed(() =>
  DOMPurify.sanitize(marked.parse(props.text || '', { async: false }) as string, {
    FORBID_TAGS: ['style', 'iframe', 'form'],
    FORBID_ATTR: ['style'],
  }),
);
function onClick(event: MouseEvent) {
  const el = event.target as HTMLElement;
  const code = el.closest('pre');
  if (code) void copy(code.innerText);
}
</script>
<template>
  <article class="markdown" title="点击代码块可复制" @click="onClick" v-html="html"></article>
</template>
