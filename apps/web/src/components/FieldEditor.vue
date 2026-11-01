<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Field } from '@studio/shared';
import { api, notify, errorMessage } from '../api/http';
import AppIcon from './AppIcon.vue';
const props = defineProps<{
  field: Field;
  modelValue: unknown;
  options?: { value: string; label: string }[];
}>();
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();
const busy = ref(false);
const invalid = ref('');
const rawJson = ref<string | null>(null);
const newOption = ref('');
const newPriceKey = ref('');
const arrayChoices: Record<string, (string | number)[]> = {
  ratios: ['1:1', '16:9', '9:16', '3:2', '3:4', '21:9'],
  resolutions: ['1K', '2K', '4K'],
  image_qualities: ['standard', 'high', 'hd'],
  durations: [5, 10, 15, 20],
};
const choices = computed(() => [
  ...new Set([
    ...(arrayChoices[props.field.key] || []),
    ...(Array.isArray(props.modelValue) ? props.modelValue : []),
  ]),
]);
const prices = computed(() =>
  props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue)
    ? (props.modelValue as Record<string, number>)
    : {},
);
function toggleChoice(choice: string | number) {
  const selected = Array.isArray(props.modelValue) ? [...props.modelValue] : [];
  const index = selected.indexOf(choice);
  if (index < 0) selected.push(choice);
  else selected.splice(index, 1);
  emit('update:modelValue', selected);
}
function addChoice() {
  if (!newOption.value.trim()) return;
  const v = props.field.key === 'durations' ? Number(newOption.value) : newOption.value.trim();
  if (typeof v === 'number' && (!Number.isFinite(v) || v <= 0)) return;
  emit('update:modelValue', [
    ...new Set([...(Array.isArray(props.modelValue) ? props.modelValue : []), v]),
  ]);
  newOption.value = '';
}
function setPrice(key: string, v: number) {
  emit('update:modelValue', { ...prices.value, [key]: v });
}
function removePrice(key: string) {
  const data = { ...prices.value };
  delete data[key];
  emit('update:modelValue', data);
}
function addPrice() {
  const key = newPriceKey.value.trim();
  if (!key || ['__proto__', 'constructor', 'prototype'].includes(key)) return;
  setPrice(key, 0);
  newPriceKey.value = '';
}
const value = computed(() => props.modelValue ?? '');
const json = computed(
  () => rawJson.value ?? JSON.stringify(props.modelValue ?? props.field.default ?? {}, null, 2),
);
function updateJson(event: Event) {
  const text = (event.target as HTMLTextAreaElement).value;
  rawJson.value = text;
  try {
    const data = JSON.parse(text);
    emit('update:modelValue', data);
    invalid.value = '';
    (event.target as HTMLTextAreaElement).setCustomValidity('');
  } catch {
    invalid.value = '请输入有效 JSON';
    (event.target as HTMLTextAreaElement).setCustomValidity(invalid.value);
  }
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  busy.value = true;
  try {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post<{ url: string }>('/admin/api/manage/uploads', form);
    emit('update:modelValue', data.url);
  } catch (error) {
    notify(errorMessage(error), 'error');
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <component
    :is="
      arrayChoices[field.key] || ['prices', 'text_pricing'].includes(field.key) ? 'div' : 'label'
    "
    class="field"
    :class="{
      'field-wide': field.type === 'textarea' || field.type === 'json',
    }"
  >
    <span>
      {{ field.label }}
      <b v-if="field.required">*</b>
    </span>
    <template v-if="field.type === 'boolean'">
      <span class="switch-line">
        <input
          type="checkbox"
          class="switch"
          :checked="Boolean(value)"
          @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
        />
        {{ value ? '已启用' : '已关闭' }}
      </span>
    </template>
    <select
      v-else-if="options || field.type === 'select'"
      :value="value"
      :required="field.required"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">请选择</option>
      <option
        v-for="opt in options || field.options?.map((v) => ({ value: v, label: v }))"
        :key="opt.value"
        :value="opt.value"
      >
        {{ opt.label }}
      </option>
    </select>
    <div v-else-if="arrayChoices[field.key]" class="array-editor">
      <div class="choices">
        <button
          v-for="choice in choices"
          :key="String(choice)"
          type="button"
          :class="{ selected: Array.isArray(modelValue) && modelValue.includes(choice) }"
          @click.prevent="toggleChoice(choice)"
        >
          {{ choice }}{{ field.key === 'durations' ? ' 秒' : '' }}
        </button>
      </div>
      <div class="input-action">
        <input
          v-model="newOption"
          placeholder="添加自定义选项"
          @keydown.enter.prevent="addChoice"
        />
        <button type="button" class="button small" @click.prevent="addChoice">添加</button>
      </div>
    </div>
    <div v-else-if="field.key === 'prices' || field.key === 'text_pricing'" class="price-editor">
      <div v-for="(amount, key) in prices" :key="key" class="input-action">
        <span>{{ key }}</span>
        <input
          type="number"
          :value="amount"
          min="0"
          step="any"
          :aria-label="`${key} 积分价格`"
          @input="setPrice(String(key), Number(($event.target as HTMLInputElement).value))"
        />
        <button
          type="button"
          class="icon-button"
          :aria-label="`移除 ${key} 价格`"
          @click.prevent="removePrice(String(key))"
        >
          <AppIcon name="x" :size="14" />
        </button>
      </div>
      <div class="input-action">
        <input
          v-model="newPriceKey"
          :placeholder="
            field.key === 'prices'
              ? '价格档位，例如 1K 或 default'
              : 'input_per_million 或 output_per_million'
          "
          @keydown.enter.prevent="addPrice"
        />
        <button class="button small" type="button" @click.prevent="addPrice">添加价格</button>
      </div>
    </div>
    <textarea
      v-else-if="field.type === 'json'"
      class="code-input"
      :value="json"
      rows="5"
      spellcheck="false"
      @input="updateJson"
    />
    <textarea
      v-else-if="field.type === 'textarea'"
      :value="String(value)"
      rows="5"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
    <template v-else-if="field.type === 'image'">
      <div class="input-action">
        <input
          :value="String(value)"
          placeholder="图片 URL 或上传图片"
          @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        />
        <span class="upload-button">
          <AppIcon :name="busy ? 'loader' : 'upload'" />
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
            aria-label="上传图片"
            @change="upload"
          />
        </span>
      </div>
      <img v-if="value" class="field-preview" :src="String(value)" alt="预览" />
    </template>
    <input
      v-else
      :type="field.type === 'number' ? 'number' : field.type === 'secret' ? 'password' : 'text'"
      :min="field.type === 'number' ? 0 : undefined"
      :value="String(value)"
      :required="field.required"
      :autocomplete="field.type === 'secret' ? 'new-password' : undefined"
      @input="
        emit(
          'update:modelValue',
          field.type === 'number'
            ? Number(($event.target as HTMLInputElement).value)
            : ($event.target as HTMLInputElement).value,
        )
      "
    />
    <small v-if="field.hint">{{ field.hint }}</small>
    <small v-if="invalid" class="error-text">{{ invalid }}</small>
  </component>
</template>
<style scoped>
.array-editor,
.price-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.choices button {
  border: 1px solid var(--hairline);
  border-radius: 7px;
  padding: 6px 12px;
  font-size: 12px;
}
.choices button.selected {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent);
}
.price-editor .input-action {
  align-items: center;
}
.price-editor .input-action > span {
  min-width: 130px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.array-editor input,
.price-editor input {
  font-size: 12px;
}
</style>
