<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '../../api/http';
import type { Row } from '@studio/shared';
import AppIcon from '../../components/AppIcon.vue';
import EmptyState from '../../components/EmptyState.vue';
import MarkdownContent from '../../components/MarkdownContent.vue';
const route = useRoute(),
  router = useRouter(),
  rows = ref<Row[]>([]),
  loading = ref(true),
  error = ref('');
const section = computed(() => route.path.split('/')[1]);
const copy = computed(
  () =>
    ({
      apps: {
        title: '应用中心',
        tag: 'APPLICATIONS',
        description: '把 AI 能力融入日常，发现更轻松的创作方式。',
        icon: 'grid',
      },
      skills: {
        title: '技能中心',
        tag: 'SKILL LIBRARY',
        description: '选择一个好用的提示词模板，让创作更快一步。',
        icon: 'book',
      },
      updates: {
        title: '更新日志',
        tag: 'WHAT’S NEW',
        description: '记录每一次改进，与创作一起生长。',
        icon: 'history',
      },
    })[section.value] || {
      title: '内容',
      tag: '',
      description: '',
      icon: 'grid',
    },
);
const filtered = computed(() =>
  route.params.slug ? rows.value.filter((r) => r.slug === route.params.slug) : rows.value,
);
onMounted(async () => {
  try {
    rows.value = (await api.get<Row[]>('/admin/api/' + section.value)).data;
    if (section.value === 'updates')
      rows.value.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
});
function open(row: Row) {
  if (section.value === 'skills') {
    void router.push({
      path: '/create',
      query: {
        prompt: String(row.prompt_template || ''),
        model: String(row.model_id || ''),
      },
    });
    return;
  }
  const cfg = (row.config || {}) as Record<string, string>;
  if (cfg.link && /^https?:\/\//.test(cfg.link)) {
    window.open(cfg.link, '_blank', 'noopener,noreferrer');
    return;
  }
  if (cfg.model_id)
    void router.push({
      path: '/create',
      query: { model: cfg.model_id, prompt: cfg.prompt_template || '' },
    });
  else if (!route.params.slug) void router.push('/apps/' + row.slug);
}
</script>
<template>
  <div class="page content-page">
    <header class="page-header">
      <span class="eyebrow">{{ copy.tag }}</span>
      <h1>{{ copy.title }}</h1>
      <p>{{ copy.description }}</p>
    </header>
    <p v-if="error" class="notice warning">{{ error }}</p>
    <div v-if="loading" class="skeleton" />
    <template v-else-if="section === 'updates'">
      <div class="timeline">
        <article v-for="item in rows" :key="item.id">
          <span class="timeline-dot" />
          <time>
            {{
              new Date(String(item.published_at)).toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })
            }}
          </time>
          <div class="card">
            <h2>{{ item.title }}</h2>
            <MarkdownContent :text="String(item.content_md || '')" />
          </div>
        </article>
      </div>
    </template>
    <div v-else class="content-grid">
      <article v-for="row in filtered" :key="row.id" class="card content-card">
        <img
          v-if="row.cover"
          :src="String(row.cover)"
          :alt="String(row.name)"
          class="content-cover"
        />
        <div v-else class="content-icon">
          <img v-if="row.icon" :src="String(row.icon)" alt="" />
          <AppIcon v-else :name="copy.icon" :size="26" />
        </div>
        <div class="between">
          <h2>{{ row.name }}</h2>
          <span v-if="row.status === 'coming_soon'" class="badge">即将上线</span>
        </div>
        <p>{{ row.desc }}</p>
        <button class="button" :disabled="row.status === 'coming_soon'" @click="open(row)">
          {{
            row.status === 'coming_soon'
              ? '敬请期待'
              : section === 'skills'
                ? '使用技能'
                : '打开应用'
          }}
          <AppIcon name="arrow" :size="15" />
        </button>
      </article>
    </div>
    <EmptyState
      v-if="!loading && !filtered.length"
      :icon="copy.icon"
      title="更多内容，正在准备"
      description="内容发布后会出现在这里，欢迎稍后再来看看。"
    />
  </div>
</template>
<style scoped>
.content-page {
  padding-bottom: 40px;
}
.content-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.content-card h2 {
  font-size: 17px;
}
.content-card > p {
  font-size: 12px;
  min-height: 40px;
}
.content-card .button {
  margin-top: auto;
  font-size: 12px;
}
.content-icon {
  width: 52px;
  height: 52px;
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: 14px;
  display: grid;
  place-items: center;
}
.content-icon img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}
.content-cover {
  aspect-ratio: 16/9;
  object-fit: cover;
  border-radius: 9px;
}
.timeline {
  max-width: 850px;
  padding-left: 30px;
  border-left: 1px solid var(--hairline);
  margin-left: 6px;
}
.timeline article {
  position: relative;
  margin-bottom: 35px;
}
.timeline-dot {
  position: absolute;
  left: -35px;
  top: 7px;
  width: 9px;
  height: 9px;
  background: var(--accent);
  border-radius: 50%;
  box-shadow: 0 0 0 6px var(--app-bg);
}
.timeline time {
  font-size: 12px;
  color: var(--fg-3);
  display: block;
  margin-bottom: 13px;
}
.timeline h2 {
  font-size: 20px;
}
.timeline .card {
  padding: 25px;
}
</style>
