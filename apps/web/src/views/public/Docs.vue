<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorMessage, copy } from '../../api/http';
import type { Row } from '@studio/shared';
import MarkdownContent from '../../components/MarkdownContent.vue';
import AppIcon from '../../components/AppIcon.vue';
const route = useRoute(),
  pages = ref<Row[]>([]),
  error = ref(''),
  loading = ref(true);
const slug = computed(() =>
  Array.isArray(route.params.slug) ? route.params.slug.join('/') : route.params.slug || 'start',
);
const page = computed(() => pages.value.find((p) => p.slug === slug.value));
const headings = computed(() =>
  String(page.value?.content_md || '')
    .split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3)),
);
const location = window.location;
onMounted(async () => {
  try {
    pages.value = (await api.get<Row[]>('/admin/api/docs')).data;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
});
function jump(text: string) {
  const heading = Array.from(document.querySelectorAll('.markdown h2')).find(
    (el) => el.textContent === text,
  );
  heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>
<template>
  <div class="docs-layout">
    <aside class="docs-nav">
      <div class="docs-title">
        <AppIcon name="book" />
        文档中心
      </div>
      <p>使用与接入指南</p>
      <RouterLink
        v-for="doc in pages"
        :key="doc.id"
        :to="doc.slug === 'start' ? '/docs' : '/docs/' + doc.slug"
        :class="{ active: doc.id === page?.id }"
      >
        {{ doc.title }}
        <AppIcon name="right" :size="13" />
      </RouterLink>
      <RouterLink class="docs-model-link" to="/model-square">
        <AppIcon name="layers" :size="15" />
        浏览模型广场
      </RouterLink>
    </aside>
    <div class="docs-content">
      <div class="docs-breadcrumb">
        文档中心
        <AppIcon name="right" :size="12" />
        {{ page?.title || '加载中' }}
      </div>
      <div v-if="loading" class="skeleton" />
      <p v-else-if="error" class="error-text">{{ error }}</p>
      <template v-else-if="page">
        <MarkdownContent :text="String(page.content_md).replaceAll('$BASE_URL', location.origin)" />
        <div class="docs-footer">
          <span>更新于 {{ new Date(page.updated_at).toLocaleDateString() }}</span>
          <button class="text-link" @click="copy(String(page.content_md))">
            <AppIcon name="copy" :size="13" />
            复制 Markdown
          </button>
        </div>
      </template>
      <div v-else class="empty-state">
        <h2>文档不存在</h2>
        <RouterLink to="/docs" class="button">返回快速开始</RouterLink>
      </div>
    </div>
    <aside class="docs-toc">
      <span>本页目录</span>
      <button v-for="heading in headings" :key="heading" @click="jump(heading)">
        {{ heading }}
      </button>
    </aside>
  </div>
</template>
<style scoped>
.docs-layout {
  display: grid;
  grid-template-columns: 200px minmax(0, 760px) 150px;
  gap: 38px;
  padding: 36px 0;
}
.docs-nav {
  border-right: 1px solid var(--hairline);
  padding-right: 20px;
  position: sticky;
  top: 30px;
  align-self: start;
}
.docs-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 30px;
}
.docs-nav > p {
  font-size: 11px;
  padding-left: 10px;
  margin-bottom: 12px;
}
.docs-nav > a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  border-radius: 7px;
  color: var(--fg-3);
  font-size: 12px;
  margin-bottom: 5px;
}
.docs-nav > a.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.docs-nav .docs-model-link {
  justify-content: start;
  gap: 10px;
  margin-top: 30px;
}
.docs-breadcrumb {
  display: flex;
  gap: 9px;
  align-items: center;
  font-size: 11px;
  color: var(--fg-3);
  margin-bottom: 36px;
}
.docs-content {
  min-width: 0;
}
.docs-content :deep(h2) {
  scroll-margin-top: 30px;
}
.docs-toc {
  position: sticky;
  top: 40px;
  align-self: start;
  border-left: 1px solid var(--hairline);
  padding-left: 18px;
  font-size: 11px;
}
.docs-toc > span {
  display: block;
  font-weight: 600;
  margin-bottom: 15px;
}
.docs-toc button {
  display: block;
  text-align: left;
  color: var(--fg-3);
  padding: 5px 0;
  font-size: 11px;
}
.docs-toc button:hover {
  color: var(--accent);
}
.docs-footer {
  border-top: 1px solid var(--hairline);
  display: flex;
  justify-content: space-between;
  margin-top: 55px;
  padding-top: 20px;
  font-size: 10px;
  color: var(--fg-3);
}
.docs-footer .text-link {
  font-size: 11px;
}
@media (max-width: 1279px) {
  .docs-layout {
    grid-template-columns: 170px minmax(0, 1fr);
    gap: 28px;
  }
  .docs-toc {
    display: none;
  }
}
@media (max-width: 639px) {
  .docs-layout {
    display: block;
    padding-top: 20px;
  }
  .docs-nav {
    position: static;
    border-right: 0;
    border-bottom: 1px solid var(--hairline);
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
    padding: 0 0 12px;
    margin-bottom: 25px;
  }
  .docs-title {
    width: 100%;
    margin-bottom: 10px;
  }
  .docs-nav > p,
  .docs-model-link {
    display: none !important;
  }
  .docs-nav > a {
    padding: 7px 11px;
    margin: 0;
    gap: 10px;
  }
  .docs-nav > a svg {
    display: none;
  }
  .docs-breadcrumb {
    margin-bottom: 25px;
  }
}
</style>
