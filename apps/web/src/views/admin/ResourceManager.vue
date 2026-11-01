<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { resources, type Row, type Field } from '@studio/shared';
import { api, notify, errorMessage } from '../../api/http';
import { useApp } from '../../stores/app';
import AppIcon from '../../components/AppIcon.vue';
import DataTable from '../../components/DataTable.vue';
import BaseModal from '../../components/BaseModal.vue';
import FieldEditor from '../../components/FieldEditor.vue';
import MarkdownContent from '../../components/MarkdownContent.vue';
const route = useRoute(),
  app = useApp(),
  resource = computed(() => String(route.meta.resource)),
  definition = computed(() => resources[resource.value]),
  rows = ref<Row[]>([]),
  selected = ref<string[]>([]),
  total = ref(0),
  page = ref(1),
  search = ref(''),
  sort = ref('created_at'),
  order = ref('desc'),
  loading = ref(false),
  busy = ref(false),
  edit = ref<Record<string, unknown> | null>(null),
  editId = ref(''),
  error = ref(''),
  detail = ref<Row | null>(null),
  confirm = ref<{
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null),
  extra = ref<{ kind: 'credits' | 'password' | 'cdks'; row?: Row } | null>(null),
  extraForm = ref<Record<string, unknown>>({}),
  channels = ref<Row[]>([]),
  models = ref<Row[]>([]),
  groups = ref<Row[]>([]),
  filterStatus = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;
