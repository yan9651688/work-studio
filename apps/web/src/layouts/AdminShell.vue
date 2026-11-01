<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useApp } from '../stores/app';
import AppIcon from '../components/AppIcon.vue';
const app = useApp(),
  route = useRoute(),
  open = ref(false);
watch(
  () => route.path,
  () => (open.value = false),
);
const groups = [
  ['工作空间', [['数据概览', 'overview', 'chart']]],
  [
    '站点与内容',
    [
      ['站点配置', 'config', 'settings'],
      ['首页入口', 'home-entries', 'grid'],
      ['作品与灵感', 'showcase', 'image'],
      ['文档管理', 'docs', 'book'],
      ['应用中心', 'app-center', 'grid'],
      ['技能中心', 'skills', 'sparkles'],
      ['更新日志', 'updates', 'history'],
    ],
  ],
  [
    '模型与网关',
    [
      ['上游渠道', 'gateway', 'database'],
      ['模型管理', 'models', 'layers'],
      ['模型绑定', 'model-channels', 'link'],
      ['模型分组', 'model-groups', 'grid'],
    ],
  ],
  [
    '用户与计费',
    [
      ['用户管理', 'users', 'users'],
      ['充值套餐', 'billing', 'wallet'],
      ['订单管理', 'orders', 'wallet'],
      ['积分流水', 'credit-usage', 'activity'],
      ['兑换码', 'cdks', 'gift'],
      ['管理员 API Key', 'admin-key', 'key'],
    ],
  ],
  [
    '记录与规则',
    [
      ['生成记录', 'images', 'image'],
      ['请求日志', 'logs', 'code'],
      ['内容规则', 'banned-words', 'shield'],
      ['规则命中', 'banned-word-hits', 'alert'],
      ['管理操作', 'admin-audit', 'history'],
    ],
  ],
] as const;
</script>
<template>
  <div class="admin-shell">
    <div v-if="open" class="rail-backdrop" @click="open = false" />
    <aside class="admin-rail" :class="{ open }">
      <RouterLink class="admin-brand" to="/admin/overview">
        <span class="brand-mark"><AppIcon name="sparkles" :size="23" /></span>
        <span>
          {{ app.site.title }}
          <small>管理控制台</small>
        </span>
      </RouterLink>
      <nav>
        <section v-for="[title, links] in groups" :key="title">
          <h2>{{ title }}</h2>
          <RouterLink
            v-for="[label, path, icon] in links"
            :key="path"
            :to="'/admin/' + path"
            active-class="active"
          >
            <AppIcon :name="icon" :size="17" />
            {{ label }}
          </RouterLink>
        </section>
      </nav>
      <RouterLink class="back-to-site" to="/">
        <AppIcon name="left" />
        返回前台
      </RouterLink>
    </aside>
    <div class="admin-main">
      <header class="admin-top">
        <button class="icon-button mobile-only" aria-label="打开后台菜单" @click="open = true">
          <AppIcon name="menu" />
        </button>
        <span>
          管理控制台
          <span class="muted">/</span>
          {{ route.meta.title }}
        </span>
        <div class="row">
          <button class="icon-button" aria-label="切换主题" @click="app.toggleTheme">
            <AppIcon name="sun" />
          </button>
          <span class="avatar small">{{ app.user?.username.slice(0, 1) }}</span>
        </div>
      </header>
      <main class="admin-content"><slot /></main>
    </div>
  </div>
</template>
