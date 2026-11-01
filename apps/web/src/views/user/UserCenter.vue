<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { resources, type Row, type Generation } from '@studio/shared';
import { useApp } from '../../stores/app';
import { api, copy, notify, errorMessage } from '../../api/http';
import AppIcon from '../../components/AppIcon.vue';
import BaseModal from '../../components/BaseModal.vue';
import EmptyState from '../../components/EmptyState.vue';
import DataTable from '../../components/DataTable.vue';
const app = useApp(),
  route = useRoute(),
  rows = ref<Row[]>([]),
  plans = ref<Row[]>([]),
  generations = ref<Generation[]>([]),
  loading = ref(false),
  busy = ref(false),
  page = ref(1),
  total = ref(0),
  code = ref(''),
  keyName = ref(''),
  keyQuota = ref(0),
  keyModels = ref<string[]>([]),
  newKey = ref(''),
  showKeyForm = ref(false),
  username = ref(app.user?.username || ''),
  oldPassword = ref(''),
  newPassword = ref(''),
  inviteCode = ref(''),
  invites = ref<Row[]>([]),
  confirm = ref<{
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);
const location = window.location;
const tab = computed(() =>
  route.path.startsWith('/admin') ? 'api-keys' : route.path.split('/')[1] || 'user',
);
const navigation = [
  ['user', '个人概览', 'user'],
  ['api-keys', 'API Key', 'key'],
  ['recharge', '充值与兑换', 'wallet'],
  ['orders', '充值订单', 'wallet'],
  ['credit-usage', '积分明细', 'activity'],
  ['mylogs', '调用记录', 'history'],
  ['invite', '邀请好友', 'gift'],
  ['settings', '账户设置', 'settings'],
];
const title = computed(() => navigation.find((n) => n[0] === tab.value)?.[1] || '个人中心');
const tableResource = computed(() =>
  tab.value === 'credit-usage'
    ? 'credit-ledger'
    : tab.value === 'mylogs'
      ? 'request-logs'
      : 'orders',
);
const requestPath = computed(() =>
  tab.value === 'credit-usage' ? 'credit-ledger' : tab.value === 'mylogs' ? 'logs' : tab.value,
);
async function load() {
  loading.value = true;
  try {
    await app.refreshUser();
    if (tab.value === 'user')
      generations.value = (await api.get<Generation[]>('/api/user/generations?page_size=6')).data;
    else if (tab.value === 'recharge')
      plans.value = (await api.get<Row[]>('/admin/api/recharge-plans')).data;
    else if (tab.value === 'invite') {
      const { data } = await api.get<{ invite_code: string; invites: Row[] }>('/api/user/invite');
      inviteCode.value = data.invite_code;
      invites.value = data.invites;
    } else if (tab.value !== 'settings') {
      const data = await api.get<Row[]>(`/api/user/${requestPath.value}?page=${page.value}`);
      rows.value = data.data;
      total.value = data.total || data.data.length;
    }
  } catch (e) {
    notify(errorMessage(e), 'error');
  } finally {
    loading.value = false;
  }
}
onMounted(load);
async function run(action: () => Promise<void>) {
  busy.value = true;
  try {
    await action();
  } catch (e) {
    notify(errorMessage(e), 'error');
  } finally {
    busy.value = false;
  }
}
async function createKey() {
  await run(async () => {
    const { data } = await api.post<{ key: string }>('/api/user/api-keys', {
      name: keyName.value,
      quota_limit: keyQuota.value,
      allowed_models: keyModels.value,
    });
    newKey.value = data.key;
    showKeyForm.value = false;
    keyName.value = '';
    await load();
  });
}
async function redeem() {
  await run(async () => {
    await api.post('/api/user/cdk/redeem', { code: code.value });
    code.value = '';
    await app.refreshUser();
    notify('兑换成功，积分已到账');
  });
}
async function recharge(plan: Row) {
  confirm.value = {
    title: '提交充值订单',
    message: `${plan.name} · ¥${(Number(plan.price_cents) / 100).toFixed(2)}。提交后请按站点联系方式付款，由管理员确认到账。`,
    action: async () => {
      await api.post('/api/user/recharge', { plan_id: plan.id });
      notify('订单已创建，请联系管理员完成付款确认');
    },
  };
}
async function confirmAction() {
  if (!confirm.value) return;
  await run(async () => {
    await confirm.value!.action();
    confirm.value = null;
    await load();
  });
}
async function saveProfile() {
  await run(async () => {
    await api.put('/api/user/profile', { username: username.value });
    await app.refreshUser();
    notify('用户名已更新');
  });
}
async function changePassword() {
  await run(async () => {
    await api.post('/api/auth/password', {
      current_password: oldPassword.value,
      password: newPassword.value,
    });
    oldPassword.value = '';
    newPassword.value = '';
    notify('密码已更新，其他登录会话已退出');
  });
}
const inviteUrl = computed(
  () => `${window.location.origin}/login?register=1&invite=${encodeURIComponent(inviteCode.value)}`,
);
</script>
<template>
  <div class="page user-page">
    <header class="page-header">
      <span class="eyebrow">YOUR WORKSPACE</span>
      <h1>{{ title }}</h1>
      <p>管理你的创作、积分与 API 接入。</p>
    </header>
    <nav v-if="!route.path.startsWith('/admin')" class="user-nav">
      <RouterLink
        v-for="[id, label, icon] in navigation"
        :key="id"
        :to="id === 'user' ? '/user' : '/' + id"
        :class="{ active: tab === id }"
      >
        <AppIcon :name="icon" :size="15" />
        {{ label }}
      </RouterLink>
    </nav>
    <template v-if="tab === 'user'">
      <section class="welcome-card card">
        <div>
          <p>欢迎回来，{{ app.user?.username }}</p>
          <h2>让今天的灵感，成为下一件作品。</h2>
          <RouterLink class="button primary" to="/create">
            <AppIcon name="sparkles" />
            开始创作
          </RouterLink>
        </div>
        <div class="balance">
          <span>可用积分</span>
          <strong>{{ app.user?.credits.toLocaleString() }}</strong>
          <RouterLink to="/recharge" class="text-link">
            充值 / 兑换
            <AppIcon name="arrow" :size="14" />
          </RouterLink>
        </div>
      </section>
      <div class="section-header">
        <h2>最近的创作</h2>
        <RouterLink to="/create" class="text-link">
          全部记录
          <AppIcon name="arrow" :size="14" />
        </RouterLink>
      </div>
      <div v-if="generations.length" class="recent-grid">
        <RouterLink v-for="g in generations" :key="g.id" :to="'/create/' + g.id" class="card">
          <img
            v-if="g.result_assets[0]?.thumb_url"
            :src="g.result_assets[0].thumb_url"
            alt="创作缩略图"
          />
          <div v-else class="generation-placeholder">
            <AppIcon :name="g.type === 'text' ? 'pen' : 'image'" :size="35" />
          </div>
          <h3 class="line-clamp">{{ g.prompt }}</h3>
          <small>
            {{ new Date(g.created_at).toLocaleDateString() }} · {{ g.cost_credits }} 积分
          </small>
        </RouterLink>
      </div>
      <EmptyState
        v-else
        title="你的作品集，从第一件开始"
        description="用一句描述开启创作，生成记录会自动保存。"
        icon="image"
      />
    </template>
    <template v-else-if="tab === 'api-keys'">
      <div class="toolbar">
        <p>密钥仅在创建时完整显示，请妥善保存。</p>
        <button class="button primary" @click="showKeyForm = true">
          <AppIcon name="plus" />
          创建 API Key
        </button>
      </div>
      <div class="table-wrap">
        <table v-if="rows.length">
          <thead>
            <tr>
              <th>名称</th>
              <th>Key 前缀</th>
              <th>已用 / 配额</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in rows" :key="key.id">
              <td>{{ key.name }}</td>
              <td>
                <code>{{ key.key_prefix }}••••••••</code>
              </td>
              <td>{{ key.used }} / {{ Number(key.quota_limit) || '不限' }}</td>
              <td>
                <span class="badge" :class="key.enabled ? 'success' : ''">
                  {{ key.enabled ? '启用' : '已撤销' }}
                </span>
              </td>
              <td>
                <button
                  v-if="key.enabled"
                  class="text-link"
                  @click="
                    confirm = {
                      title: '撤销 API Key',
                      message: '撤销后，使用此密钥的应用将无法继续调用。',
                      action: async () => {
                        await api.delete('/api/user/api-keys/' + key.id);
                        notify('密钥已撤销');
                      },
                    }
                  "
                >
                  撤销
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState
          v-else
          icon="key"
          title="还没有 API Key"
          description="创建密钥后，可通过 OpenAI 兼容接口接入本站模型。"
        />
      </div>
      <div class="notice api-help">
        接入地址：
        <code>{{ location.origin }}/v1</code>
        <RouterLink to="/docs/models" class="text-link">
          查看调用示例
          <AppIcon name="arrow" :size="14" />
        </RouterLink>
      </div>
    </template>
    <template v-else-if="tab === 'recharge'">
      <div class="two-col">
        <section class="card">
          <div class="section-header">
            <h2>积分余额</h2>
            <AppIcon name="wallet" />
          </div>
          <strong class="big-balance">
            {{ app.user?.credits.toLocaleString() }}
            <small>积分</small>
          </strong>
          <p>每次生成前预扣积分，失败后自动退款。</p>
        </section>
        <form v-if="app.site.cdk_redeem_enabled" class="card stack" @submit.prevent="redeem">
          <h2>兑换积分</h2>
          <p>输入兑换码，积分将即时到账。</p>
          <div class="input-action">
            <input
              v-model="code"
              placeholder="输入兑换码"
              aria-label="兑换码"
              required
              minlength="6"
            />
            <button class="button primary" :disabled="busy">兑换</button>
          </div>
        </form>
      </div>
      <div class="section-header recharge-heading">
        <h2>充值套餐</h2>
        <RouterLink to="/orders" class="text-link">
          查看订单
          <AppIcon name="arrow" :size="14" />
        </RouterLink>
      </div>
      <div class="content-grid">
        <article v-for="plan in plans" :key="plan.id" class="card recharge-plan">
          <h3>{{ plan.name }}</h3>
          <strong>¥{{ (Number(plan.price_cents) / 100).toFixed(2) }}</strong>
          <p>
            {{ plan.credits }} 积分
            <span v-if="Number(plan.bonus)">+ 赠送 {{ plan.bonus }}</span>
          </p>
          <button class="button primary" @click="recharge(plan)">
            提交订单
            <AppIcon name="arrow" :size="14" />
          </button>
        </article>
      </div>
      <EmptyState
        v-if="!plans.length"
        title="暂无充值套餐"
        description="可使用兑换码充值，或联系管理员开通套餐。"
        icon="wallet"
      />
      <div class="notice">
        本站充值由管理员手动确认。{{ app.site.contact.note }}
        <span v-if="app.site.contact.email">联系邮箱：{{ app.site.contact.email }}</span>
        <span v-if="app.site.contact.wechat">微信：{{ app.site.contact.wechat }}</span>
      </div>
    </template>
    <template v-else-if="tab === 'settings'">
      <div class="two-col">
        <form class="card stack" @submit.prevent="saveProfile">
          <h2>个人资料</h2>
          <label class="field">
            <span>邮箱</span>
            <input :value="app.user?.email" disabled />
          </label>
          <label class="field">
            <span>用户名</span>
            <input v-model="username" required maxlength="40" />
          </label>
          <button class="button primary" :disabled="busy">保存资料</button>
        </form>
        <form class="card stack" @submit.prevent="changePassword">
          <h2>修改密码</h2>
          <label class="field">
            <span>当前密码</span>
            <input v-model="oldPassword" type="password" required autocomplete="current-password" />
          </label>
          <label class="field">
            <span>新密码</span>
            <input
              v-model="newPassword"
              type="password"
              required
              minlength="12"
              maxlength="128"
              autocomplete="new-password"
              placeholder="至少 12 位字符"
            />
          </label>
          <button class="button" :disabled="busy">更新密码</button>
        </form>
      </div>
      <div class="card theme-card">
        <h3>外观设置</h3>
        <select v-model="app.theme" aria-label="主题" @change="app.applyTheme">
          <option value="system">跟随系统</option>
          <option value="light">浅色模式</option>
          <option value="dark">深色模式</option>
        </select>
      </div>
    </template>
    <template v-else-if="tab === 'invite'">
      <div class="card invitation">
        <span class="invite-icon"><AppIcon name="gift" :size="34" /></span>
        <h2>把创作的乐趣，分享给朋友</h2>
        <p>通过你的专属链接注册，新用户会关联到你的邀请记录。</p>
        <div class="input-action">
          <input :value="inviteUrl" readonly aria-label="邀请链接" />
          <button class="button primary" @click="copy(inviteUrl)">
            <AppIcon name="copy" />
            复制链接
          </button>
        </div>
        <small>已邀请 {{ invites.length }} 位朋友</small>
      </div>
    </template>
    <template v-else>
      <DataTable :rows="rows" :definition="resources[tableResource]" :loading="loading">
        <template #actions="{ row }">
          <button
            v-if="tab === 'orders' && row.status === 'pending'"
            @click="
              confirm = {
                title: '取消订单',
                message: '确认取消此笔尚未确认的订单？',
                action: async () => {
                  await api.delete('/api/user/orders/' + row.id);
                  notify('订单已取消');
                },
              }
            "
          >
            取消
          </button>
          <span v-else class="muted">—</span>
        </template>
      </DataTable>
      <div class="pagination">
        <span>共 {{ total }} 条记录</span>
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
          <span>{{ page }}</span>
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
    </template>
    <BaseModal v-if="showKeyForm" title="创建 API Key" @close="showKeyForm = false">
      <form class="stack" @submit.prevent="createKey">
        <label class="field">
          <span>名称</span>
          <input v-model="keyName" required maxlength="60" placeholder="例如：我的应用" />
        </label>
        <label class="field">
          <span>积分配额（0 为不限）</span>
          <input v-model.number="keyQuota" type="number" min="0" required />
        </label>
        <label class="field">
          <span>允许的模型（不选为全部）</span>
          <select v-model="keyModels" multiple>
            <option v-for="m in app.models" :key="m.id" :value="m.id">
              {{ m.name }}
            </option>
          </select>
        </label>
        <button class="button primary" :disabled="busy">创建密钥</button>
      </form>
    </BaseModal>
    <BaseModal v-if="newKey" title="API Key 已创建" @close="newKey = ''">
      <div class="stack">
        <p>请现在保存。关闭窗口后将无法再次查看完整密钥。</p>
        <textarea :value="newKey" readonly rows="3" aria-label="新 API Key" class="code-input" />
        <button class="button primary" @click="copy(newKey)">
          <AppIcon name="copy" />
          复制密钥
        </button>
      </div>
    </BaseModal>
    <BaseModal v-if="confirm" :title="confirm.title" @close="confirm = null">
      <p>{{ confirm.message }}</p>
      <div class="form-actions">
        <button class="button" @click="confirm = null">取消</button>
        <button class="button primary" :disabled="busy" @click="confirmAction">确认</button>
      </div>
    </BaseModal>
  </div>
