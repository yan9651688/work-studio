import argon2 from 'argon2';
import type { Config } from '../config.js';
import { type DB, uid, now } from './index.js';

export async function seed(db: DB, config: Config) {
  if (!db.sql.prepare('SELECT id FROM users WHERE role=?').get('admin')) {
    if (!config.adminEmail || config.adminPassword.length < 12)
      throw new Error('首次启动需要 ADMIN_EMAIL 与至少 12 位 ADMIN_PASSWORD');
    const hash = await argon2.hash(config.adminPassword);
    db.sql
      .prepare(
        'INSERT INTO users(id,email,username,password_hash,role,credits,invite_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        uid(),
        config.adminEmail.toLowerCase(),
        '管理员',
        hash,
        'admin',
        0,
        uid().slice(0, 8),
        now(),
        now(),
      );
  }
  if (db.settings().title) return;
  db.sql.transaction(() => {
    const settings = {
      title: '创作工作台',
      subtitle: '让灵感成为作品',
      logo: '',
      favicon: '',
      avatar: '',
      media_cdn_url: '',
      contact: { email: '', wechat: '', phone: '', hours: '', note: '' },
      register_enabled: true,
      cdk_redeem_enabled: true,
      default_credits: 0,
      invite_reward: 0,
      concurrency: 2,
      retry_count: 2,
      circuit_threshold: 3,
      circuit_cooldown_seconds: 60,
      home_hero: {
        eyebrow: 'CREATIVE STUDIO',
        title: '让灵感，\n成为作品。',
        subtitle: '从一个想法开始，探索属于你的创作方式。',
        placeholder: '描述你想创作的画面…',
        image: '',
      },
      footer: '每一个想法，都值得被看见。',
      seo: { description: '图片、视频与文本，一站式 AI 创作工作台。' },
    };
    for (const [key, value] of Object.entries(settings)) db.setSetting(key, value);
    for (const [i, type] of ['openai', 'gemini', 'custom-http'].entries())
      db.put(
        'channels',
        {
          name: `${type} 示例渠道`,
          provider_type: type,
          base_url:
            type === 'gemini'
              ? 'https://generativelanguage.googleapis.com/v1beta'
              : 'https://api.example.com/v1',
          api_key: '',
          headers: {},
          timeout_ms: 120000,
          max_concurrency: 3,
          weight: 1,
          enabled: false,
          config: {},
          remark: '请填写自己的 API 地址和密钥后启用。',
        },
        `channel-${i + 1}`,
      );
    db.put('model-groups', { name: '通用模型', slug: 'general', weight: 1 }, 'general');
    for (const [i, type] of ['image', 'image', 'text', 'video', 'image'].entries())
      db.put(
        'models',
        {
          name: ['标准图像', '高精图像', '通用文本', '视频创作', '参考图编辑'][i],
          alias: '',
          description: '示例模型。管理员配置上游渠道并启用后即可使用。',
          type,
          provider_group: 'general',
          group_id: 'general',
          enabled: false,
          studio_disabled: false,
          weight: 5 - i,
          ratios: ['1:1', '16:9', '9:16', '3:2', '3:4'],
          resolutions: ['1K', '2K'],
          image_qualities: ['standard', 'high'],
          durations: type === 'video' ? [5, 10] : [],
          image_to_image: i === 4,
          max_reference_images: i === 4 ? 3 : 0,
          reference_mode: 'asset',
          capabilities: {},
          prices: { default: 8, '1K': 8, '2K': 12 },
          text_pricing: {},
          video_billing_mode: 'per_request',
          generation_count: 0,
        },
        `example-${type}-${i + 1}`,
      );
    const palettes = [
      'linear-gradient(135deg,#c6daca,#6a8f78)',
      'linear-gradient(135deg,#d8e6ef,#789eb7)',
      'linear-gradient(135deg,#efdbc9,#be8c6a)',
      'linear-gradient(135deg,#e7dfca,#b3a06d)',
      'linear-gradient(135deg,#ddd9e9,#9a92b4)',
      'linear-gradient(135deg,#dae6df,#91b7a1)',
    ];
    for (let i = 0; i < 6; i++)
      db.put(
        'showcase',
        {
          kind: 'bento',
          title: `创作留白 ${String(i + 1).padStart(2, '0')}`,
          subtitle: '这里等待你的下一件作品',
          prompt: '',
          image_url: '',
          gradient: palettes[i],
          span: [2, 1, 1, 1, 1, 2][i],
          weight: 6 - i,
          enabled: true,
        },
        `showcase-${i}`,
      );
    for (const [i, title] of ['自然光影', '几何构成', '静物叙事'].entries())
      db.put(
        'showcase',
        {
          kind: 'inspiration',
          title,
          subtitle: '从一个方向出发',
          prompt: [
            '清晨的植物与窗边光影，安静的绿色调',
            '由圆形与方形组成的极简几何构图，柔和的纸张质感',
            '一只陶瓷杯与一本打开的书，午后的暖色光线',
          ][i],
          image_url: '',
          gradient: palettes[i],
          span: 1,
          weight: 3 - i,
          enabled: true,
        },
        `inspiration-${i}`,
      );
    for (const [i, label] of ['图片创作', '视频创作', '文本创作', '应用中心'].entries())
      db.put(
        'home-entries',
        {
          title: label,
          desc: [
            '输入描述，或用参考图创作',
            '让文字与图片动起来',
            '写作、改写与整理内容',
            '发现更多创作方式',
          ][i],
          icon: ['image', 'film', 'pen', 'grid'][i],
          link: i === 3 ? '/apps' : `/create?type=${['image', 'video', 'text'][i]}`,
          weight: 4 - i,
        },
        `entry-${i}`,
      );
    const docs = [
      {
        slug: 'start',
        title: '快速开始',
        content_md:
          '# 快速开始\n\n## 1. 创建账户\n注册后进入个人中心，查看可用积分。\n\n## 2. 选择模型\n在模型广场比较能力与价格，在创作中心选择适合的模型。\n\n## 3. 开始创作\n输入描述，按需上传参考图。任务失败会自动退回预扣积分。\n\n## 管理员准备\n先在管理后台配置渠道、模型与模型绑定，再启用模型。初始模型默认关闭，避免未配置的调用扣费。',
      },
      {
        slug: 'models',
        title: '模型 API',
        content_md:
          '# 模型 API\n\n## 鉴权\n在个人中心创建 API Key，通过 `Authorization: Bearer sk-...` 请求本站。\n\n## 图片生成\n```bash\ncurl "$BASE_URL/v1/images/generations" \\\n  -H "Authorization: Bearer $API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"model":"模型ID","prompt":"清晨的植物","size":"1024x1024"}\'\n```\n\n## 文本与视频\n文本：`POST /v1/chat/completions`，支持 `stream: true`。\n\n视频：`POST /v1/videos/generations`，再通过 `GET /v1/videos/:id` 查询状态。\n\n图片编辑：`POST /v1/images/edits`，multipart 表单传入 model、prompt 和 image。\n\n## 计费\n请求先预扣积分；失败自动退款。文本配置按 token 计价时按 max_tokens 预扣，使用上游 usage 结算。',
      },
      {
        slug: 'apps',
        title: '应用 API',
        content_md:
          '# 应用接入\n\n应用使用统一模型网关。管理员在应用中心配置模型和提示词模板，用户打开应用后即可进入创作。\n\n## 调用方式\n使用模型 API，并把应用模板作为 prompt。当前版本没有独立的支付或第三方应用专属接口。',
      },
    ];
    for (const [i, doc] of docs.entries())
      db.put('docs', { ...doc, category: '接入指南', published: true, weight: 3 - i }, doc.slug);
    db.put(
      'updates',
      {
        title: '创作工作台已就绪',
        content_md: '图片、视频、文本创作与统一模型 API，配合独立管理后台。',
        published_at: now(),
      },
      'launch',
    );
    db.put(
      'apps',
      {
        name: '图像描述助手',
        slug: 'image-to-prompt',
        desc: '配置支持图片理解的模型后，帮助整理画面描述。',
        icon: '',
        status: 'coming_soon',
        config: {},
      },
      'image-to-prompt',
    );
  })();
}
