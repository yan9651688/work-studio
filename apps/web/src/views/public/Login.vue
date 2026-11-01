<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApp } from '../../stores/app';
import { api, errorMessage } from '../../api/http';
import type { User } from '@studio/shared';
import AppIcon from '../../components/AppIcon.vue';
const app = useApp(),
  route = useRoute(),
  router = useRouter(),
  register = ref(route.query.register === '1'),
  busy = ref(false),
  error = ref('');
const email = ref(''),
  password = ref(''),
  username = ref(''),
  invite = ref(String(route.query.invite || ''));
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    const { data } = await api.post<User>('/api/auth/' + (register.value ? 'register' : 'login'), {
      email: email.value,
      password: password.value,
      ...(register.value ? { username: username.value, invite_code: invite.value } : {}),
    });
    app.user = data;
    const redirect = String(route.query.redirect || '/user');
    await router.push(redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/user');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-mark"><AppIcon name="sparkles" :size="30" /></div>
      <div class="auth-heading">
        <h1>{{ register ? '创建你的账户' : '欢迎回来' }}</h1>
        <p>
          {{ register ? '从这里开始，把想法变成作品。' : '登录后继续你的创作。' }}
        </p>
      </div>
      <form class="stack" @submit.prevent="submit">
        <label v-if="register" class="field">
          <span>用户名</span>
          <input
            v-model="username"
            required
            maxlength="40"
            autocomplete="nickname"
            placeholder="如何称呼你"
          />
        </label>
        <label class="field">
          <span>邮箱</span>
          <input
            v-model="email"
            type="email"
            required
            autocomplete="email"
            placeholder="you@example.com"
          />
        </label>
        <label class="field">
          <span>密码</span>
          <input
            v-model="password"
            type="password"
            required
            minlength="8"
            maxlength="128"
            :autocomplete="register ? 'new-password' : 'current-password'"
            placeholder="至少 8 位字符"
          />
        </label>
        <label v-if="register" class="field">
          <span>
            邀请码
            <small>（选填）</small>
          </span>
          <input v-model="invite" maxlength="40" placeholder="好友分享的邀请码" />
        </label>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
        <button class="button primary" :disabled="busy">
          <AppIcon v-if="busy" name="loader" class="spin" />
          {{ register ? '创建账户' : '登录账户' }}
          <AppIcon v-if="!busy" name="arrow" />
        </button>
      </form>
      <p v-if="app.site.register_enabled" class="auth-toggle">
        {{ register ? '已有账户？' : '还没有账户？' }}
        <button
          @click="
            register = !register;
            error = '';
          "
        >
          {{ register ? '登录' : '注册' }}
        </button>
      </p>
      <RouterLink to="/" class="text-link">
        <AppIcon name="left" :size="14" />
        返回首页
      </RouterLink>
    </div>
  </div>
</template>
<style scoped>
.auth-page {
  min-height: 85vh;
  display: grid;
  place-items: center;
  padding: 50px 0;
}
.auth-card {
  width: min(100%, 390px);
  padding: 30px;
}
.auth-mark {
  width: 56px;
  height: 56px;
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: 16px;
  display: grid;
  place-items: center;
  margin-bottom: 30px;
}
.auth-heading {
  margin-bottom: 30px;
}
.auth-heading h1 {
  font-size: 27px;
}
.auth-heading p {
  margin-top: 10px;
  font-size: 13px;
}
.auth-toggle {
  text-align: center;
  margin: 25px 0;
  font-size: 12px;
}
.auth-toggle button {
  color: var(--accent);
  font-weight: 600;
}
.auth-card > .text-link {
  margin-top: 25px;
  font-size: 12px;
}
.error-text {
  font-size: 12px;
}
@media (max-width: 639px) {
  .auth-page {
    padding: 25px 0;
  }
  .auth-card {
    padding: 18px;
  }
}
</style>