</template>
<style scoped>
.user-page {
  max-width: 1200px;
}
.user-nav {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--hairline);
  padding-bottom: 16px;
  margin-bottom: 28px;
}
.user-nav a {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--fg-3);
  padding: 8px 11px;
  border-radius: 7px;
}
.user-nav a.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.welcome-card {
  background: var(--feature-bg);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32px;
  margin-bottom: 35px;
}
.welcome-card p {
  font-size: 12px;
  margin-bottom: 8px;
}
.welcome-card h2 {
  font-size: 22px;
  margin-bottom: 25px;
}
.balance {
  padding-left: 40px;
  border-left: 1px solid var(--accent-border);
  min-width: 160px;
}
.balance > span {
  font-size: 11px;
  color: var(--fg-3);
}
.balance strong {
  font-size: 38px;
  font-weight: 600;
  display: block;
  margin: 5px 0 10px;
}
.balance .text-link {
  font-size: 11px;
}
.recent-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.recent-grid .card {
  padding: 12px;
}
.recent-grid img,
.generation-placeholder {
  width: 100%;
  height: 160px;
  object-fit: cover;
  background: var(--accent-soft);
  color: var(--accent);
  display: grid;
  place-items: center;
  border-radius: 9px;
  margin-bottom: 14px;
}
.recent-grid h3 {
  font-size: 12px;
  min-height: 36px;
}
.recent-grid small {
  display: block;
  margin: 10px 0 4px;
  font-size: 10px;
  color: var(--fg-3);
}
.big-balance {
  font-size: 38px;
  font-weight: 600;
  display: block;
  margin: 25px 0;
}
.big-balance small {
  font-size: 13px;
  margin-left: 10px;
  font-weight: 400;
  color: var(--fg-3);
}
.two-col > .card > p {
  font-size: 12px;
}
.recharge-heading {
  margin-top: 35px;
}
.recharge-plan h3 {
  font-size: 17px;
}
.recharge-plan strong {
  display: block;
  font-size: 30px;
  margin: 20px 0 8px;
}
.recharge-plan p {
  font-size: 12px;
}
.recharge-plan .button {
  width: 100%;
  margin-top: 24px;
}
.user-page > .notice {
  margin-top: 25px;
}
.api-help {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 12px;
}
.api-help .text-link {
  margin-left: auto;
  font-size: 12px;
}
.theme-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 24px;
}
.theme-card select {
  width: 180px;
}
.invitation {
  text-align: center;
  padding: 45px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}
