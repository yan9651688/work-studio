<script setup lang="ts">
import { ref } from 'vue';
import { resources, type Field, type Row } from '@studio/shared';
import AppIcon from '../../components/AppIcon.vue';
import BaseModal from '../../components/BaseModal.vue';
import DataTable from '../../components/DataTable.vue';
import EmptyState from '../../components/EmptyState.vue';
import FieldEditor from '../../components/FieldEditor.vue';
import MarkdownContent from '../../components/MarkdownContent.vue';
import { notify } from '../../api/http';
const modal = ref(false),
  selected = ref<string[]>([]);
const values = ref<Record<string, unknown>>({
  name: '示例模型',
  enabled: true,
  resolutions: ['1K'],
  prices: { '1K': 8 },
  provider_type: 'openai',
  description: '',
});
const fields: Field[] = [
  { key: 'name', label: '名称', type: 'text', required: true },
  { key: 'enabled', label: '状态', type: 'boolean' },
  {
    key: 'provider_type',
    label: '协议',
    type: 'select',
    options: ['openai', 'gemini', 'custom-http'],
  },
  { key: 'description', label: '描述', type: 'textarea' },
  { key: 'resolutions', label: '分辨率', type: 'json' },
  { key: 'prices', label: '积分价格', type: 'json' },
];
const rows = ref<Row[]>([
  {
    id: 'demo',
    name: '组件示例',
    provider_type: 'openai',
    base_url: 'https://example.com/v1',
    enabled: true,
    created_at: '',
    updated_at: '',
  },
]);
</script>
<template>
  <div class="page component-demo">
    <header class="page-header">
      <div>
        <h1>基础组件</h1>
        <p class="muted">检查交互、键盘操作与明暗主题。这里的操作只影响当前演示。</p>
      </div>
    </header>
    <section class="card">
      <h2>按钮与状态</h2>
      <div class="row">
        <button class="button primary" @click="modal = true">打开弹窗</button>
        <button class="button" @click="notify('操作成功')">
          <AppIcon name="check" />
          显示提示
        </button>
        <button class="button" disabled>
          <AppIcon name="loader" class="spin" />
          处理中
        </button>
        <span class="badge success">运行正常</span>
        <span class="badge danger">需要处理</span>
      </div>
    </section>
    <section class="card">
      <h2>表单</h2>
      <div class="form-grid">
        <FieldEditor
          v-for="field in fields"
          :key="field.key"
          v-model="values[field.key]"
          :field="field"
        />
      </div>
    </section>
    <section class="card">
      <h2>表格与多选</h2>
      <DataTable
        v-model:selected="selected"
        :rows="rows"
        :definition="resources.channels"
        selectable
      >
        <template #actions><button @click="notify('这是演示数据')">编辑</button></template>
      </DataTable>
      <p class="muted">已选择 {{ selected.length }} 项</p>
    </section>
    <section class="card">
      <h2>空状态与正文</h2>
      <EmptyState title="暂无记录" description="完成第一次创作后即可在此查看。" />
      <MarkdownContent :text="'### 调用示例\n支持 **Markdown** 正文、表格和可复制的代码块。'" />
    </section>
    <BaseModal v-if="modal" title="弹窗示例" @close="modal = false">
      <p>Tab 在弹窗内移动焦点；Esc 关闭并恢复原来的焦点。</p>
      <label class="field">
        <span>示例输入</span>
        <input placeholder="输入内容" />
      </label>
      <button class="button primary" @click="modal = false">完成</button>
    </BaseModal>
  </div>
</template>
<style scoped>
.component-demo {
  display: grid;
  gap: 24px;
}
.card {
  padding: 24px;
}
h2 {
  margin: 0 0 20px;
  font-size: 18px;
}
.row {
  flex-wrap: wrap;
}
</style>
