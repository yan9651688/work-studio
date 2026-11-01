<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api, errorMessage, notify } from '../../api/http';
import AppIcon from '../../components/AppIcon.vue';
import EmptyState from '../../components/EmptyState.vue';
interface Overview {
  today_generations: number;
  generated_count: number;
  new_users: number;
  income_cents: number;
  avg_elapsed_ms: number;
  channels: {
    id: string;
    name: string;
    enabled: boolean;
    last_check_ok?: boolean;
    last_check_at?: string;
  }[];
  daily: { date: string; count: number; success: number }[];
  health: { id: string; count: number; success_rate: number | null }[];
}
const data = ref<Overview | null>(null),
  loading = ref(true);
async function load() {
  loading.value = true;
  try {
    data.value = (await api.get<Overview>('/admin/api/manage/overview')).data;
  } catch (e) {
    notify(errorMessage(e), 'error');
  } finally {
    loading.value = false;
  }
}
onMounted(load);
const days = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10);
    return (
      data.value?.daily.find((d) => d.date === date) || {
        date,
        count: 0,
        success: 0,
      }
    );
  }),
);
const max = computed(() => Math.max(1, ...days.value.map((d) => d.count)));
const cards = computed(() => [
  ['今日生成', data.value?.today_generations || 0, '本站今日创建的任务', 'sparkles'],
  ['累计成功生成', data.value?.generated_count || 0, '所有成功完成的创作', 'image'],
  [
    '累计确认收入',
    `¥${((data.value?.income_cents || 0) / 100).toFixed(2)}`,
    '仅统计已确认到账的订单',
    'wallet',
  ],
  ['今日新用户', data.value?.new_users || 0, '今日注册的账户', 'users'],
]);
</script>
<template>
  <header class="page-header between">
    <div>
      <span class="eyebrow">OVERVIEW</span>
      <h1>数据概览</h1>
      <p>了解站点的创作、用户与渠道运行情况。</p>
    </div>
    <button class="button" :disabled="loading" @click="load">
      <AppIcon name="refresh" :size="15" />
      刷新数据
    </button>
  </header>
  <div v-if="!data && loading" class="skeleton" />
  <template v-else-if="data">
    <div v-if="!data.channels.some((c) => c.enabled)" class="notice setup-notice">
      <div>
        <b>完成配置，让第一件作品发生。</b>
        <p>添加上游密钥 → 配置模型 → 建立模型绑定 → 启用并测试。</p>
      </div>
      <RouterLink to="/admin/gateway" class="button soft">
        配置渠道
        <AppIcon name="arrow" :size="15" />
      </RouterLink>
    </div>
    <div class="stat-grid">
      <article
        v-for="[title, value, description, icon] in cards"
        :key="String(title)"
        class="card stat-card"
      >
        <div class="between">
          <small>{{ title }}</small>
          <AppIcon :name="String(icon)" :size="17" class="muted" />
        </div>
        <strong>{{ typeof value === 'number' ? value.toLocaleString() : value }}</strong>
        <p>{{ description }}</p>
      </article>
    </div>
    <div class="overview-panels">
      <section class="card">
        <div class="section-header">
          <h2>创作趋势</h2>
          <span class="badge">最近 7 天 · UTC</span>
        </div>
        <div class="chart">
          <div v-for="day in days" :key="day.date" class="bar-column">
            <span>{{ day.count }}</span>
            <div class="bar-track">
              <div
                class="bar"
                :style="{
                  height: `${Math.max(day.count ? 5 : 1, (day.count / max) * 100)}%`,
                }"
                :title="`${day.date}：${day.count} 次，${day.success} 成功`"
              />
            </div>
            <small>{{ day.date.slice(5) }}</small>
          </div>
        </div>
      </section>
      <section class="card">
        <div class="section-header">
          <h2>渠道状态</h2>
          <RouterLink to="/admin/gateway" class="text-link">
            管理
            <AppIcon name="arrow" :size="14" />
          </RouterLink>
        </div>
        <div v-for="channel in data.channels" :key="channel.id" class="channel-row">
          <span class="channel-icon"><AppIcon name="database" :size="17" /></span>
          <div>
            <b>{{ channel.name }}</b>
            <small>
              {{
                channel.last_check_at
                  ? new Date(channel.last_check_at).toLocaleString()
                  : '尚未测试连接'
              }}
            </small>
          </div>
          <span
            class="badge"
            :class="channel.enabled ? (channel.last_check_ok ? 'success' : 'warning') : ''"
          >
            <i class="dot" />
            {{ !channel.enabled ? '未启用' : channel.last_check_ok ? '正常' : '待检查' }}
          </span>
        </div>
        <EmptyState
          v-if="!data.channels.length"
          title="暂无渠道"
          description="添加渠道后在这里查看连接状态。"
        />
      </section>
    </div>
    <section class="card quick-links">
      <h2>常用操作</h2>
      <div>
        <RouterLink
          v-for="[path, label, icon] in [
            ['config', '站点配置', 'settings'],
            ['models', '模型管理', 'layers'],
            ['users', '用户管理', 'users'],
            ['cdks', '生成兑换码', 'gift'],
            ['images', '生成记录', 'image'],
            ['logs', '请求日志', 'code'],
          ]"
          :key="path"
          :to="'/admin/' + path"
        >
          <AppIcon :name="icon" />
          <span>{{ label }}</span>
          <AppIcon name="diagonal" :size="14" />
        </RouterLink>
      </div>
    </section>
  </template>