.invite-icon {
  width: 76px;
  height: 76px;
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: 24px;
  display: grid;
  place-items: center;
}
.invitation p {
  font-size: 13px;
}
.invitation .input-action {
  width: min(100%, 650px);
  margin: 10px 0;
}
.invitation small {
  color: var(--fg-3);
}
.toolbar p {
  font-size: 12px;
}
@media (max-width: 639px) {
  .user-nav {
    flex-wrap: nowrap;
    overflow: auto;
    white-space: nowrap;
    gap: 2px;
  }
  .user-nav a {
    padding: 7px 10px;
  }
  .welcome-card {
    padding: 22px;
    display: block;
  }
  .welcome-card h2 {
    font-size: 19px;
  }
  .balance {
    border-left: 0;
    border-top: 1px solid var(--accent-border);
    margin-top: 25px;
    padding: 20px 0 0;
  }
  .balance strong {
    display: inline-block;
    font-size: 30px;
    margin: 0 20px;
  }
  .balance .text-link {
    display: flex;
    margin-top: 12px;
  }
  .recent-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .recent-grid img,
  .generation-placeholder {
    height: 120px;
  }
  .invitation {
    padding: 26px 18px;
  }
  .invitation h2 {
    font-size: 20px;
  }
  .invitation .input-action {
    flex-wrap: wrap;
  }
  .invitation .input-action .button {
    width: 100%;
  }
  .api-help .text-link {
    margin-left: 0;
  }
}
</style>
