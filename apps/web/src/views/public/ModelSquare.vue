<script setup lang="ts">
import { healthLabels } from '../../api/labels';
import { ref, computed, onMounted } from 'vue';
import { useApp } from '../../stores/app';
import { api, copy, notify, errorMessage } from '../../api/http';
import type { Row } from '@studio/shared';
import AppIcon from '../../components/AppIcon.vue';
import EmptyState from '../../components/EmptyState.vue';
const app = useApp(),
  search = ref(''),
  type = ref('all'),
  group = ref(''),
  groups = ref<Row[]>([]);
const health = ref<Record<string, string>>({});
const models = computed(() =>
  app.models.filter(
    (m) =>
      (type.value === 'all' || m.type === type.value) &&
      (!group.value || m.group_id === group.value) &&
      `${m.name} ${m.id} ${m.description}`.toLowerCase().includes(search.value.toLowerCase()),
  ),
);
onMounted(async () => {
  try {
    const [a, b] = await Promise.all([
      api.get<Row[]>('/admin/api/model-groups'),
      api.get<{ id: string; health: string }[]>('/admin/api/status'),
    ]);
    groups.value = a.data;
    health.value = Object.fromEntries(b.data.map((m) => [m.id, m.health]));
  } catch (e) {
    notify(errorMessage(e), 'error');
  }
});
</script>
<template>
  <div class="page">
    <header class="page-header">
      <span class="eyebrow">MODEL CATALOG</span>
      <h1>选择适合你的 AI 模型</h1>
      <p>从图像到视频，从灵感到表达。比较模型能力、当前积分价格与运行状态。</p>
    </header>
    <div class="catalog-links">
      <RouterLink
        v-for="[name, desc, path, icon] in [
          ['开始创作', '在工作台中体验模型', '/create', 'sparkles'],
          ['模型 API 文档', '将 AI 能力接入你的应用', '/docs/models', 'code'],
          ['实时监控', '查看模型的运行状态', '/status', 'activity'],
        ]"
        :key="path"
        :to="path"
      >
        <AppIcon :name="icon" :size="21" />
        <div>
          <b>{{ name }}</b>
          <small>{{ desc }}</small>
        </div>
        <AppIcon name="diagonal" :size="17" />
      </RouterLink>
    </div>
    <div class="group-filter tabs">
      <button :class="{ active: !group }" @click="group = ''">全部厂商</button>
      <button
        v-for="g in groups"
        :key="g.id"
        :class="{ active: group === g.id }"
        @click="group = g.id"
      >
        {{ g.name }}
      </button>
    </div>
    <div class="toolbar">
      <div class="tabs segmented">
        <button
          v-for="[id, label] in [
            ['all', '全部模型'],
            ['image', '图片'],
            ['video', '视频'],
            ['text', '文本'],
          ]"
          :key="id"
          :class="{ active: type === id }"
          @click="type = id"
        >
          {{ label }}
          <small v-if="id === 'all'">{{ app.models.length }}</small>
        </button>
      </div>
      <label class="search-box">
        <AppIcon name="search" />
        <input v-model="search" placeholder="搜索模型名称或 ID" aria-label="搜索模型" />
      </label>
    </div>
    <div class="model-grid">
      <article v-for="model in models" :key="model.id" class="card model-card">
        <div class="between">
          <span class="provider-icon">
            <AppIcon
              :name="model.type === 'image' ? 'image' : model.type === 'video' ? 'film' : 'pen'"
              :size="22"
            />
          </span>
          <span
            class="badge"
            :class="
              health[model.id] === 'healthy'
                ? 'success'
                : health[model.id] === 'error'
                  ? 'danger'
                  : ''
            "
          >
            <i class="dot" />
            {{ healthLabels[health[model.id]] || '暂无数据' }}
          </span>
        </div>
        <h2>{{ model.alias || model.name }}</h2>
        <button class="model-id" @click="copy(model.id)">
          {{ model.id }}
          <AppIcon name="copy" :size="12" />
        </button>
        <p class="description line-clamp">{{ model.description || '通用 AI 创作模型' }}</p>
        <div class="capabilities">
          <span class="badge">
            {{ { image: '图片生成', video: '视频生成', text: '文本生成' }[model.type] }}
          </span>
          <span v-if="model.image_to_image" class="badge">
            参考图 ×{{ model.max_reference_images }}
          </span>
          <span v-for="r in model.resolutions" :key="r" class="badge">{{ r }}</span>
        </div>
        <div class="price-list">
          <div v-for="(price, key) in model.prices" :key="key">
            <span>{{ key === 'default' ? '单次' : key }}</span>
            <b>
              {{ price }}
              <small>
                积分{{
                  model.type === 'video' && model.video_billing_mode === 'per_second' ? '/ 秒' : ''
                }}
              </small>
            </b>
          </div>
        </div>
        <RouterLink
          class="button"
          :to="{ path: '/create', query: { model: model.id, type: model.type } }"
        >
          开始创作
          <AppIcon name="arrow" :size="15" />
        </RouterLink>
      </article>
    </div>
    <EmptyState
      v-if="!models.length"
      icon="layers"
      title="暂无可用模型"
      description="模型配置完成后，会在这里展示能力、价格与运行状态。"
    >
      <RouterLink v-if="app.user?.role === 'admin'" to="/admin/gateway" class="button primary">
        配置上游渠道
        <AppIcon name="arrow" />
      </RouterLink>
    </EmptyState>
  </div>
