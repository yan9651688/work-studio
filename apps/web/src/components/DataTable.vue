<script setup lang="ts">
import { columnLabels, statusLabels } from '../api/labels';
import { computed, ref } from 'vue';
import type { Row, Resource } from '@studio/shared';
import AppIcon from './AppIcon.vue';
import EmptyState from './EmptyState.vue';
const props = defineProps<{
  rows: Row[];
  definition: Resource;
  loading?: boolean;
  selectable?: boolean;
}>();
const selected = defineModel<string[]>('selected', { default: () => [] });
const allSelected = computed(
  () => props.rows.length > 0 && props.rows.every((row) => selected.value.includes(row.id)),
);
function selectAll(event: Event) {
  selected.value = (event.target as HTMLInputElement).checked
    ? props.rows.map((row) => row.id)
    : [];
}
const emit = defineEmits<{ sort: [key: string]; reorder: [ids: string[]] }>();
const dragged = ref('');
function display(v: unknown) {
  if (v === true) return '启用';
  if (v === false) return '关闭';
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
</script>
<template>
  <div class="table-wrap" :aria-busy="loading">
    <div v-if="loading" class="table-loading">
      <AppIcon name="loader" class="spin" />
      正在加载
    </div>
    <table v-if="rows.length">
      <thead>
        <tr>
          <th v-if="selectable">
            <input
              type="checkbox"
              aria-label="全选当前页"
              :checked="allSelected"
              @change="selectAll"
            />
          </th>
          <th v-for="key in definition.columns" :key="key">
            <button @click="emit('sort', key)">
              {{ definition.fields.find((f) => f.key === key)?.label || columnLabels[key] || key }}
              <AppIcon name="down" :size="12" />
            </button>
          </th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          :draggable="!definition.readonly"
          @dragstart="dragged = row.id"
          @dragover.prevent
          @drop.prevent="
            emit(
              'reorder',
              (() => {
                const ids = rows.map((r) => r.id);
                ids.splice(ids.indexOf(dragged), 1);
                ids.splice(ids.indexOf(row.id), 0, dragged);
                return ids;
              })(),
            )
          "
        >
          <td v-if="selectable">
            <input
              v-model="selected"
              type="checkbox"
              :value="row.id"
              :aria-label="`选择 ${row.name || row.title || row.code || row.id}`"
            />
          </td>
          <td v-for="key in definition.columns" :key="key" :title="display(row[key])">
            <img
              v-if="key === 'image_url' && row[key]"
              class="table-thumb"
              :src="String(row[key])"
              alt="作品"
            />
            <span
              v-else-if="key === 'enabled' || key === 'published'"
              class="badge"
              :class="row[key] ? 'success' : ''"
            >
              {{ row[key] ? '已启用' : '已停用' }}
            </span>
            <span
              v-else-if="key === 'status'"
              class="badge"
              :class="{
                success: ['active', 'paid', 'succeeded'].includes(String(row[key])),
                danger: ['banned', 'failed', 'refunded'].includes(String(row[key])),
              }"
            >
              {{ statusLabels[String(row[key])] || row[key] }}
            </span>
            <span v-else>
              {{
                key === 'created_at'
                  ? new Date(String(row[key])).toLocaleString()
                  : display(row[key])
              }}
            </span>
          </td>
          <td>
            <div class="row-actions"><slot name="actions" :row="row" /></div>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState
      v-else-if="!loading"
      title="暂无记录"
      description="新增内容或调整搜索条件后，记录会出现在这里。"
    />
  </div>
</template>
