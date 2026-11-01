<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Field } from '@studio/shared';
import { api, notify, errorMessage } from '../../api/http';
import { useApp } from '../../stores/app';
import AppIcon from '../../components/AppIcon.vue';
import FieldEditor from '../../components/FieldEditor.vue';
const app = useApp(),
  settings = ref<Record<string, unknown>>({}),
  hero = ref<Record<string, unknown>>({}),
  contact = ref<Record<string, unknown>>({}),
  loading = ref(true),
  busy = ref(false),
  tab = ref('brand'),
  error = ref('');
const brandFields: Field[] = [
  { key: 'title', label: '站点名称', required: true },
  { key: 'subtitle', label: '站点副标题' },
  { key: 'logo', label: 'Logo', type: 'image' },
  { key: 'favicon', label: '浏览器图标', type: 'image' },
  { key: 'avatar', label: '默认头像', type: 'image' },
  { key: 'media_cdn_url', label: '媒体 CDN 地址' },
  { key: 'footer', label: '页脚文案', type: 'textarea' },
  {
    key: 'seo',
    label: 'SEO 设置',
    type: 'json',
    hint: 'description：站点简介。',
  },
];
const heroFields: Field[] = [
  { key: 'eyebrow', label: '首页英文眉题' },
  { key: 'title', label: '首页标题（换行可分两行）', type: 'textarea' },
  { key: 'subtitle', label: '首页副标题' },
  { key: 'placeholder', label: '创作输入框提示' },
  { key: 'image', label: '首页主视觉图片', type: 'image' },
];
const contactFields: Field[] = [
  ['email', '联系邮箱'],
  ['wechat', '微信号'],
  ['wechat_qr', '微信二维码'],
  ['qq', 'QQ'],
  ['qq_link', 'QQ 链接'],
  ['qq_group', 'QQ 群'],
  ['qq_group_link', 'QQ群链接'],
  ['phone', '联系电话'],
  ['hours', '服务时间'],
  ['shop', '店铺链接'],
  ['note', '联系说明'],
].map(([key, label]) => ({
  key,
  label,
  type: key === 'wechat_qr' ? 'image' : key === 'note' ? 'textarea' : 'text',
}));
const ruleFields: Field[] = [
  { key: 'register_enabled', label: '开放注册', type: 'boolean' },
  { key: 'cdk_redeem_enabled', label: '开启兑换码', type: 'boolean' },
  { key: 'default_credits', label: '注册赠送积分', type: 'number' },
  {
    key: 'invite_reward',
    label: '邀请奖励积分',
    type: 'number',
    hint: '受邀用户首次充值确认后发放。',
  },
  { key: 'concurrency', label: '每位用户最多同时进行的任务', type: 'number' },
  { key: 'retry_count', label: '失败后最多切换渠道次数', type: 'number' },
  { key: 'circuit_threshold', label: '连续失败熔断阈值', type: 'number' },
  { key: 'circuit_cooldown_seconds', label: '熔断冷却（秒）', type: 'number' },
];
onMounted(async () => {
  try {
    settings.value = (await api.get<Record<string, unknown>>('/admin/api/manage/settings')).data;
    hero.value = { ...(settings.value.home_hero as Record<string, unknown>) };
    contact.value = { ...(settings.value.contact as Record<string, unknown>) };
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
});
async function save() {
  busy.value = true;
  error.value = '';
  try {
    await api.put('/admin/api/manage/settings', {
      ...settings.value,
      home_hero: hero.value,
      contact: contact.value,
    });
    await app.refreshSite();
    notify('站点配置已更新');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <header class="page-header">
    <span class="eyebrow">SITE SETTINGS</span>
    <h1>站点配置</h1>
    <p>站点品牌、首页内容与运营参数，统一在这里维护。</p>
  </header>
  <div class="settings-layout">
    <nav class="settings-tabs">
      <button
        v-for="[id, label, icon] in [
          ['brand', '品牌与外观', 'sparkles'],
          ['home', '首页主视觉', 'image'],
          ['contact', '联系方式', 'user'],
          ['rules', '运营与网关', 'sliders'],
        ]"
        :key="id"
        :class="{ active: tab === id }"
        @click="tab = id"
      >
        <AppIcon :name="icon" :size="17" />
        {{ label }}
        <AppIcon name="right" :size="14" />
      </button>
    </nav>
    <form class="card settings-form" @submit.prevent="save">
      <div v-if="loading" class="skeleton" />
      <div v-else class="form-grid">
        <template v-if="tab === 'brand'">
          <FieldEditor
            v-for="field in brandFields"
            :key="field.key"
            v-model="settings[field.key]"
            :field="field"
          />
        </template>
        <template v-else-if="tab === 'home'">
          <FieldEditor
            v-for="field in heroFields"
            :key="field.key"
            v-model="hero[field.key]"
            :field="field"
          />
        </template>
        <template v-else-if="tab === 'contact'">
          <FieldEditor
            v-for="field in contactFields"
            :key="field.key"
            v-model="contact[field.key]"
            :field="field"
          />
        </template>
        <template v-else>
          <FieldEditor
            v-for="field in ruleFields"
            :key="field.key"
            v-model="settings[field.key]"
            :field="field"
          />
        </template>
      </div>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <div class="form-actions">
        <button class="button primary" :disabled="busy || loading">
          <AppIcon :name="busy ? 'loader' : 'check'" :class="{ spin: busy }" />
          保存配置
        </button>
      </div>
    </form>
  </div>
</template>
<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.settings-tabs {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.settings-tabs button {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px;
  text-align: left;
  border-radius: 8px;
  font-size: 13px;
  color: var(--fg-3);
}
.settings-tabs button > svg:last-child {
  margin-left: auto;
}
.settings-tabs .active {
  background: var(--accent-soft);
  color: var(--accent);
}
.settings-form {
  padding: 28px;
}
.settings-form > .error-text {
  margin-top: 20px;
  font-size: 12px;
}
@media (max-width: 1000px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }
  .settings-tabs {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .settings-tabs button {
    font-size: 12px;
    padding: 9px 12px;
  }
  .settings-tabs button > svg:last-child {
    display: none;
  }
  .settings-form {
    padding: 20px;
  }
}
</style>