</template>
<style scoped>
.setup-notice {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin-bottom: 24px;
}
.setup-notice b {
  font-size: 14px;
}
.setup-notice p {
  font-size: 12px;
  margin-top: 5px;
  color: var(--accent);
}
.overview-panels {
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: 22px;
  margin-top: 25px;
}
.overview-panels h2,
.quick-links h2 {
  font-size: 16px;
}
.chart {
  display: flex;
  align-items: flex-end;
  gap: 18px;
  height: 230px;
  padding: 15px 5px 0;
}
.bar-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  text-align: center;
  height: 100%;
  min-width: 0;
}
.bar-column > span {
  font-size: 10px;
  color: var(--fg-3);
  padding: 3px;
}
.bar-track {
  flex: 1;
  display: flex;
  align-items: flex-end;
}
.bar {
  width: 100%;
  background: var(--accent-gradient);
  border-radius: 5px 5px 0 0;
  min-height: 2px;
  opacity: 0.75;
}
.bar-column small {
  font-size: 10px;
  color: var(--fg-3);
  margin-top: 12px;
}
.channel-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--hairline);
}
.channel-row:last-child {
  border-bottom: 0;
}
.channel-icon {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--surface-2);
  display: grid;
  place-items: center;
  color: var(--fg-3);
}
.channel-row b {
  font-size: 12px;
  font-weight: 550;
}
.channel-row small {
  display: block;
  font-size: 10px;
  color: var(--fg-3);
  margin-top: 4px;
}
.channel-row > .badge {
  margin-left: auto;
}
.quick-links {
  margin-top: 24px;
}
.quick-links > div {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 20px;
}
.quick-links a {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px;
  border: 1px solid var(--hairline);
  border-radius: 8px;
  font-size: 12px;
}
.quick-links a > svg:first-child {
  color: var(--accent);
}
.quick-links a > svg:last-child {
  margin-left: auto;
  color: var(--fg-3);
}
@media (max-width: 1100px) {
  .overview-panels {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 639px) {
  .setup-notice {
    align-items: start;
    flex-direction: column;
  }
  .quick-links > div {
    grid-template-columns: repeat(2, 1fr);
  }
  .quick-links a {
    padding: 12px;
    gap: 8px;
  }
  .chart {
    gap: 10px;
  }
  .quick-links a > svg:last-child {
    display: none;
  }
}
</style>
