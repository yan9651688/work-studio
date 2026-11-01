<script setup lang="ts">
import { typeLabels, statusLabels } from '../../api/labels';
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApp } from '../../stores/app';
import { api, notify, errorMessage, copy } from '../../api/http';
import { terminalStatuses, type Generation, type ResultAsset } from '@studio/shared';
import AppIcon from '../../components/AppIcon.vue';
import EmptyState from '../../components/EmptyState.vue';
import MarkdownContent from '../../components/MarkdownContent.vue';
const app = useApp(),
  route = useRoute(),
  router = useRouter(),
  type = ref(
    String(route.query.type || app.models.find((m) => m.id === route.query.model)?.type || 'image'),
  ),
  modelId = ref(String(route.query.model || '')),
  prompt = ref(String(route.query.prompt || '')),
  ratio = ref(''),
  resolution = ref(''),
  quality = ref(''),
  duration = ref(5),
  history = ref<Generation[]>([]),
  current = ref<Generation | null>(null),
  busy = ref(false),
  uploading = ref(false),
  loading = ref(false),
  paramsOpen = ref(true),
  references = ref<{ id: string; url: string }[]>([]);
let stream: EventSource | undefined;
const models = computed(() =>
  app.models.filter((m) => m.type === type.value && !m.studio_disabled),
);
const model = computed(() => models.value.find((m) => m.id === modelId.value));
const working = computed(() => !!current.value && !terminalStatuses.includes(current.value.status));
const cost = computed(() => {
  if (!model.value) return 0;
  const base =
    model.value.prices[resolution.value] ??
    model.value.prices.default ??
    Object.values(model.value.prices)[0] ??
    0;
  return model.value.type === 'video' && model.value.video_billing_mode === 'per_second'
    ? base * duration.value
    : base;
});
watch(
  models,
  (list) => {
    if (!list.some((m) => m.id === modelId.value)) modelId.value = list[0]?.id || '';
  },
  { immediate: true },
);
watch(
  model,
  (m) => {
    ratio.value = m?.ratios?.[0] || '';
    resolution.value = m?.resolutions?.[0] || '';
    quality.value = m?.image_qualities?.[0] || '';
    duration.value = m?.durations?.[0] || 5;
    references.value = [];
  },
  { immediate: true },
);
async function loadHistory() {
  if (!app.user) return;
  try {
    history.value = (await api.get<Generation[]>('/api/user/generations?page_size=30')).data;
  } catch (e) {
    notify(errorMessage(e), 'error');
  }
}
function observe(g: Generation) {
  stream?.close();
  current.value = g;
  if (!terminalStatuses.includes(g.status)) {
    stream = new EventSource(`/api/user/generations/${g.id}/stream`);
    stream.onmessage = (event) => {
      current.value = JSON.parse(event.data).data;
      if (current.value && terminalStatuses.includes(current.value.status)) {
        stream?.close();
        void loadHistory();
        void app.refreshUser();
      }
    };
    stream.onerror = () => {
      stream?.close();
      void recover(g.id);
    };
  }
}
async function recover(id: string) {
  try {
    const { data } = await api.get<Generation>(`/api/user/generations/${id}`);
    current.value = data;
    if (!terminalStatuses.includes(data.status))
      notify('进度连接已断开，可在历史记录中重新打开任务。', 'error');
    else {
      await loadHistory();
      await app.refreshUser();
    }
  } catch (e) {
    notify(errorMessage(e), 'error');
  }
}
onMounted(async () => {
  loading.value = true;
  await loadHistory();
  if (route.params.id && app.user) {
    try {
      observe((await api.get<Generation>('/api/user/generations/' + route.params.id)).data);
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  } else {
    const running = history.value.find((g) => !terminalStatuses.includes(g.status));
    if (running) observe(running);
  }
  loading.value = false;
});
onUnmounted(() => stream?.close());
async function generate() {
  if (!app.user) {
    await router.push({ path: '/login', query: { redirect: route.fullPath } });
    return;
  }
  if (!model.value || !prompt.value.trim()) return;
  busy.value = true;
  try {
    const params = {
      ...(ratio.value ? { ratio: ratio.value } : {}),
      ...(resolution.value ? { resolution: resolution.value } : {}),
      ...(quality.value ? { quality: quality.value } : {}),
      ...(type.value === 'video' ? { duration: duration.value } : {}),
    };
    const { data } = await api.post<Generation>('/api/user/generations', {
      model_id: modelId.value,
      prompt: prompt.value,
      params,
      reference_assets: references.value.map((r) => r.id),
    });
    observe(data);
    await app.refreshUser();
    await loadHistory();
  } catch (e) {
    notify(errorMessage(e), 'error');
  } finally {
    busy.value = false;
  }
}
async function uploadFiles(files: FileList | null) {
  if (!files) return;
  if (!app.user) {
    await router.push({ path: '/login', query: { redirect: route.fullPath } });
    return;
  }
  uploading.value = true;
  try {
    for (const file of Array.from(files)) {
      if (references.value.length >= (model.value?.max_reference_images || 0))
        throw new Error('参考图数量已达上限');
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post<{ id: string; url: string }>('/api/user/assets', form);
      references.value.push(data);
    }
  } catch (e) {
    notify(errorMessage(e), 'error');
  } finally {
    uploading.value = false;
  }
}
function reuse(g: Generation) {
  type.value = g.type;
  modelId.value = g.model_id;
  prompt.value = g.prompt;
  notify('已填入模型与提示词');
}
async function togglePublic() {
  if (!current.value) return;
  try {
    await api.put(`/api/user/generations/${current.value.id}`, {
      is_public: !current.value.is_public,
    });
    current.value.is_public = current.value.is_public ? 0 : 1;
    notify(current.value.is_public ? '作品已设为公开' : '作品已设为私密');
  } catch (e) {
    notify(errorMessage(e), 'error');
  }
}
async function download(asset: ResultAsset) {
  if (asset.text) {
    const url = URL.createObjectURL(new Blob([asset.text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'creation.txt';
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  if (asset.url) {
    const response = await fetch(asset.url);
    if (!response.ok) {
      notify('下载失败，请刷新作品后重试', 'error');
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `creation.${asset.mime?.startsWith('video') ? 'mp4' : 'png'}`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
</script>
<template>
  <div class="workspace">
    <header class="workspace-top">
      <div class="row">
        <AppIcon name="sparkles" />
        <b>创作中心</b>
        <span class="badge">{{ typeLabels[type] || '图片' }}工作台</span>
      </div>
      <div class="row">
        <button class="button small" @click="paramsOpen = !paramsOpen">
          <AppIcon name="sliders" :size="14" />
          创作参数
        </button>
        <RouterLink class="text-link" to="/docs">
          使用指南
          <AppIcon name="external" :size="13" />
        </RouterLink>
      </div>
    </header>
    <div class="workspace-body" :class="{ 'params-closed': !paramsOpen }">
      <aside v-if="paramsOpen" class="parameters">
        <div class="tabs segmented">
          <button
            v-for="[id, label, icon] in [
              ['image', '图片', 'image'],
              ['video', '视频', 'film'],
              ['text', '文本', 'pen'],
            ]"
            :key="id"
            :class="{ active: type === id }"
            @click="type = id"
          >
            <AppIcon :name="icon" :size="15" />
            {{ label }}
          </button>
        </div>
        <label class="field">
          <span>选择模型</span>
          <select v-model="modelId">
            <option v-if="!models.length" value="">暂无可用模型</option>
            <option v-for="m in models" :key="m.id" :value="m.id">
              {{ m.alias || m.name }} · {{ Object.values(m.prices)[0] || 0 }} 积分起
            </option>
          </select>
          <small v-if="model">{{ model.description }}</small>
        </label>
        <div v-if="model?.ratios.length" class="field">
          <span>画面比例</span>
          <div class="ratio-grid">
            <button
              v-for="r in model.ratios"
              :key="r"
              :class="{ active: ratio === r }"
              @click="ratio = r"
            >
              <span class="ratio-shape" :style="{ aspectRatio: r.replace(':', '/') }" />
              {{ r }}
            </button>
          </div>
        </div>
        <label v-if="model?.resolutions.length" class="field">
          <span>分辨率</span>
          <select v-model="resolution">
            <option v-for="r in model.resolutions" :key="r">{{ r }}</option>
          </select>
        </label>
        <label v-if="model?.image_qualities.length" class="field">
          <span>画质</span>
          <select v-model="quality">
            <option v-for="q in model.image_qualities" :key="q">{{ q }}</option>
          </select>
        </label>
        <label v-if="type === 'video' && model?.durations.length" class="field">
          <span>视频时长</span>
          <select v-model="duration">
            <option v-for="d in model.durations" :key="d" :value="d">{{ d }} 秒</option>
          </select>
        </label>
        <div v-if="model?.image_to_image" class="field">
          <span>
            参考图片
            <small>{{ references.length }} / {{ model.max_reference_images }}</small>
          </span>
          <label
            class="reference-drop"
            @dragover.prevent
            @drop.prevent="uploadFiles($event.dataTransfer?.files || null)"
          >
            <AppIcon :name="uploading ? 'loader' : 'upload'" :class="{ spin: uploading }" />
            <span>{{ uploading ? '上传中…' : '点击或拖入参考图' }}</span>
            <small>PNG、JPG、WebP · 最大 10MB</small>
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              :disabled="uploading"
              @change="uploadFiles(($event.target as HTMLInputElement).files)"
            />
          </label>
          <div class="reference-list">
            <div v-for="(image, i) in references" :key="image.id">
              <img :src="image.url" alt="参考图" />
              <button aria-label="移除参考图" @click="references.splice(i, 1)">
                <AppIcon name="x" :size="12" />
              </button>
            </div>
          </div>
        </div>
        <div class="parameters-bottom">
          <span>预计消耗</span>
          <b>
            {{ cost }}
            <small>积分</small>
          </b>
          <p>生成失败，自动退还积分。</p>
        </div>
      </aside>
      <section class="creative-area">
        <div class="result-area">
          <template v-if="current">
            <div v-if="working" class="generation-progress">
              <div class="progress-orbit"><AppIcon name="sparkles" :size="32" /></div>
              <h2>{{ current.status === 'queued' ? '等待创作开始' : '正在把灵感变成作品' }}</h2>
              <p>你可以保留页面，或稍后在历史记录中查看。</p>
              <div class="progress-track"><span :style="{ width: `${current.progress}%` }" /></div>
              <small>{{ current.progress }}%</small>
            </div>
            <EmptyState
              v-else-if="current.status !== 'succeeded'"
              title="这次生成未能完成"
              :description="`${current.error || '上游暂时不可用'}。预扣积分已退回。`"
              icon="alert"
            >
              <button class="button" @click="reuse(current)">
                重新编辑
                <AppIcon name="refresh" :size="15" />
              </button>
            </EmptyState>
            <template v-else>
              <div class="result-assets">
                <div v-for="(asset, i) in current.result_assets" :key="i" class="result-item">
                  <MarkdownContent v-if="asset.text" :text="asset.text" />
                  <video
                    v-else-if="asset.mime?.startsWith('video')"
                    :src="asset.url"
                    controls
                    playsinline
                  />
                  <img v-else :src="asset.url" alt="生成作品" />
                  <button class="button small download" @click="download(asset)">
                    <AppIcon name="download" :size="14" />
                    下载{{ asset.text ? '文本' : '作品' }}
                  </button>
                </div>
              </div>
              <div class="result-actions">
                <button class="button small" @click="copy(current.prompt)">
                  <AppIcon name="copy" :size="14" />
                  复制描述
                </button>
                <button class="button small" @click="reuse(current)">
                  <AppIcon name="refresh" :size="14" />
                  再次创作
                </button>
                <button class="button small" @click="togglePublic">
                  <AppIcon name="eye" :size="14" />
                  {{ current.is_public ? '设为私密' : '设为公开' }}
                </button>
                <span>
                  {{ (current.elapsed_ms / 1000).toFixed(1) }}s · {{ current.cost_credits }} 积分
                </span>
              </div>
            </template>
          </template>
          <EmptyState
            v-else
            :title="models.length ? '你的下一件作品，从这里开始' : '准备好下一次创作'"
            :description="
              models.length
                ? '在下方写下想法，选择模型，让灵感成为作品。'
                : '管理员配置并启用模型后，即可开始创作。'
            "
            icon="sparkles"
          >
            <RouterLink
              v-if="!models.length && app.user?.role === 'admin'"
              class="button soft"
              to="/admin/gateway"
            >
              配置模型渠道
              <AppIcon name="arrow" :size="15" />
            </RouterLink>
          </EmptyState>
        </div>
        <form class="prompt-composer" @submit.prevent="generate">
          <label for="prompt">
            创作描述
            <small>把画面、风格和细节说得更具体一些</small>
          </label>
          <textarea
            id="prompt"
            v-model="prompt"
            rows="4"
            placeholder="描述你的想法，剩下的交给 AI…"
            maxlength="32000"
            @keydown.ctrl.enter.prevent="generate"
            @keydown.meta.enter.prevent="generate"
          />
          <div class="composer-bottom">
            <span>{{ prompt.length.toLocaleString() }} / 32,000</span>
            <button
              class="button primary"
              :disabled="!!app.user && (!model || !prompt.trim() || busy || working || uploading)"
            >
              <AppIcon :name="busy ? 'loader' : 'sparkles'" :class="{ spin: busy }" />
              {{ !app.user ? '登录后创作' : working ? '生成中…' : '开始生成' }}
              <span v-if="app.user">· {{ cost }} 积分</span>
            </button>
          </div>
        </form>
      </section>
      <aside class="history-panel">
        <div class="between">
          <h3>创作记录</h3>
          <button class="icon-button" aria-label="刷新历史" @click="loadHistory">
            <AppIcon name="refresh" :size="14" />
          </button>
        </div>
        <p v-if="loading" class="muted">正在加载…</p>
        <EmptyState
          v-else-if="!history.length"
          title="还没有创作记录"
          description="你的作品会被保存在这里。"
          icon="history"
        />
        <button
          v-for="g in history"
          :key="g.id"
          class="history-item"
          :class="{ active: current?.id === g.id }"
          @click="observe(g)"
        >
          <img
            v-if="g.result_assets[0]?.thumb_url"
            :src="g.result_assets[0].thumb_url"
            alt="作品缩略图"
          />
          <span v-else class="history-icon">
            <AppIcon :name="g.type === 'text' ? 'pen' : g.type === 'video' ? 'film' : 'image'" />
          </span>
          <span>
            <b>{{ g.prompt }}</b>
            <small>
              {{ new Date(g.created_at).toLocaleDateString() }} · {{ statusLabels[g.status] }}
            </small>
          </span>
        </button>
      </aside>
    </div>
  </div>
</template>
<style scoped>
.workspace {
  margin: 0 -2.2vw -72px;
}
.workspace-top {
  height: 64px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface);
}
.workspace-top b {
  font-size: 14px;
}
.workspace-top .badge {
  font-size: 10px;
}
.workspace-body {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 220px;
  min-height: calc(100vh - 64px);
}
.workspace-body.params-closed {
  grid-template-columns: minmax(0, 1fr) 220px;
}
.parameters {
  padding: 20px 18px;
  border-right: 1px solid var(--hairline);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.parameters .tabs {
  flex-wrap: nowrap;
  gap: 2px;
}
.parameters .tabs button {
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex: 1;
  padding: 7px;
}
.parameters .field > span {
  font-size: 12px;
}
.parameters select {
  font-size: 12px;
}
.ratio-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
}
.ratio-grid button {
  border: 1px solid var(--hairline);
  border-radius: 7px;
  padding: 10px 6px;
  font-size: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: end;
  gap: 6px;
  height: 63px;
  color: var(--fg-3);
}
.ratio-grid button.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent);
}
.ratio-shape {
  display: block;
  max-height: 22px;
  width: 24px;
  border: 1.5px solid currentColor;
  border-radius: 2px;
}
.parameters-bottom {
  margin-top: auto;
  padding-top: 25px;
  border-top: 1px solid var(--hairline);
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  font-size: 12px;
}
.parameters-bottom b {
  font-size: 18px;
  color: var(--accent);
}
.parameters-bottom small {
  font-size: 11px;
  font-weight: 400;
}
.parameters-bottom p {
  width: 100%;
  font-size: 10px;
  margin-top: 7px;
}
.reference-drop {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  text-align: center;
  padding: 20px 8px;
  border: 1px dashed var(--hairline);
  background: var(--surface-2);
  border-radius: 8px;
  color: var(--fg-3);
  position: relative;
  font-size: 11px;
}
.reference-drop small {
  font-size: 9px;
}
.reference-drop input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  cursor: pointer;
}
.reference-list {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}
.reference-list > div {
  position: relative;
  width: 55px;
  height: 55px;
}
.reference-list img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 5px;
}
.reference-list button {
  position: absolute;
  right: -4px;
  top: -4px;
  border-radius: 50%;
  background: var(--surface);
  padding: 2px;
  display: grid;
  place-items: center;
}
.creative-area {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}
.result-area {
  min-height: 360px;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.result-area > .empty-state {
  min-height: 360px;
}
.prompt-composer {
  border: 1px solid var(--hairline);
  border-radius: 14px;
  background: var(--surface);
  padding: 16px;
  box-shadow: 0 5px 20px #00000004;
}
.prompt-composer > label {
  font-size: 12px;
  display: flex;
  justify-content: space-between;
  color: var(--fg-2);
}
.prompt-composer > label small {
  font-size: 10px;
  color: var(--fg-3);
}
.prompt-composer textarea {
  border: 0;
  box-shadow: none;
  padding: 12px 0;
  font-size: 13px;
  resize: none;
  line-height: 1.8;
  min-height: 100px;
}
.composer-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--hairline);
  padding-top: 12px;
}
.composer-bottom > span {
  font-size: 10px;
  color: var(--fg-3);
}
.composer-bottom .button {
  font-size: 12px;
}
.history-panel {
  border-left: 1px solid var(--hairline);
  padding: 16px 12px;
  background: var(--surface);
}
.history-panel h3 {
  font-size: 12px;
  padding-left: 4px;
}
.history-panel .empty-state {
  padding: 35px 5px;
}
.history-panel :deep(.empty-state h3) {
  font-size: 12px;
}
.history-panel :deep(.empty-state p) {
  font-size: 10px;
}
.history-item {
  display: flex;
  gap: 10px;
  padding: 10px 6px;
  width: 100%;
  text-align: left;
  border-radius: 8px;
  align-items: center;
}
.history-item:hover,
.history-item.active {
  background: var(--accent-soft);
}
.history-item > img,
.history-icon {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--fg-3);
  display: grid;
  place-items: center;
}
.history-item > span:last-child {
  min-width: 0;
}
.history-item b {
  font-size: 11px;
  font-weight: 500;
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.history-item small {
  font-size: 9px;
  color: var(--fg-3);
}
.generation-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
  text-align: center;
  padding: 60px 20px;
}
.generation-progress h2 {
  font-size: 18px;
}
.generation-progress p {
  font-size: 12px;
}
.generation-progress small {
  font-size: 11px;
  color: var(--accent);
}
.progress-orbit {
  width: 90px;
  height: 90px;
  border-radius: 50%;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  display: grid;
  place-items: center;
  color: var(--accent);
  margin-bottom: 10px;
  animation: pulse 2s infinite;
}
.progress-track {
  width: min(280px, 100%);
  height: 4px;
  background: var(--hairline);
  border-radius: 5px;
  overflow: hidden;
  margin-top: 15px;
}
.progress-track span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.5s;
}
.result-assets {
  display: grid;
  gap: 20px;
}
.result-item {
  position: relative;
}
.result-item img,
.result-item video {
  width: 100%;
  max-height: 60vh;
  object-fit: contain;
  border-radius: 12px;
}
.result-item .markdown {
  padding: 20px;
  border: 1px solid var(--hairline);
  background: var(--surface);
  border-radius: 12px;
}
.download {
  margin-top: 12px;
}
.result-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 20px;
}
.result-actions > span {
  font-size: 11px;
  color: var(--fg-3);
  margin-left: auto;
}
@media (max-width: 1279px) {
  .workspace-body {
    grid-template-columns: 230px minmax(0, 1fr);
  }
  .workspace-body.params-closed {
    grid-template-columns: minmax(0, 1fr);
  }
  .history-panel {
    grid-column: 1/-1;
    border-left: 0;
    border-top: 1px solid var(--hairline);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .history-panel > .between {
    width: 100%;
  }
  .history-item {
    max-width: 220px;
  }
  .history-panel .empty-state {
    padding: 20px;
    flex: 1;
  }
  .history-panel :deep(.empty-icon) {
    display: none;
  }
}
@media (max-width: 1023px) {
  .workspace {
    margin: 0 -24px -48px;
  }
  .workspace-top {
    padding: 0 20px;
  }
  .workspace-body {
    min-height: calc(100vh - 120px);
  }
}
@media (max-width: 639px) {
  .workspace {
    margin: 0 -18px -40px;
  }
  .workspace-top {
    padding: 0 16px;
    height: 58px;
  }
  .workspace-top .badge,
  .workspace-top .text-link {
    display: none;
  }
  .workspace-body,
  .workspace-body.params-closed {
    display: flex;
    flex-direction: column;
  }
  .parameters {
    border-right: 0;
    border-bottom: 1px solid var(--hairline);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    padding: 18px;
  }
  .parameters > .tabs,
  .parameters > .field:has(.ratio-grid),
  .parameters > .field:has(.reference-drop) {
    grid-column: 1/-1;
  }
  .parameters > .field:nth-child(2) {
    grid-column: 1/-1;
  }
  .parameters-bottom {
    display: none;
  }
  .ratio-grid {
    grid-template-columns: repeat(5, 1fr);
  }
  .creative-area {
    padding: 18px;
    gap: 18px;
  }
  .result-area,
  .result-area > .empty-state {
    min-height: 240px;
  }
  .prompt-composer > label small {
    display: none;
  }
  .prompt-composer {
    padding: 14px;
  }
  .composer-bottom .button > span {
    display: none;
  }
  .history-panel {
    padding: 18px;
  }
  .history-item {
    max-width: 100%;
  }
  .result-actions > span {
    width: 100%;
    margin: 5px 0 0;
  }
}
</style>
