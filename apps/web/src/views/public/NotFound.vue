<script setup lang="ts">
import EmptyState from '../../components/EmptyState.vue';
</script>
<template>
  <div class="page">
    <EmptyState
      title="页面不存在"
      description="这个地址可能已经变更，返回首页继续探索。"
      icon="search"
    >
      <RouterLink class="button primary" to="/">返回首页</RouterLink>
    </EmptyState>
  </div>
</template>
