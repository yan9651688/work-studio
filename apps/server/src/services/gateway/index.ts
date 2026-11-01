import {
  generationSchema,
  type Generation,
  type Model,
  type Channel,
  type Binding,
  type User,
  type GenerationInput,
} from '@studio/shared';
import { type DB, uid, now } from '../../db/index.js';
import type { Config } from '../../config.js';
import { assert, HttpError } from '../security.js';
import { changeCredits, price, refund } from '../billing.js';
import { Storage } from '../storage.js';
import { invoke } from './adapters.js';
import { RE2 } from 're2-wasm';

export class Gateway {
  readonly liveText = new Map<string, string>();
  private active = new Map<string, number>();
  private failures = new Map<string, { count: number; until: number }>();
  private running = new Map<string, AbortController>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  readonly storage: Storage;
  constructor(
    readonly db: DB,
    readonly config: Config,
  ) {
    this.storage = new Storage(db, config);
  }
  start() {
    // An interrupted upstream request may already have been billed. Never resend it automatically.
    for (const row of this.db.list<Generation>('generations').filter((g) => g.status === 'running'))
      refund(this.db, row.id, '服务重启中断了任务，预扣积分已退回，请重新生成。');
    this.timer = setInterval(() => this.drain(), 250);
    this.timer.unref();
    this.drain();
  }
  async close() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const controller of this.running.values()) controller.abort(new Error('服务正在重启'));
    while (this.running.size) await new Promise((r) => setTimeout(r, 25));
  }
  create(user: User, input: unknown, apiKeyId?: string, source = 'studio') {
    assert(!this.stopped, 503, 'SHUTTING_DOWN', '服务正在重启，请稍后再试');
    const data = generationSchema.parse(input);
    const model = this.db.get<Model>('models', data.model_id);
    assert(model?.enabled, 400, 'MODEL_UNAVAILABLE', '模型未启用或不存在');
    assert(
      source !== 'studio' || !model.studio_disabled,
      400,
      'MODEL_UNAVAILABLE',
      '此模型仅支持 API 调用',
    );
    this.validate(model, data);
    const settings = this.db.settings();
    for (const rule of this.db.list('banned-words').filter((r) => r.enabled)) {
      let hit = false;
      try {
        hit =
          rule.match_type === 'regex'
            ? new RE2(String(rule.word), 'iu').test(data.prompt)
            : data.prompt.toLocaleLowerCase().includes(String(rule.word).toLocaleLowerCase());
      } catch {
        continue;
      }
      if (hit) {
        this.db.put('banned-word-hits', {
          user_id: user.id,
          word: rule.word,
          prompt: data.prompt,
        });
        assert(
          rule.action !== 'block',
          400,
          'PROMPT_BLOCKED',
          '描述命中了站点内容规则，请修改后重试',
        );
      }
    }
    for (const id of data.reference_assets) {
      const asset = this.db.get<{ user_id: string }>('assets', id);
      assert(asset?.user_id === user.id, 403, 'ASSET_FORBIDDEN', '不能使用其他用户的参考图');
    }
    const bindings = this.bindings(model.id);
    assert(bindings.length, 400, 'CHANNEL_UNCONFIGURED', '此模型尚未绑定可用渠道，请联系管理员');
    const cost = price(model, data.params, data.prompt);
    const id = uid();
    const stamp = now();
    this.db.sql.transaction(() => {
      const count = this.db.sql
        .prepare(
          "SELECT count(*) AS n FROM generations WHERE user_id=? AND status IN ('queued','running')",
        )
        .get(user.id) as { n: number };
      assert(
        count.n < Number(settings.concurrency || 2),
        429,
        'CONCURRENCY_LIMIT',
        '已有任务进行中，请完成后再试',
      );
      if (apiKeyId) {
        const key = this.db.sql
          .prepare('SELECT * FROM api_keys WHERE id=? AND enabled=1')
          .get(apiKeyId) as
          { used: number; quota_limit: number; allowed_models: string } | undefined;
        assert(key, 401, 'INVALID_API_KEY', 'API Key 已禁用');
        const allowed = JSON.parse(key.allowed_models) as string[];
        assert(
          !allowed.length || allowed.includes(model.id),
          403,
          'MODEL_FORBIDDEN',
          '此 API Key 不允许使用该模型',
        );
        assert(
          !key.quota_limit || key.used + cost <= key.quota_limit,
          402,
          'KEY_QUOTA_EXCEEDED',
          'API Key 配额不足',
        );
        this.db.sql
          .prepare('UPDATE api_keys SET used=used+?,last_used_at=?,updated_at=? WHERE id=?')
          .run(cost, stamp, stamp, apiKeyId);
      }
      changeCredits(this.db, user.id, -cost, 'generate', id, model.name);
      this.db.sql
        .prepare(
          'INSERT INTO generations(id,user_id,api_key_id,source,model_id,type,prompt,params,reference_assets,status,cost_credits,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          user.id,
          apiKeyId || null,
          source,
          model.id,
          model.type,
          data.prompt,
          JSON.stringify(data.params),
          JSON.stringify(data.reference_assets),
          'queued',
          cost,
          stamp,
          stamp,
        );
    })();
    queueMicrotask(() => this.drain());
    return this.db.get<Generation>('generations', id)!;
  }
  validate(model: Model, data: GenerationInput) {
    const { params: p, reference_assets: images } = data;
    for (const [value, allowed, label] of [
      [p.ratio, model.ratios, '比例'],
      [p.resolution, model.resolutions, '分辨率'],
      [p.quality, model.image_qualities, '画质'],
      [p.duration, model.durations, '时长'],
    ] as const)
      if (value !== undefined)
        assert(
          allowed?.includes(value as never),
          400,
          'INVALID_PARAMETER',
          `模型不支持所选${label}`,
        );
    assert(
      !images.length || model.image_to_image,
      400,
      'REFERENCE_UNSUPPORTED',
      '模型不支持参考图',
    );
    assert(
      images.length <= (model.max_reference_images || 0),
      400,
      'TOO_MANY_REFERENCES',
      '参考图数量超过模型限制',
    );
    assert(
      !p.thinking || model.thinking_supported,
      400,
      'THINKING_UNSUPPORTED',
      '模型不支持思考模式',
    );
  }
  bindings(modelId: string) {
    return this.db
      .list<Binding>('model-channels')
      .filter(
        (b) =>
          b.model_id === modelId &&
          b.enabled &&
          this.db.get<Channel>('channels', b.channel_id)?.enabled,
      );
  }
  private choose(bindings: Binding[], excluded: Set<string>) {
    const available = bindings.filter((b) => {
      const c = this.db.get<Channel>('channels', b.channel_id)!;
      return (
        !excluded.has(c.id) &&
        (this.active.get(c.id) || 0) < Math.max(1, c.max_concurrency) &&
        (this.failures.get(c.id)?.until || 0) <= Date.now()
      );
    });
    if (!available.length) return;
    const priority = Math.min(...available.map((b) => b.priority || 0));
    const tier = available.filter((b) => (b.priority || 0) === priority);
    let target = Math.random() * tier.reduce((sum, b) => sum + Math.max(1, b.weight || 1), 0);
    return tier.find((b) => (target -= Math.max(1, b.weight || 1)) <= 0) || tier[0];
  }
  private drain() {
    if (this.stopped || this.running.size >= 16) return;
    const queued = this.db.sql
      .prepare("SELECT id FROM generations WHERE status='queued' ORDER BY created_at LIMIT 32")
      .all() as { id: string }[];
    for (const row of queued) {
      if (this.running.size >= 16) break;
      const g = this.db.get<Generation>('generations', row.id)!;
      const bindings = this.bindings(g.model_id);
      if (!bindings.length) {
        refund(this.db, g.id, '模型渠道已停用，积分已退回');
        continue;
      }
      const binding = this.choose(bindings, new Set());
      if (!binding) {
        if (Date.now() - Date.parse(g.created_at) > 300000)
          refund(this.db, g.id, '渠道忙碌超时，积分已退回');
        continue;
      }
      const controller = new AbortController();
      this.running.set(g.id, controller);
      this.active.set(binding.channel_id, (this.active.get(binding.channel_id) || 0) + 1);
      void this.run(g, binding, controller).finally(() => {
        this.running.delete(g.id);
        this.liveText.delete(g.id);
        this.drain();
      });
    }
  }
  private async run(g: Generation, first: Binding, controller: AbortController) {
    const started = Date.now();
    const settings = this.db.settings();
    const tried = new Set<string>();
    let binding: Binding | undefined = first;
    let error = '生成失败';
    this.db.sql
      .prepare(
        "UPDATE generations SET status='running',progress=5,started_at=?,updated_at=? WHERE id=?",
      )
      .run(now(), now(), g.id);
    try {
      for (
        let attempt = 0;
        binding && attempt <= Math.min(5, Number(settings.retry_count ?? 2));
        attempt++
      ) {
        const channel = this.db.get<Channel>('channels', binding.channel_id)!;
        tried.add(channel.id);
        this.db.sql
          .prepare('UPDATE generations SET channel_id=?,updated_at=? WHERE id=?')
          .run(channel.id, now(), g.id);
        try {
          const signal = AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(Math.max(1000, Math.min(channel.timeout_ms || 120000, 600000))),
          ]);
          const result = await invoke({
            channel,
            binding,
            generation: g,
            storage: this.storage,
            config: this.config,
            signal,
            onText: (delta) => this.liveText.set(g.id, (this.liveText.get(g.id) || '') + delta),
            onProgress: (progress) =>
              this.db.sql
                .prepare('UPDATE generations SET progress=?,updated_at=? WHERE id=?')
                .run(progress, now(), g.id),
          });
          this.db.sql.transaction(() => {
            let charged = g.cost_credits;
            const model = this.db.get<Model>('models', g.model_id)!;
            const pricing = model.text_pricing;
            if (g.type === 'text' && result.usage && pricing?.input_per_million !== undefined) {
              const actual =
                Math.ceil(
                  (result.usage.input * pricing.input_per_million +
                    result.usage.output * (pricing.output_per_million || 0)) /
                    1e6,
                ) + (g.params.thinking ? model.thinking_price || 0 : 0);
              const difference = Math.max(0, charged - actual);
              charged -= difference;
              if (difference) {
                changeCredits(this.db, g.user_id, difference, 'settlement', g.id);
                if (g.api_key_id)
                  this.db.sql
                    .prepare('UPDATE api_keys SET used=MAX(0,used-?) WHERE id=?')
                    .run(difference, g.api_key_id);
              }
            }
            this.db.sql
              .prepare(
                "UPDATE generations SET status='succeeded',progress=100,result_assets=?,cost_credits=?,elapsed_ms=?,finished_at=?,updated_at=? WHERE id=?",
              )
              .run(
                JSON.stringify(result.assets),
                charged,
                Date.now() - started,
                now(),
                now(),
                g.id,
              );
            this.db.put(
              'models',
              { generation_count: (model.generation_count || 0) + 1 },
              model.id,
            );
          })();
          this.failures.delete(channel.id);
          this.db.put('channels', { last_check_at: now(), last_check_ok: true }, channel.id);
          return;
        } catch (cause) {
          error =
            cause instanceof HttpError
              ? cause.message
              : controller.signal.aborted
                ? '服务重启中断了任务'
                : cause instanceof Error && cause.name === 'TimeoutError'
                  ? '上游请求超时'
                  : '上游调用失败，请检查渠道配置';
          const failures = (this.failures.get(channel.id)?.count || 0) + 1;
          this.failures.set(channel.id, {
            count: failures,
            until:
              failures >= Number(settings.circuit_threshold || 3)
                ? Date.now() + Number(settings.circuit_cooldown_seconds || 60) * 1000
                : 0,
          });
          this.db.put('channels', { last_check_at: now(), last_check_ok: false }, channel.id);
        } finally {
          this.active.set(channel.id, Math.max(0, (this.active.get(channel.id) || 1) - 1));
        }
        if (
          controller.signal.aborted ||
          this.liveText.has(g.id) ||
          attempt >= Math.min(5, Number(settings.retry_count ?? 2))
        )
          break;
        binding = this.choose(this.bindings(g.model_id), tried);
        if (binding)
          this.active.set(binding.channel_id, (this.active.get(binding.channel_id) || 0) + 1);
      }
    } catch {
      error = '生成任务处理失败';
    }
    refund(this.db, g.id, error);
    this.db.sql
      .prepare('UPDATE generations SET elapsed_ms=? WHERE id=?')
      .run(Date.now() - started, g.id);
  }
}
