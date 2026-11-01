<script setup lang="ts">
import AppIcon from './AppIcon.vue';
withDefaults(defineProps<{ title?: string; description?: string; icon?: string }>(), {
  title: '这里还没有内容',
  description: '完成第一步后，内容会显示在这里。',
  icon: 'layers',
});
</script>
<template>
  <div class="empty-state">
    <span class="empty-icon"><AppIcon :name="icon" :size="28" /></span>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <slot />
  </div>
</template>