const base = computed(() => `/admin/api/manage/${resource.value}`);
async function load() {
  loading.value = true;
  selected.value = [];
  try {
    const result = await api.get<Row[]>(
      `${base.value}?page=${page.value}&search=${encodeURIComponent(search.value)}&sort=${sort.value}&order=${order.value}${filterStatus.value ? `&status=${filterStatus.value}` : ''}`,
    );
    rows.value = result.data;
    total.value = result.total || 0;
  } catch (e) {
    notify(errorMessage(e), 'error');
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  await load();
  if (['model-channels', 'models', 'skills', 'apps'].includes(resource.value)) {
    try {
      const result = await Promise.all([
        api.get<Row[]>('/admin/api/manage/channels?page_size=100'),
        api.get<Row[]>('/admin/api/manage/models?page_size=100'),
        api.get<Row[]>('/admin/api/manage/model-groups?page_size=100'),
      ]);
      channels.value = result[0].data;
      models.value = result[1].data;
      groups.value = result[2].data;
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  }
});
onUnmounted(() => clearTimeout(timer));
function searchRows() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    page.value = 1;
    void load();
  }, 250);
}
function startEdit(row?: Row) {
  error.value = '';
  editId.value = row?.id || '';
  edit.value = Object.fromEntries(
    definition.value.fields.map((field) => [
      field.key,
      row?.[field.key] ??
        field.default ??
        (field.type === 'boolean'
          ? false
          : field.type === 'number'
            ? 0
            : field.type === 'json'
              ? {}
              : ''),
    ]),
  );
  if (resource.value === 'channels') edit.value.api_key = '';
}
function options(field: Field) {
  const list =
    field.key === 'channel_id'
      ? channels.value
      : field.key === 'model_id'
        ? models.value
        : field.key === 'group_id'
          ? groups.value
          : undefined;
  return list?.map((row) => ({
    value: row.id,
    label: `${row.name} · ${row.id}`,
  }));
}
async function save() {
  if (!edit.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (editId.value) await api.put(`${base.value}/${editId.value}`, edit.value);
    else await api.post(base.value, edit.value);
    edit.value = null;
    notify('已保存');
    await load();
    if (resource.value === 'models') await app.refreshModels();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
function remove(row: Row) {
  confirm.value = {
    title: resource.value === 'cdks' ? '作废兑换码' : '删除记录',
    message: `确认删除「${row.name || row.title || row.code || row.id}」？`,
    action: async () => {
      await api.delete(`${base.value}/${row.id}`);
      notify('已删除');
    },
  };
}
const bulkToggleField = computed(
  () =>
    definition.value.fields.find(
      (field) => field.type === 'boolean' && ['enabled', 'published'].includes(field.key),
    )?.key,
);
function bulkAction(action: 'delete' | 'enable' | 'disable') {
  const ids = [...selected.value];
  const label = action === 'delete' ? '删除' : action === 'enable' ? '启用' : '停用';
  confirm.value = {
    title: `批量${label}`,
    message: `确认${label}选中的 ${ids.length} 条记录？`,
    action: async () => {
      let completed = 0;
      try {
        for (const id of ids) {
          if (action === 'delete') await api.delete(`${base.value}/${id}`);
          else if (bulkToggleField.value)
            await api.put(`${base.value}/${id}`, { [bulkToggleField.value]: action === 'enable' });
          completed++;
        }
        notify(`已${label} ${completed} 条记录`);
      } catch (e) {
        await load();
        throw new Error(`已处理 ${completed} 条；${errorMessage(e)}`);
      } finally {
        if (resource.value === 'models') await app.refreshModels();
      }
    },
  };
}
async function confirmAction() {
  if (!confirm.value) return;
  busy.value = true;
  try {
    await confirm.value.action();
    confirm.value = null;
    await load();
  } catch (e) {
    notify(errorMessage(e), 'error');
  } finally {
    busy.value = false;
  }
}
async function test(row: Row) {
  busy.value = true;
  try {
    const { data } = await api.post<{
      ok?: boolean;
      elapsed_ms?: number;
      status?: number;
      id?: string;
    }>(`${base.value}/${row.id}/test`);
    if (resource.value === 'channels')
      notify(
        data.ok
          ? `连接成功 · ${data.elapsed_ms}ms`
          : `连接失败${data.status ? `（HTTP ${data.status}）` : ''}`,
        data.ok ? 'success' : 'error',
      );
    else notify('测试任务已提交，可在生成记录中查看');
    await load();
  } catch (e) {
    notify(errorMessage(e), 'error');
  } finally {
    busy.value = false;
  }
}
async function reorder(ids: string[]) {
  try {
    await api.post(`${base.value}/reorder`, { ids });
    sort.value = 'weight';
    order.value = 'desc';
    await load();
  } catch (e) {
    notify(errorMessage(e), 'error');
  }
}
function changeSort(key: string) {
  if (sort.value === key) order.value = order.value === 'asc' ? 'desc' : 'asc';
  else {
    sort.value = key;
    order.value = 'desc';
  }
  void load();
}
function openExtra(kind: 'credits' | 'password' | 'cdks', row?: Row) {
  extra.value = { kind, row };
  extraForm.value =
    kind === 'cdks'
      ? { count: 10, credits: 100, batch: '', expires_at: '' }
      : kind === 'credits'
        ? { delta: 100, remark: '' }
        : { password: '' };
  error.value = '';
}
async function saveExtra() {
  if (!extra.value) return;
  busy.value = true;
  error.value = '';
  try {
    const e = extra.value;
    if (e.kind === 'cdks')
      await api.post('/admin/api/manage/cdks/batch', {
        ...extraForm.value,
        expires_at: extraForm.value.expires_at
          ? new Date(String(extraForm.value.expires_at)).toISOString()
          : null,
      });
    else await api.post(`/admin/api/manage/users/${e.row!.id}/${e.kind}`, extraForm.value);
    extra.value = null;
    notify('操作成功');
    await load();
    await app.refreshUser();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
const canDelete = computed(
  () =>
    ![
      'users',
      'credit-ledger',
      'orders',
      'request-logs',
      'admin-audit',
      'banned-word-hits',
    ].includes(resource.value),
);
function detailText(row: Row) {
  return JSON.stringify(row, null, 2);
}
</script>
<template>
  <div>
    <header class="page-header">
      <span class="eyebrow">MANAGEMENT</span>
      <h1>{{ definition.title }}</h1>
      <p>
        {{ definition.description || '所有变更即时保存，并记录管理操作。' }}
      </p>
    </header>
    <div class="toolbar">
      <div class="row">
        <label class="search-box">
          <AppIcon name="search" />
          <input
            v-model="search"
            placeholder="搜索记录…"
            aria-label="搜索记录"
            @input="searchRows"
          />
        </label>
        <select
          v-if="['generations', 'orders', 'users'].includes(resource)"
          v-model="filterStatus"
          aria-label="按状态筛选"
          @change="
            page = 1;
            load();
          "
        >
          <option value="">全部状态</option>
          <option
            v-for="s in resource === 'generations'
              ? ['queued', 'running', 'succeeded', 'refunded']
              : resource === 'orders'
                ? ['pending', 'paid', 'cancelled']
                : ['active', 'banned']"
            :key="s"
          >
            {{ s }}
          </option>
        </select>
      </div>
      <div class="row">
        <button class="button" :disabled="loading" @click="load">
          <AppIcon name="refresh" :size="15" />
          刷新
        </button>
        <template v-if="resource === 'cdks'">
          <a class="button" href="/admin/api/manage/cdks/export" download>
            <AppIcon name="download" :size="15" />
            导出
          </a>
          <button class="button primary" @click="openExtra('cdks')">
            <AppIcon name="plus" :size="16" />
            批量生成
          </button>
        </template>
        <button
          v-else-if="!definition.readonly && resource !== 'users'"
          class="button primary"
          @click="startEdit()"
        >
          <AppIcon name="plus" :size="16" />
          新增
        </button>
      </div>
    </div>
    <div v-if="selected.length" class="toolbar">
      <span>已选择 {{ selected.length }} 条</span>
      <div class="row">
        <template v-if="bulkToggleField">
          <button class="button" :disabled="busy" @click="bulkAction('enable')">批量启用</button>
          <button class="button" :disabled="busy" @click="bulkAction('disable')">批量停用</button>
        </template>
        <button v-if="canDelete" class="button" :disabled="busy" @click="bulkAction('delete')">
          批量{{ resource === 'cdks' ? '作废' : '删除' }}
        </button>
      </div>
    </div>
    <DataTable
      v-model:selected="selected"
      :selectable="canDelete || !!bulkToggleField"
      :rows="rows"
      :definition="definition"
      :loading="loading"
      @sort="changeSort"
      @reorder="reorder"
    >
      <template #actions="{ row }">
        <button v-if="!definition.readonly" @click="startEdit(row)">编辑</button>
        <button
          v-if="['channels', 'models'].includes(resource)"
          :disabled="busy"
          @click="test(row)"
        >
          测试
        </button>
        <template v-if="resource === 'users'">
          <button @click="openExtra('credits', row)">积分</button>
          <button @click="openExtra('password', row)">重置密码</button>
        </template>
        <button
          v-if="resource === 'orders' && row.status === 'pending'"
          @click="
            confirm = {
              title: '确认充值到账',
              message: `确认已收到此订单款项 ¥${(Number(row.amount_cents) / 100).toFixed(2)}，并发放 ${row.credits} 积分？`,
              action: async () => {
                await api.post(`${base}/${row.id}/confirm`);
                notify('已确认到账并发放积分');
              },
            }
          "
        >
          确认到账
        </button>
        <button
          v-if="resource === 'generations' && row.status === 'succeeded' && row.type === 'image'"
          @click="
            confirm = {
              title: '加入首页精选',
              message: '此图片和提示词将在首页公开展示。',
              action: async () => {
                await api.post(`${base}/${row.id}/showcase`);
                notify('已加入精选');
              },
            }
          "
        >
          设为精选
        </button>
        <button v-if="definition.readonly" @click="detail = row">详情</button>
        <button v-if="canDelete" @click="remove(row)">
          {{ resource === 'cdks' ? '作废' : '删除' }}
        </button>
      </template>
    </DataTable>
    <div class="pagination">
      <span>
        共 {{ total }} 条记录
        <small v-if="!definition.readonly && resource !== 'users'">· 拖动行可调整顺序</small>
      </span>
      <div class="row">
        <button
          class="icon-button"
          :disabled="page === 1"
          aria-label="上一页"
          @click="
            page--;
            load();
          "
        >
          <AppIcon name="left" />
        </button>
        <span>{{ page }} / {{ Math.max(1, Math.ceil(total / 20)) }}</span>
        <button
          class="icon-button"
          :disabled="page * 20 >= total"
          aria-label="下一页"
          @click="
            page++;
            load();
          "
        >
          <AppIcon name="right" />
        </button>
      </div>
    </div>
    <BaseModal
      v-if="edit"
      :title="`${editId ? '编辑' : '新增'} · ${definition.title}`"
      wide
      @close="edit = null"
    >
      <form @submit.prevent="save">
        <div class="form-grid">
          <label v-if="!editId && resource === 'models'" class="field field-wide">
            <span>模型对外 ID *</span>
            <input
              v-model="edit.id"
              required
              pattern="[a-zA-Z0-9_.-]{1,120}"
              placeholder="例如：my-image-model"
            />
            <small class="muted">对外 API 使用此标识；创建后不可修改。</small>
          </label>
          <FieldEditor
            v-for="field in definition.fields"
            :key="field.key"
            v-model="edit[field.key]"
            :field="field"
            :options="options(field)"
          />
        </div>
        <div v-if="edit.content_md" class="markdown-preview">
          <h3>正文预览</h3>
          <MarkdownContent :text="String(edit.content_md)" />
        </div>
        <p v-if="error" class="error-text form-error" role="alert">
          {{ error }}
        </p>
        <div class="form-actions">
          <button type="button" class="button" @click="edit = null">取消</button>
          <button class="button primary" :disabled="busy">
            <AppIcon v-if="busy" name="loader" class="spin" />
            保存
          </button>
        </div>
      </form>
    </BaseModal>
    <BaseModal v-if="confirm" :title="confirm.title" @close="confirm = null">
      <p>{{ confirm.message }}</p>
      <div class="form-actions">
        <button class="button" @click="confirm = null">取消</button>
        <button class="button primary" :disabled="busy" @click="confirmAction">确认</button>
      </div>
    </BaseModal>
    <BaseModal
      v-if="extra"
      :title="
        extra.kind === 'cdks'
          ? '批量生成兑换码'
          : extra.kind === 'credits'
            ? '调整用户积分'
            : '重置用户密码'
      "
      @close="extra = null"
    >
      <form class="stack" @submit.prevent="saveExtra">
        <template v-if="extra.kind === 'cdks'">
          <label class="field">
            <span>数量（最多 500）</span>
            <input v-model.number="extraForm.count" type="number" min="1" max="500" required />
          </label>
          <label class="field">
            <span>每个兑换码的积分</span>
            <input v-model.number="extraForm.credits" type="number" min="1" required />
          </label>
          <label class="field">
            <span>批次名称</span>
            <input v-model="extraForm.batch" maxlength="80" />
          </label>
          <label class="field">
            <span>过期时间（选填）</span>
            <input v-model="extraForm.expires_at" type="datetime-local" />
          </label>
        </template>
        <template v-else-if="extra.kind === 'credits'">
          <p>{{ extra.row?.email }} · 当前 {{ extra.row?.credits }} 积分</p>
          <label class="field">
            <span>调整数量（负数为扣除）</span>
            <input v-model.number="extraForm.delta" type="number" required />
          </label>
          <label class="field">
            <span>备注</span>
            <input v-model="extraForm.remark" maxlength="300" />
          </label>
        </template>
        <label v-else class="field">
          <span>新密码（至少 12 位）</span>
          <input
            v-model="extraForm.password"
            type="password"
            minlength="12"
            maxlength="128"
            required
            autocomplete="new-password"
          />
          <small>更新后将退出该账户的所有登录会话。</small>
        </label>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
        <button class="button primary" :disabled="busy">确认提交</button>
      </form>
    </BaseModal>
    <BaseModal v-if="detail" title="记录详情" wide @close="detail = null">
      <template v-if="resource === 'generations'">
        <div
          v-for="(asset, i) in detail.result_assets as {
            url?: string;
            text?: string;
            mime?: string;
          }[]"
          :key="i"
        >
          <MarkdownContent v-if="asset.text" :text="asset.text" />
          <video
            v-else-if="asset.mime?.startsWith('video')"
            :src="asset.url"
            controls
            class="detail-media"
          />
          <img v-else :src="asset.url" alt="生成作品" class="detail-media" />
        </div>
      </template>
      <pre class="detail-json">{{ detailText(detail) }}</pre>
    </BaseModal>
  </div>
</template>
<style scoped>
.toolbar select {
  width: 145px;
  font-size: 12px;
}
.toolbar > .row {
  max-width: 100%;
  flex-wrap: wrap;
}
.markdown-preview {
  margin-top: 25px;
  padding: 20px;
  background: var(--app-bg);
  border: 1px solid var(--hairline);
  border-radius: 10px;
}
.markdown-preview > h3 {
  font-size: 12px;
  color: var(--fg-3);
  margin-bottom: 20px;
}
.form-error {
  margin-top: 20px;
  font-size: 12px;
}
.detail-json {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--code-bg);
  padding: 18px;
  border-radius: 8px;
  max-height: 60vh;
  overflow: auto;
}
.detail-media {
  max-height: 60vh;
  max-width: 100%;
  object-fit: contain;
  margin: 0 auto 20px;
  border-radius: 10px;
}
.pagination small {
  font-size: 10px;
  margin-left: 8px;
}
@media (max-width: 639px) {
  .toolbar {
    gap: 12px;
  }
  .toolbar > .row {
    width: 100%;
    justify-content: space-between;
  }
  .toolbar .search-box {
    width: 100%;
    max-width: none;
  }
  .toolbar select {
    width: 100%;
  }
  .pagination small {
    display: none;
  }
}
</style>
