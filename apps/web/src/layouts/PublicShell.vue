<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApp } from '../stores/app';
import AppIcon from '../components/AppIcon.vue';
const app = useApp(),
  route = useRoute(),
  router = useRouter();
const collapsed = ref(localStorage.getItem('studio-collapsed') === 'true'),
  mobileOpen = ref(false),
  accountOpen = ref(false);
const groups = [
  {
    title: '创作工具',
    links: [
      ['创作中心', '/create', 'sparkles'],
      ['模型体验', '/user', 'sliders'],
      ['技能中心', '/skills', 'book'],
      ['应用中心', '/apps', 'grid'],
    ],
  },
  {
    title: '模型与 API',
    links: [
      ['模型广场', '/model-square', 'layers'],
      ['文档中心', '/docs', 'code'],
    ],
  },
  { title: '运行记录', links: [['实时监控', '/status', 'activity']] },
];
const workspace = computed(() => route.path.startsWith('/create'));
watch(
  () => route.fullPath,
  () => {
    mobileOpen.value = false;
    accountOpen.value = false;
  },
);
watch(collapsed, (value) => localStorage.setItem('studio-collapsed', String(value)));
async function logout() {
  await app.logout();
  await router.push('/');
}
</script>
<template>
  <div class="public-shell" :class="{ 'rail-collapsed': collapsed, 'workspace-layout': workspace }">
    <header class="mobile-header">
      <button class="icon-button" aria-label="打开导航" @click="mobileOpen = true">
        <AppIcon name="menu" />
      </button>
      <RouterLink to="/">{{ app.site.title }}</RouterLink>
      <button class="icon-button" aria-label="切换主题" @click="app.toggleTheme">
        <AppIcon name="sun" />
      </button>
    </header>
    <div v-if="mobileOpen" class="rail-backdrop" @click="mobileOpen = false" />
    <aside class="public-rail" :class="{ open: mobileOpen }" aria-label="工作空间导航">
      <div class="rail-brand">
        <RouterLink to="/" :aria-label="`${app.site.title}首页`">
          <img v-if="app.site.logo" :src="app.site.logo" alt="" />
          <span v-else class="brand-mark"><AppIcon name="sparkles" :size="24" /></span>
          <b>{{ app.site.title }}</b>
        </RouterLink>
        <button
          class="icon-button collapse-button"
          :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
          @click="collapsed = !collapsed"
        >
          <AppIcon name="panel" :size="16" />
        </button>
        <button class="icon-button mobile-close" aria-label="关闭导航" @click="mobileOpen = false">
          <AppIcon name="x" />
        </button>
      </div>
      <nav>
        <section v-for="group in groups" :key="group.title">
          <h2>{{ group.title }}</h2>
          <RouterLink
            v-for="[label, path, icon] in group.links"
            :key="path"
            :to="path"
            :title="label"
            :class="{
              active: route.path === path || (path === '/docs' && route.path.startsWith('/docs/')),
            }"
          >
            <AppIcon :name="icon" />
            <span>{{ label }}</span>
          </RouterLink>
        </section>
      </nav>
      <div class="rail-bottom">
        <div v-if="accountOpen" class="account-menu">
          <template v-if="app.user">
            <RouterLink to="/user">
              <AppIcon name="user" />
              个人中心
            </RouterLink>
            <RouterLink to="/api-keys">
              <AppIcon name="key" />
              API Key
            </RouterLink>
            <RouterLink v-if="app.user.role === 'admin'" to="/admin/overview">
              <AppIcon name="shield" />
              管理后台
            </RouterLink>
            <button @click="logout">
              <AppIcon name="logout" />
              退出登录
            </button>
          </template>
          <RouterLink v-else to="/login">
            <AppIcon name="user" />
            登录 / 注册
          </RouterLink>
          <button @click="app.toggleTheme">
            <AppIcon name="sun" />
            切换明暗主题
          </button>
          <RouterLink to="/updates">
            <AppIcon name="history" />
            更新日志
          </RouterLink>
        </div>
        <button
          class="account-card"
          :aria-expanded="accountOpen"
          aria-label="账户菜单"
          @click="accountOpen = !accountOpen"
        >
          <span class="avatar">{{ app.user?.username?.slice(0, 1) || '访' }}</span>
          <span>
            <b>{{ app.user?.username || '登录账户' }}</b>
            <small>{{ app.user ? `${app.user.credits.toLocaleString()} 积分` : '开始创作' }}</small>
          </span>
          <AppIcon name="down" :size="12" />
        </button>
      </div>
    </aside>
    <main class="public-content"><slot /></main>
  </div>
</template>
