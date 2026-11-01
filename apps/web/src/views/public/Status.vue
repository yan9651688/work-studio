<script setup lang="ts">
import { healthLabels } from '../../api/labels';
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { api, errorMessage } from '../../api/http';
import AppIcon from '../../components/AppIcon.vue';
import EmptyState from '../../components/EmptyState.vue';
interface Health {
  id: string;
  name: string;
  health: string;
  success_rate: number | null;
  avg_elapsed_ms: number;
  count: number;
  hourly: { hour: string; count: number; success: number }[];
}
const models = ref<Health[]>([]),
  error = ref(''),
  updated = ref(''),
  loading = ref(true);
let stream: EventSource | undefined;
const allHealthy = computed(
  () =>
    models.value.length &&
    models.value.every((m) => m.health === 'healthy' || m.health === 'unknown'),
);
onMounted(async () => {
  try {
    models.value = (await api.get<Health[]>('/admin/api/status')).data;
    updated.value = new Date().toLocaleTimeString();
    stream = new EventSource('/admin/api/status/stream');
    stream.onmessage = (e) => {
      const data = JSON.parse(e.data);
      models.value = data.data;
      updated.value = new Date(data.updated_at).toLocaleTimeString();
    };
    stream.onerror = () => {
      error.value = '实时连接暂不可用，正在重新连接。';
    };
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
});
onUnmounted(() => stream?.close());
</script>
<template>
  <div class="page">
    <header class="page-header">
      <span class="eyebrow">LIVE STATUS</span>
      <h1>实时监控</h1>
      <p>模型运行状态、响应速度与成功率。数据来自本站的真实调用记录。</p>
    </header>
    <div class="status-banner">
      <span class="status-ring">
        <AppIcon :name="allHealthy ? 'check' : 'activity'" :size="24" />
      </span>
      <div>
        <h2>
          {{ !models.length ? '等待模型接入' : allHealthy ? '模型服务运行中' : '部分模型存在异常' }}
        </h2>
        <p>{{ models.length }} 个已启用模型 · 最近更新 {{ updated || '—' }}</p>
      </div>
      <span class="badge">
        <i class="dot" />
        实时更新
      </span>
    </div>
    <div class="status-legend">
      <span>
        <i class="dot green" />
        正常
      </span>
      <span>
        <i class="dot amber" />
        繁忙
      </span>
      <span>
        <i class="dot red" />
        异常
      </span>
      <span>
        <i class="dot gray" />
        暂无调用
      </span>
      <small>最近 24 小时</small>
    </div>
    <p v-if="error" class="notice warning">{{ error }}</p>
    <div v-if="loading" class="skeleton" />
    <div v-else class="status-models">
      <article v-for="model in models" :key="model.id" class="card">
        <div class="between">
          <div>
            <h3>{{ model.name }}</h3>
            <small class="muted">{{ model.id }}</small>
          </div>
          <span
            class="badge"
            :class="
              model.health === 'healthy' ? 'success' : model.health === 'error' ? 'danger' : ''
            "
          >
            <i class="dot" />
            {{ healthLabels[model.health] }}
          </span>
        </div>
        <div class="hourly-bars">
          <div
            v-for="hour in model.hourly"
            :key="hour.hour"
            :title="`${new Date(hour.hour).toLocaleString()} · ${hour.count} 次 / ${hour.success} 成功`"
            :class="
              !hour.count
                ? 'gray'
                : hour.success / hour.count >= 0.95
                  ? 'green'
                  : hour.success / hour.count >= 0.7
                    ? 'amber'
                    : 'red'
            "
          />
        </div>
        <div class="bar-label">
          <span>24 小时前</span>
          <span>现在</span>
        </div>
        <div class="health-metrics">
          <div>
            <span>成功率</span>
            <b>
              {{ model.success_rate === null ? '—' : (model.success_rate * 100).toFixed(1) + '%' }}
            </b>
          </div>
          <div>
            <span>平均耗时</span>
            <b>{{ model.avg_elapsed_ms ? (model.avg_elapsed_ms / 1000).toFixed(1) + 's' : '—' }}</b>
          </div>
          <div>
            <span>调用次数</span>
            <b>{{ model.count.toLocaleString() }}</b>
          </div>
        </div>
      </article>
    </div>
    <EmptyState
      v-if="!loading && !models.length"
      icon="activity"
      title="暂无监控数据"
      description="启用模型并发起调用后，这里将展示真实的运行指标。"
    />
  </div>
</template>
<style scoped>
.status-banner {
  display: flex;
  align-items: center;
  gap: 18px;
  background: var(--feature-bg);
  border: 1px solid var(--accent-border);
  border-radius: 14px;
  padding: 25px;
}
.status-ring {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  display: grid;
  place-items: center;
}
.status-banner h2 {
  font-size: 18px;
}
.status-banner p {
  font-size: 12px;
  margin-top: 6px;
}
.status-banner > .badge {
  margin-left: auto;
}
.status-legend {
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: 11px;
  color: var(--fg-3);
  margin: 25px 0;
}
.status-legend > span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.status-legend small {
  margin-left: auto;
  font-size: 10px;
}
.green {
  background: var(--status-success) !important;
}
.amber {
  background: var(--status-warning) !important;
}
.red {
  background: var(--status-danger) !important;
}
.gray {
  background: var(--hairline) !important;
}
.status-models {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.hourly-bars {
  display: flex;
  gap: 4px;
  margin-top: 25px;
}
.hourly-bars > div {
  height: 30px;
  flex: 1;
  border-radius: 3px;
  opacity: 0.8;
}
.bar-label {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  color: var(--fg-3);
  margin-top: 7px;
}
.health-metrics {
  display: flex;
  gap: 35px;
  margin-top: 22px;
  border-top: 1px solid var(--hairline);
  padding-top: 18px;
}
.health-metrics span {
  display: block;
  font-size: 10px;
  color: var(--fg-3);
}
.health-metrics b {
  font-size: 19px;
  font-weight: 550;
  display: block;
  margin-top: 5px;
}
@media (max-width: 767px) {
  .status-models {
    grid-template-columns: 1fr;
  }
  .status-banner {
    padding: 18px;
    gap: 14px;
  }
  .status-banner h2 {
    font-size: 16px;
  }
  .status-banner > .badge {
    display: none;
  }
  .status-legend {
    gap: 12px;
  }
  .status-legend small {
    display: none;
  }
}
</style>
