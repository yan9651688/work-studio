import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { User, Model } from '@studio/shared';
import { api } from '../api/http';
export interface Site {
  title: string;
  subtitle: string;
  logo: string;
  favicon: string;
  avatar: string;
  register_enabled: boolean;
  cdk_redeem_enabled: boolean;
  home_hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    placeholder: string;
    image?: string;
  };
  footer: string;
  contact: Record<string, string>;
  seo: Record<string, string>;
}
export const useApp = defineStore('app', () => {
  const user = ref<User | null>(null);
  const site = ref<Site>({
    title: '',
    subtitle: '',
    logo: '',
    favicon: '',
    avatar: '',
    register_enabled: false,
    cdk_redeem_enabled: false,
    home_hero: { eyebrow: '', title: '', subtitle: '', placeholder: '' },
    footer: '',
    contact: {},
    seo: {},
  });
  const models = ref<Model[]>([]);
  const ready = ref(false);
  const bootError = ref('');
  const theme = ref(localStorage.getItem('studio-theme') || 'system');
  let initialization: Promise<void> | undefined;
  function applyTheme() {
    document.documentElement.classList.toggle(
      'dark',
      theme.value === 'dark' ||
        (theme.value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches),
    );
    localStorage.setItem('studio-theme', theme.value);
  }
  function toggleTheme() {
    theme.value = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    applyTheme();
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme.value === 'system') applyTheme();
  });
  async function refreshUser() {
    user.value = (await api.get<User | null>('/api/auth/me')).data;
  }
  async function refreshSite() {
    site.value = (await api.get<Site>('/admin/api/site')).data;
    document.title = site.value.title;
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute('content', site.value.seo?.description || site.value.subtitle);
    if (site.value.favicon) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.append(link);
      }
      link.href = site.value.favicon;
    }
  }
  async function refreshModels() {
    models.value = (await api.get<Model[]>('/admin/api/managed-models')).data;
  }
  function init() {
    return (initialization ??= (async () => {
      try {
        await Promise.all([refreshSite(), refreshUser(), refreshModels()]);
        ready.value = true;
      } catch (error) {
        bootError.value = error instanceof Error ? error.message : '加载失败';
        throw error;
      }
    })());
  }
  async function logout() {
    await api.post('/api/auth/logout');
    user.value = null;
  }
  return {
    user,
    site,
    models,
    ready,
    bootError,
    theme,
    applyTheme,
    toggleTheme,
    refreshUser,
    refreshSite,
    refreshModels,
    init,
    logout,
  };
});
