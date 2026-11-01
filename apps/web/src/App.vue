<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useApp } from './stores/app';
import { notices } from './api/http';
import PublicShell from './layouts/PublicShell.vue';
import AdminShell from './layouts/AdminShell.vue';
import AppIcon from './components/AppIcon.vue';
const route = useRoute(),
  app = useApp();
const reload = () => window.location.reload();
</script>
<template>
  <div v-if="app.bootError" class="boot">
    <AppIcon name="alert" />
    <p>{{ app.bootError }}</p>
    <button class="button" @click="reload">重新加载</button>
  </div>
  <div v-else-if="!app.ready" class="boot">
    <AppIcon name="loader" class="spin" />
    <span>正在加载…</span>
  </div>
  <component :is="route.path.startsWith('/admin') ? AdminShell : PublicShell" v-else>
    <RouterView v-slot="{ Component }"><component :is="Component" :key="route.path" /></RouterView>
  </component>
  <div class="toasts" aria-live="polite">
    <div v-for="notice in notices" :key="notice.id" class="toast" :class="notice.tone">
      <AppIcon :name="notice.tone === 'error' ? 'alert' : 'check'" />
      {{ notice.text }}
    </div>
  </div>
</template>
