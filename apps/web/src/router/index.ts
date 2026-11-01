import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useApp } from '../stores/app';
import Home from '../views/public/Home.vue';
const routes: RouteRecordRaw[] = [
  { path: '/', component: Home },
  { path: '/home', redirect: '/' },
  { path: '/login', component: () => import('../views/public/Login.vue') },
  {
    path: '/create/:id?',
    component: () => import('../views/public/Create.vue'),
  },
  {
    path: '/model-square',
    component: () => import('../views/public/ModelSquare.vue'),
  },
  { path: '/models', redirect: '/model-square' },
  { path: '/video-models', redirect: '/model-square' },
  {
    path: '/docs/:slug(.*)*',
    component: () => import('../views/public/Docs.vue'),
  },
  { path: '/status', component: () => import('../views/public/Status.vue') },
  ...['/apps/:slug?', '/skills', '/updates'].map((path) => ({
    path,
    component: () => import('../views/public/Content.vue'),
  })),
  ...[
    '/user',
    '/orders',
    '/recharge',
    '/api-keys',
    '/credit-usage',
    '/mylogs',
    '/invite',
    '/settings',
  ].map((path) => ({
    path,
    component: () => import('../views/user/UserCenter.vue'),
    meta: { auth: true },
  })),
  { path: '/admin', redirect: '/admin/overview' },
  {
    path: '/dev/components',
    component: () => import('../views/admin/Components.vue'),
    meta: { admin: true, title: '基础组件' },
  },
  {
    path: '/admin/overview',
    component: () => import('../views/admin/Overview.vue'),
    meta: { admin: true, title: '数据概览' },
  },
  {
    path: '/admin/config',
    component: () => import('../views/admin/SiteConfig.vue'),
    meta: { admin: true, title: '站点配置' },
  },
  {
    path: '/admin/admin-key',
    component: () => import('../views/user/UserCenter.vue'),
    meta: { admin: true, title: '管理员 API Key' },
  },
  ...Object.entries({
    gateway: ['channels', '上游渠道'],
    models: ['models', '模型管理'],
    'model-channels': ['model-channels', '模型绑定'],
    'model-groups': ['model-groups', '模型分组'],
    showcase: ['showcase', '作品与灵感'],
    'home-entries': ['home-entries', '首页入口'],
    users: ['users', '用户管理'],
    images: ['generations', '生成记录'],
    logs: ['request-logs', '请求日志'],
    billing: ['recharge-plans', '充值套餐'],
    'credit-usage': ['credit-ledger', '积分流水'],
    orders: ['orders', '订单管理'],
    cdks: ['cdks', '兑换码'],
    'banned-words': ['banned-words', '内容规则'],
    'banned-word-hits': ['banned-word-hits', '规则命中'],
    docs: ['docs', '文档管理'],
    'app-center': ['apps', '应用中心'],
    skills: ['skills', '技能中心'],
    updates: ['updates', '更新日志'],
    'admin-audit': ['admin-audit', '管理操作'],
  }).map(([path, [resource, title]]) => ({
    path: `/admin/${path}${path === 'docs' ? '/:id?' : ''}`,
    component: () => import('../views/admin/ResourceManager.vue'),
    meta: { admin: true, title, resource },
  })),
  {
    path: '/:pathMatch(.*)*',
    component: () => import('../views/public/NotFound.vue'),
  },
];
export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});
router.beforeEach(async (to) => {
  const app = useApp();
  try {
    await app.init();
  } catch {
    return true;
  }
  if ((to.meta.auth || to.meta.admin) && !app.user)
    return { path: '/login', query: { redirect: to.fullPath } };
  if (to.meta.admin && app.user?.role !== 'admin') return '/user';
  if (to.path === '/login' && app.user) return '/user';
  return true;
});
router.afterEach((to) => {
  const app = useApp();
  if (app.site.title)
    document.title = `${to.meta.title ? `${to.meta.title} · ` : ''}${app.site.title}`;
});