</template>
<style scoped>
.catalog-links {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin: 28px 0;
}
.catalog-links > a {
  display: flex;
  align-items: center;
  gap: 15px;
  border: 1px solid var(--hairline);
  background: var(--surface);
  border-radius: 12px;
  padding: 20px;
}
.catalog-links > a > svg:first-child {
  color: var(--accent);
}
.catalog-links > a > svg:last-child {
  margin-left: auto;
  color: var(--fg-3);
}
.catalog-links b {
  font-size: 13px;
}
.catalog-links small {
  display: block;
  color: var(--fg-3);
  font-size: 11px;
  margin-top: 4px;
}
.group-filter {
  margin: 30px 0 22px;
  gap: 10px;
}
.group-filter button {
  border: 1px solid var(--hairline);
  background: var(--surface);
  border-radius: 20px;
  padding: 5px 16px;
  font-size: 12px;
}
.group-filter button.active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
}
.model-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.model-card {
  display: flex;
  flex-direction: column;
}
.provider-icon {
  display: grid;
  place-items: center;
  width: 43px;
  height: 43px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
}
.model-card h2 {
  font-size: 18px;
  margin-top: 20px;
}
.model-id {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--fg-3);
  font-size: 11px;
  font-family: ui-monospace, monospace;
  margin-top: 5px;
  padding: 0;
  word-break: break-all;
  text-align: left;
}
.description {
  font-size: 12px;
  margin-top: 16px;
  min-height: 40px;
}
.capabilities {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 15px 0;
}
.price-list {
  border-top: 1px solid var(--hairline);
  margin-top: auto;
  padding-top: 14px;
}
.price-list > div {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 9px;
  color: var(--fg-3);
}
.price-list b {
  color: var(--fg);
}
.price-list small {
  font-size: 10px;
  font-weight: 400;
  color: var(--fg-3);
}
.model-card > .button {
  margin-top: 15px;
  font-size: 12px;
}
@media (max-width: 1199px) {
  .model-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 767px) {
  .catalog-links {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .catalog-links > a {
    padding: 16px;
  }
  .model-grid {
    grid-template-columns: 1fr;
  }
  .group-filter {
    overflow: auto;
    flex-wrap: nowrap;
    white-space: nowrap;
  }
}
</style>
