import { z } from 'zod';

export type Row = Record<string, unknown> & {
  id: string;
  created_at: string;
  updated_at: string;
};
export type Field = {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'json' | 'image' | 'secret';
  options?: string[];
  default?: unknown;
  required?: boolean;
  hint?: string;
};
export type Resource = {
  title: string;
  fields: Field[];
  columns: string[];
  readonly?: boolean;
  description?: string;
};
const f = (
  key: string,
  label: string,
  type: Field['type'] = 'text',
  rest: Partial<Field> = {},
): Field => ({ key, label, type, ...rest });
const enabled = f('enabled', '启用', 'boolean', { default: true });
const weight = f('weight', '排序权重', 'number', { default: 0 });
const name = f('name', '名称', 'text', { required: true });
const title = f('title', '标题', 'text', { required: true });
const description = f('description', '说明', 'textarea');
const modelFields: Field[] = [
  name,
  f('alias', '展示别名'),
  f('compat_alias', '兼容别名'),
  description,
  f('icon', '图标', 'image'),
  f('type', '模型类型', 'select', {
    options: ['image', 'video', 'text'],
    default: 'image',
  }),
  f('provider', '提供方'),
  f('provider_group', '厂商分组'),
  f('group_id', '分组 ID'),
  enabled,
  f('studio_disabled', '隐藏于工作台', 'boolean'),
  weight,
  f('ratios', '画面比例', 'json', { default: ['1:1', '16:9', '9:16'] }),
  f('resolutions', '分辨率', 'json', { default: ['1K', '2K'] }),
  f('image_qualities', '画质', 'json', { default: [] }),
  f('durations', '视频时长（秒）', 'json', { default: [] }),
  f('image_to_image', '支持参考图', 'boolean'),
  f('max_reference_images', '最多参考图', 'number', { default: 0 }),
  f('reference_mode', '参考模式', 'text', { default: 'asset' }),
  f('image_size_constraints', '尺寸限制', 'json', { default: {} }),
  f('capabilities', '高级能力', 'json', { default: {} }),
  f('prices', '积分价格', 'json', {
    default: { '1K': 8, '2K': 12 },
    hint: '按分辨率计价；default 为兜底价格。视频 per_second 按秒计费。',
  }),
  f('text_pricing', '文本价格', 'json', {
    default: {},
    hint: '可设置 input_per_million / output_per_million，按 token 预扣，结算后退差额。',
  }),
  f('thinking_supported', '支持思考', 'boolean'),
  f('thinking_price', '思考附加积分', 'number', { default: 0 }),
  f('video_billing_mode', '视频计费', 'select', {
    options: ['per_request', 'per_second'],
    default: 'per_request',
  }),
];
export const resources: Record<string, Resource> = {
  channels: {
    title: '上游渠道',
    description: '配置服务商地址与密钥，再在「模型绑定」中关联模型。',
    columns: ['name', 'provider_type', 'base_url', 'enabled'],
    fields: [
      name,
      f('provider_type', '协议', 'select', {
        options: ['openai', 'gemini', 'custom-http'],
        default: 'openai',
      }),
      f('base_url', 'Base URL', 'text', {
        required: true,
        hint: 'OpenAI 兼容一般以 /v1 结尾；Gemini 一般以 /v1beta 结尾。',
      }),
      f('api_key', 'API Key', 'secret', {
        hint: '加密保存；编辑时留空保留原密钥。',
      }),
      f('headers', '额外请求头', 'json', { default: {} }),
      f('timeout_ms', '超时（毫秒）', 'number', { default: 120000 }),
      f('max_concurrency', '并发数', 'number', { default: 3 }),
      weight,
      enabled,
      f('proxy', 'HTTP 代理地址'),
      f('config', '自定义协议配置', 'json', {
        default: {},
        hint: 'path、body、response_path；异步任务可配置 task_id_path、poll_path、status_path、success_value。模板变量：{{prompt}}、{{model}}、{{size}}、{{images}}。',
      }),
      f('remark', '备注', 'textarea'),
    ],
  },
  models: {
    title: '模型管理',
    columns: ['name', 'type', 'prices', 'enabled'],
    fields: modelFields,
  },
  'model-channels': {
    title: '模型绑定',
    description:
      'model_id 为模型对外 ID，upstream_model 为服务商实际模型名。优先级数字越小越优先。',
    columns: ['model_id', 'channel_id', 'upstream_model', 'priority', 'enabled'],
    fields: [
      f('model_id', '模型 ID', 'text', { required: true }),
      f('channel_id', '渠道 ID', 'text', { required: true }),
      f('upstream_model', '上游模型名', 'text', { required: true }),
      f('priority', '优先级', 'number', { default: 0 }),
      f('weight', '选择权重', 'number', { default: 1 }),
      enabled,
      f('param_mapping', '额外请求参数', 'json', { default: {} }),
    ],
  },
  'model-groups': {
    title: '模型分组',
    columns: ['name', 'slug', 'weight'],
    fields: [name, f('slug', '标识'), f('icon', '图标', 'image'), weight],
  },
  showcase: {
    title: '作品与灵感',
    columns: ['title', 'kind', 'image_url', 'enabled'],
    fields: [
      title,
      f('kind', '展示位置', 'select', {
        options: ['bento', 'inspiration'],
        default: 'bento',
      }),
      f('subtitle', '副标题'),
      f('prompt', '提示词', 'textarea'),
      f('image_url', '展示图片', 'image'),
      f('gradient', '占位渐变', 'text', {
        default: 'linear-gradient(135deg,#dfeee4,#8cab98)',
      }),
      f('span', '卡片占格', 'number', { default: 1 }),
      weight,
      enabled,
    ],
  },
  'home-entries': {
    title: '首页入口',
    columns: ['title', 'link', 'weight'],
    fields: [
      title,
      f('desc', '说明'),
      f('icon', '图标名称'),
      f('link', '链接', 'text', { required: true }),
      weight,
    ],
  },
  docs: {
    title: '文档管理',
    columns: ['title', 'slug', 'category', 'published'],
    fields: [
      title,
      f('slug', '路径', 'text', { required: true }),
      f('category', '分类', 'text', { default: '使用指南' }),
      f('content_md', 'Markdown 正文', 'textarea'),
      weight,
      f('published', '发布', 'boolean', { default: true }),
    ],
  },
  apps: {
    title: '应用中心',
    columns: ['name', 'slug', 'status'],
    fields: [
      name,
      f('slug', '路径', 'text', { required: true }),
      f('desc', '说明', 'textarea'),
      f('icon', '图标', 'image'),
      f('status', '状态', 'select', {
        options: ['coming_soon', 'online'],
        default: 'coming_soon',
      }),
      f('config', '配置', 'json', {
        default: {},
        hint: '配置 model_id、prompt_template；也可配置 link 跳转链接。',
      }),
    ],
  },
  skills: {
    title: '技能中心',
    columns: ['name', 'model_id', 'enabled'],
    fields: [
      name,
      f('desc', '说明', 'textarea'),
      f('prompt_template', '提示词模板', 'textarea'),
      f('model_id', '模型 ID'),
      f('cover', '封面', 'image'),
      enabled,
    ],
  },
  updates: {
    title: '更新日志',
    columns: ['title', 'published_at'],
    fields: [
      title,
      f('content_md', '正文', 'textarea'),
      f('published_at', '发布时间', 'text', {
        default: new Date().toISOString(),
      }),
    ],
  },
  'recharge-plans': {
    title: '充值套餐',
    columns: ['name', 'price_cents', 'credits', 'bonus', 'enabled'],
    fields: [
      name,
      f('price_cents', '价格（分）', 'number', { default: 1000 }),
      f('credits', '积分', 'number', { default: 100 }),
      f('bonus', '赠送积分', 'number', { default: 0 }),
      weight,
      enabled,
    ],
  },
  'banned-words': {
    title: '内容规则',
    columns: ['word', 'match_type', 'action', 'enabled'],
    fields: [
      f('word', '关键词或正则', 'text', { required: true }),
      f('match_type', '匹配方式', 'select', {
        options: ['contains', 'regex'],
        default: 'contains',
      }),
      f('action', '命中动作', 'select', {
        options: ['block', 'warn'],
        default: 'block',
      }),
      enabled,
    ],
  },
  users: {
    title: '用户管理',
    columns: ['email', 'username', 'role', 'credits', 'status'],
    fields: [
      f('username', '用户名'),
      f('role', '角色', 'select', { options: ['user', 'admin'] }),
      f('status', '状态', 'select', { options: ['active', 'banned'] }),
    ],
  },
  generations: {
    title: '生成记录',
    columns: ['user_id', 'model_id', 'prompt', 'status', 'cost_credits', 'created_at'],
    fields: [],
    readonly: true,
  },
  'request-logs': {
    title: '请求日志',
    columns: ['route', 'model_id', 'status_code', 'latency_ms', 'created_at'],
    fields: [],
    readonly: true,
  },
  'credit-ledger': {
    title: '积分流水',
    columns: ['user_id', 'delta', 'balance_after', 'reason', 'created_at'],
    fields: [],
    readonly: true,
  },
  orders: {
    title: '充值订单',
    columns: ['user_id', 'amount_cents', 'credits', 'status', 'created_at'],
    fields: [],
    readonly: true,
  },
  cdks: {
    title: '兑换码',
    columns: ['code', 'credits', 'batch', 'used_by', 'expires_at'],
    fields: [],
    readonly: true,
  },
  'banned-word-hits': {
    title: '规则命中',
    columns: ['user_id', 'word', 'prompt', 'created_at'],
    fields: [],
    readonly: true,
  },
  'admin-audit': {
    title: '管理操作',
    columns: ['admin_id', 'action', 'target', 'created_at'],
    fields: [],
    readonly: true,
  },
};
export function resourceSchema(resource: string) {
  const def = resources[resource];
  if (!def) throw new Error('Unknown resource');
  const shape: Record<string, z.ZodTypeAny> = {
    id: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]{1,120}$/)
      .optional(),
  };
  for (const field of def.fields) {
    let schema: z.ZodTypeAny =
      field.type === 'boolean'
        ? z.boolean()
        : field.type === 'number'
          ? z.number().finite().int().min(0).max(1e9)
          : field.type === 'json'
            ? z.union([z.record(z.unknown()), z.array(z.unknown())])
            : z.string().max(100000);
    if (field.type === 'select' && field.options)
      schema = z.enum(field.options as [string, ...string[]]);
    if (field.required) schema = z.string().trim().min(1).max(500);
    shape[field.key] = schema.optional();
  }
  return z.object(shape).strict();
}
export const generationSchema = z.object({
  model_id: z.string().min(1).max(120),
  prompt: z.string().trim().min(1).max(32000),
  params: z
    .object({
      ratio: z.string().optional(),
      resolution: z.string().optional(),
      quality: z.string().optional(),
      duration: z.number().positive().max(600).optional(),
      max_tokens: z.number().int().min(1).max(32000).optional(),
      thinking: z.boolean().optional(),
      stream: z.boolean().optional(),
      messages: z
        .array(
          z.object({
            role: z.enum(['system', 'user', 'assistant']),
            content: z.string().max(64000),
          }),
        )
        .max(100)
        .optional(),
    })
    .default({}),
  reference_assets: z.array(z.string()).max(20).default([]),
});
export type GenerationInput = z.infer<typeof generationSchema>;
export interface Model extends Row {
  name: string;
  alias?: string;
  type: 'image' | 'video' | 'text';
  enabled: boolean;
  studio_disabled?: boolean;
  provider_group: string;
  group_id?: string;
  description: string;
  ratios: string[];
  resolutions: string[];
  image_qualities: string[];
  durations: number[];
  prices: Record<string, number>;
  text_pricing: Record<string, number>;
  max_reference_images: number;
  image_to_image: boolean;
  video_billing_mode: string;
  thinking_supported?: boolean;
  thinking_price?: number;
  generation_count?: number;
}
export interface Channel extends Row {
  name: string;
  provider_type: 'openai' | 'gemini' | 'custom-http';
  base_url: string;
  api_key: string;
  headers: Record<string, string>;
  timeout_ms: number;
  max_concurrency: number;
  weight: number;
  enabled: boolean;
  proxy?: string;
  config: Record<string, unknown>;
}
export interface Binding extends Row {
  model_id: string;
  channel_id: string;
  upstream_model: string;
  priority: number;
  weight: number;
  enabled: boolean;
  param_mapping: Record<string, unknown>;
}
export interface User {
  id: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  credits: number;
  status: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
}
export interface Generation {
  id: string;
  user_id: string;
  api_key_id: string | null;
  source: string;
  model_id: string;
  channel_id: string | null;
  type: string;
  prompt: string;
  params: GenerationInput['params'];
  reference_assets: string[];
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'refunded';
  progress: number;
  result_assets: ResultAsset[];
  error: string | null;
  cost_credits: number;
  elapsed_ms: number;
  is_public: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}
export interface ResultAsset {
  url?: string;
  thumb_url?: string;
  text?: string;
  mime?: string;
}
export const terminalStatuses = ['succeeded', 'failed', 'refunded'];
