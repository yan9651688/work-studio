<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useApp } from '../../stores/app';
import { api, notify, errorMessage } from '../../api/http';
import type { Row } from '@studio/shared';
import AppIcon from '../../components/AppIcon.vue';
import BaseModal from '../../components/BaseModal.vue';
const app = useApp(),
  router = useRouter(),
  prompt = ref(''),
  entries = ref<Row[]>([]),
  showcase = ref<{ bento: Row[]; inspiration: Row[] }>({
    bento: [],
    inspiration: [],
  }),
  stats = ref({ generated_count: 0, avg_elapsed_ms: 0 }),
  selected = ref<Row | null>(null);
const expanded = ref(false);
onMounted(async () => {
  try {
    const [a, b, c] = await Promise.all([
      api.get<Row[]>('/admin/api/home-entries'),
      api.get<typeof showcase.value>('/admin/api/showcase'),
      api.get<typeof stats.value>('/admin/api/stats'),
    ]);
    entries.value = a.data;
    showcase.value = b.data;
    stats.value = c.data;
  } catch (e) {
    notify(errorMessage(e), 'error');
  }
});
function create(text = prompt.value) {
  void router.push({ path: '/create', query: text ? { prompt: text } : {} });
}
</script>
<template>
  <div class="home">
    <section class="home-hero">
      <div
        v-if="app.site.home_hero.image"
        class="hero-image"
        :style="{ backgroundImage: `url(${app.site.home_hero.image})` }"
      />
      <div v-else class="hero-art" aria-hidden="true">
        <div class="art-orbit orbit-one" />
        <div class="art-orbit orbit-two" />
        <div class="art-orbit orbit-three" />
        <span class="art-caption">A SPACE FOR YOUR IDEAS</span>
      </div>
      <div class="hero-copy">
        <div class="eyebrow">{{ app.site.home_hero.eyebrow }}</div>
        <h1>{{ app.site.home_hero.title }}</h1>
        <p>{{ app.site.home_hero.subtitle }}</p>
      </div>
      <form class="idea-form" @submit.prevent="create()">
        <AppIcon name="sparkles" :size="26" />
        <label>
          <span>描述你想创作的画面</span>
          <input
            v-model="prompt"
            :placeholder="app.site.home_hero.placeholder"
            aria-label="描述你想创作的画面"
            maxlength="32000"
          />
        </label>
        <button class="button primary">
          <AppIcon name="sparkles" />
          <span>开始创作</span>
          <AppIcon name="arrow" />
        </button>
      </form>
      <p class="hero-tip">进入创作页后，可以选择模型、尺寸和参考图。</p>
    </section>
    <section class="home-entries" aria-label="选择创作方式">
      <RouterLink
        v-for="(entry, index) in entries"
        :key="entry.id"
        :to="String(entry.link)"
        :class="'entry-' + index"
      >
        <span class="entry-icon"><AppIcon :name="String(entry.icon)" :size="24" /></span>
        <div>
          <h3>{{ entry.title }}</h3>
          <p>{{ entry.desc }}</p>
        </div>
        <AppIcon class="entry-arrow" name="arrow" :size="18" />
      </RouterLink>
    </section>
    <section v-if="showcase.inspiration.length" class="home-section">
      <div class="section-header">
        <div>
          <h2>
            <AppIcon name="sparkles" />
            灵感推荐
          </h2>
          <p>挑一个喜欢的方向，带着描述开始创作。</p>
        </div>
        <button class="text-link" @click="expanded = !expanded">
          {{ expanded ? '收起' : '查看全部' }}
          <AppIcon name="arrow" :size="15" />
        </button>
      </div>
      <div class="inspiration-grid">
        <button
          v-for="item in expanded ? showcase.inspiration : showcase.inspiration.slice(0, 3)"
          :key="item.id"
          :style="{ background: String(item.gradient) }"
          @click="create(String(item.prompt || ''))"
        >
          <img v-if="item.image_url" :src="String(item.image_url)" alt="" loading="lazy" />
          <span>{{ item.title }}</span>
          <small>
            使用这段描述
            <AppIcon name="arrow" :size="14" />
          </small>
        </button>
      </div>
    </section>
    <section class="home-section">
      <div class="section-header">
        <div>
          <h2>
            <AppIcon name="image" />
            作品精选
          </h2>
          <p>看看不同的想法，能变成怎样的画面。</p>
        </div>
        <RouterLink class="text-link" to="/create">
          开始创作
          <AppIcon name="arrow" :size="15" />
        </RouterLink>
      </div>
      <div class="bento-grid">
        <button
          v-for="(work, index) in showcase.bento"
          :key="work.id"
          :class="{ 'bento-wide': Number(work.span) > 1 }"
          :style="{ background: String(work.gradient) }"
          @click="selected = work"
        >
          <img
            v-if="work.image_url"
            :src="String(work.image_url)"
            :alt="String(work.title)"
            loading="lazy"
          />
          <template v-else>
            <span class="placeholder-number">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="placeholder-art" />
            <span class="work-label">
              {{ work.title }}
              <small>{{ work.subtitle }}</small>
            </span>
          </template>
          <span class="work-hover">
            查看作品
            <AppIcon name="diagonal" />
          </span>
        </button>
      </div>
    </section>
    <section class="home-guide">
      <div class="between">
        <div>
          <p class="eyebrow">第一次使用？</p>
          <h2>三步，完成你的第一张作品</h2>
        </div>
        <RouterLink to="/docs" class="text-link">
          查看使用指南
          <AppIcon name="arrow" :size="15" />
        </RouterLink>
      </div>
      <div class="guide-steps">
        <div
          v-for="(step, index) in [
            ['描述想法', '告诉 AI 画什么，想要什么风格。'],
            ['选择模型', '挑选模型，调整画面尺寸。'],
            ['生成并保存', '查看结果，下载满意的作品。'],
          ]"
          :key="step[0]"
        >
          <span>0{{ index + 1 }}</span>
          <div>
            <h3>{{ step[0] }}</h3>
            <p>{{ step[1] }}</p>
          </div>
        </div>
      </div>
    </section>
    <div class="home-stats">
      <p>{{ app.site.title }} · {{ app.site.subtitle }}</p>
      <div
        v-for="[label, value] in [
          ['已启用模型', app.models.length.toLocaleString()],
          ['已生成作品', stats.generated_count.toLocaleString()],
          [
            '平均生成耗时',
            stats.avg_elapsed_ms ? `${(stats.avg_elapsed_ms / 1000).toFixed(1)}s` : '—',
          ],
        ]"
        :key="label"
      >
        <span>{{ label }}</span>
        <strong>{{ value }}</strong>
      </div>
    </div>
    <section class="home-seo">
      <h2>AI 创作与 API 接入</h2>
      <p>{{ app.site.seo?.description }}</p>
      <div class="link-cards">
        <RouterLink
          v-for="[label, description, path, icon] in [
            ['浏览模型与价格', '比较模型能力，查看积分价格与可用状态。', '/model-square', 'layers'],
            ['接入模型 API', '阅读图片、视频与文本接口的调用示例。', '/docs/models', 'code'],
            ['接入应用 API', '了解应用模板与统一网关的接入方式。', '/docs/apps', 'grid'],
          ]"
          :key="path"
          :to="path"
        >
          <AppIcon :name="icon" />
          <div>
            <b>{{ label }}</b>
            <small>{{ description }}</small>
          </div>
          <AppIcon name="arrow" :size="15" />
        </RouterLink>
      </div>
    </section>
    <footer>{{ app.site.footer }}</footer>
    <BaseModal v-if="selected" :title="String(selected.title)" wide @close="selected = null">
      <img
        v-if="selected.image_url"
        :src="String(selected.image_url)"
        class="work-preview"
        :alt="String(selected.title)"
      />
      <div
        v-else
        class="empty-state"
        :style="{ background: String(selected.gradient), borderRadius: '12px' }"
      >
        <AppIcon name="image" :size="42" />
        <h3>等待你的作品</h3>
        <p>上传作品后，它会出现在这里。</p>
      </div>
      <p class="preview-prompt">{{ selected.prompt || selected.subtitle }}</p>
      <button class="button primary" @click="create(String(selected.prompt || ''))">
        开始创作
        <AppIcon name="arrow" />
      </button>
    </BaseModal>
  </div>
</template>
<style scoped>
.home {
  max-width: 1400px;
  margin: auto;
}
.home-hero {
  position: relative;
  min-height: 730px;
  padding-top: 190px;
  isolation: isolate;
}
.hero-image {
  position: absolute;
  inset: 0 -2.2vw;
  z-index: -1;
  background-size: cover;
  background-position: center;
}
.hero-image:after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, var(--app-bg), transparent 70%),
    linear-gradient(0deg, var(--app-bg), transparent 35%);
}
.hero-art {
  position: absolute;
  inset: 0 -2.2vw;
  overflow: hidden;
  z-index: -1;
  background:
    radial-gradient(ellipse at 77% 30%, #d4e7d4 0, transparent 50%),
    linear-gradient(120deg, var(--app-bg) 30%, var(--accent-soft) 80%);
}
.hero-art:after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, var(--app-bg), transparent 35%);
}
.art-orbit {
  position: absolute;
  right: 6%;
  top: 60px;
  width: 380px;
  height: 510px;
  border-radius: 48% 48% 4% 48%;
  transform: rotate(25deg);
  border: 1px solid #769b7f3b;
  background: linear-gradient(145deg, #b3cabb55, #8fb59d33);
  box-shadow:
    inset 0 0 80px #eff7f366,
    0 30px 70px #436c4d0c;
}
.orbit-two {
  right: 10%;
  top: 105px;
  transform: rotate(-25deg);
  width: 300px;
  height: 420px;
  background: linear-gradient(140deg, #e8f2e250, #81a88c33);
}
.orbit-three {
  right: 1%;
  top: 260px;
  width: 210px;
  height: 210px;
  border-radius: 50%;
  background: linear-gradient(145deg, #edf5dfaa, #9fb5a077);
}
.art-caption {
  position: absolute;
  right: 12%;
  top: 560px;
  letter-spacing: 5px;
  font-size: 10px;
  color: #6d8c75;
}
.hero-copy {
  position: relative;
  max-width: 650px;
}
.hero-copy .eyebrow {
  color: var(--accent);
  font-size: 12px;
  letter-spacing: 5px;
  margin-bottom: 18px;
}
.hero-copy h1 {
  white-space: pre-line;
  font-size: clamp(48px, 5.22vw, 80px);
  font-weight: 900;
  line-height: 1.17;
  letter-spacing: -2px;
  background: var(--brand-gradient);
  background-clip: text;
  color: transparent;
}
.hero-copy p {
  font-size: 17px;
  font-weight: 550;
  color: var(--fg-2);
  margin-top: 27px;
}
.idea-form {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 14px 16px 14px 26px;
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--hairline) 30%, transparent);
  border-radius: 50px;
  box-shadow: 0 12px 35px #284b3610;
  position: relative;
  margin-top: 112px;
}
.idea-form > svg {
  color: var(--accent);
}
.idea-form label {
  flex: 1;
  min-width: 0;
}
.idea-form label > span {
  font-size: 13px;
  font-weight: 600;
}
.idea-form input {
  border: 0 !important;
  box-shadow: none !important;
  display: block;
  border: 0;
  padding: 3px 0 !important;
  box-shadow: none;
  background: transparent;
  border-radius: 0;
  font-size: 13px;
  height: 27px;
}
.idea-form .button {
  border-radius: 40px;
  height: 55px;
  gap: 11px;
  padding: 0 25px;
}
.hero-tip {
  text-align: center;
  font-size: 11px;
  margin-top: 13px;
  color: var(--fg-faint);
}
.home-entries {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin: 0 0 52px;
}
.home-entries > a {
  display: flex;
  position: relative;
  align-items: flex-start;
  gap: 13px;
  min-height: 108px;
  padding: 19px 14px;
  border-radius: 12px;
  background: linear-gradient(130deg, var(--surface), var(--app-bg));
  transition: transform 0.2s;
}
.home-entries > a:hover {
  transform: translateY(-3px);
}
.entry-icon {
  background: var(--tone-sage-soft);
  color: var(--tone-sage);
  width: 47px;
  height: 47px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  flex-shrink: 0;
}
.entry-1 .entry-icon {
  background: var(--tone-blue-soft);
  color: var(--tone-blue);
}
.entry-2 .entry-icon {
  background: var(--tone-clay-soft);
  color: var(--tone-clay);
}
.entry-3 .entry-icon {
  background: var(--tone-sand-soft);
  color: var(--tone-sand);
}
.home-entries h3 {
  font-size: 15px;
  margin: 2px 0 8px;
}
.home-entries p {
  font-size: 11px;
}
.entry-arrow {
  position: absolute;
  bottom: 12px;
  right: 15px;
  color: var(--accent);
  opacity: 0.65;
}
.home-section {
  margin-bottom: 44px;
}
.home-section h2 {
  font-size: 18px;
}
.inspiration-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.inspiration-grid button {
  min-height: 150px;
  border-radius: 12px;
  position: relative;
  overflow: hidden;
  text-align: left;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-start;
  padding: 20px;
  color: #233c2d;
}
.inspiration-grid img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.inspiration-grid button > span,
.inspiration-grid button > small {
  position: relative;
}
.inspiration-grid button > span {
  font-size: 18px;
  font-weight: 650;
}
.inspiration-grid small {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 8px;
  font-size: 11px;
}
.bento-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-rows: 230px;
  gap: 14px;
}
.bento-grid > button {
  position: relative;
  overflow: hidden;
  border-radius: 12px;
  text-align: left;
  color: #2c4938;
}
.bento-grid .bento-wide {
  grid-column: span 2;
}
.bento-grid img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s;
}
.bento-grid button:hover img {
  transform: scale(1.035);
}
.placeholder-number {
  position: absolute;
  left: 20px;
  top: 15px;
  font-size: 10px;
  letter-spacing: 2px;
  opacity: 0.55;
}
.placeholder-art {
  position: absolute;
  height: 150px;
  width: 130px;
  border: 1px solid #ffffff65;
  border-radius: 60% 60% 0 0;
  right: 13%;
  top: 18px;
  transform: rotate(25deg);
  background: linear-gradient(140deg, #ffffff40, transparent);
}
.work-label {
  position: absolute;
  bottom: 22px;
  left: 20px;
  font-size: 19px;
  font-weight: 550;
}
.work-label small {
  display: block;
  font-weight: 400;
  font-size: 10px;
  opacity: 0.6;
  margin-top: 4px;
}
.work-hover {
  position: absolute;
  inset: auto 0 0;
  padding: 25px 20px 15px;
  background: linear-gradient(transparent, #102e296b);
  color: #fff;
  display: flex;
  justify-content: space-between;
  opacity: 0;
  transition: opacity 0.2s;
  font-size: 12px;
}
.bento-grid button:hover .work-hover {
  opacity: 1;
}
.home-guide {
  background: var(--feature-bg);
  border: 1px solid var(--hairline);
  border-radius: 14px;
  padding: 28px;
  margin-top: 48px;
}
.home-guide .eyebrow {
  letter-spacing: 1px;
  font-size: 10px;
  margin-bottom: 8px;
}
.guide-steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  margin-top: 32px;
}
.guide-steps > div {
  display: flex;
  gap: 17px;
}
.guide-steps > div > span {
  font-size: 25px;
  font-weight: 300;
  color: var(--accent);
  opacity: 0.55;
  line-height: 1.3;
}
.guide-steps h3 {
  font-size: 13px;
}
.guide-steps p {
  font-size: 11px;
  margin-top: 6px;
}
.home-stats {
  display: flex;
  align-items: center;
  gap: 45px;
  padding: 30px 0;
  border-bottom: 1px solid var(--hairline);
}
.home-stats > p {
  margin-right: auto;
  font-size: 11px;
}
.home-stats > div {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.home-stats span {
  font-size: 10px;
  color: var(--fg-3);
}
.home-stats strong {
  font-size: 21px;
  font-weight: 650;
}
.home-seo {
  padding-top: 36px;
}
.home-seo h2 {
  font-size: 18px;
}
.home-seo > p {
  font-size: 12px;
  margin: 10px 0 20px;
}
.link-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.link-cards > a {
  border: 1px solid var(--hairline);
  background: var(--surface);
  border-radius: 10px;
  padding: 17px;
  display: flex;
  align-items: center;
  gap: 13px;
}
.link-cards > a > svg:first-child {
  color: var(--accent);
}
.link-cards > a > svg:last-child {
  margin-left: auto;
  color: var(--fg-3);
}
.link-cards b {
  font-size: 12px;
}
.link-cards small {
  display: block;
  font-size: 10px;
  color: var(--fg-3);
  margin-top: 5px;
}
footer {
  font-size: 10px;
  color: var(--fg-3);
  padding: 35px 0 0;
  text-align: center;
}
.work-preview {
  max-height: 65vh;
  object-fit: contain;
  margin: auto;
  border-radius: 10px;
}
.preview-prompt {
  margin: 20px 0;
}
.dark .hero-art {
  background: radial-gradient(ellipse at 77% 30%, #203b2c 0, transparent 50%);
}
.dark .art-orbit {
  opacity: 0.35;
}
@media (max-width: 1199px) {
  .home-entries {
    gap: 8px;
  }
  .home-entries > a {
    padding: 14px 8px;
    gap: 8px;
  }
  .entry-icon {
    width: 38px;
    height: 38px;
  }
  .home-entries h3 {
    font-size: 13px;
  }
  .home-entries p {
    font-size: 10px;
  }
  .hero-copy h1 {
    font-size: 65px;
  }
  .art-orbit {
    right: 0;
    opacity: 0.65;
  }
  .home-stats {
    gap: 25px;
  }
  .link-cards > a {
    padding: 13px;
    gap: 9px;
  }
  .link-cards > a > svg:last-child {
    display: none;
  }
}
@media (max-width: 1023px) {
  .home-hero {
    padding-top: 95px;
    min-height: 580px;
  }
  .hero-image,
  .hero-art {
    left: -24px;
    right: -24px;
  }
  .idea-form {
    margin-top: 75px;
  }
  .home-entries {
    margin-bottom: 40px;
  }
  .art-orbit {
    height: 350px;
    width: 250px;
  }
  .orbit-two {
    height: 300px;
    width: 200px;
  }
  .orbit-three {
    height: 130px;
    width: 130px;
  }
  .art-caption {
    top: 410px;
  }
  .hero-copy h1 {
    font-size: 58px;
  }
  .bento-grid {
    grid-auto-rows: 190px;
  }
  .link-cards {
    grid-template-columns: 1fr;
  }
  .home-stats > p {
    max-width: 180px;
  }
}
@media (max-width: 639px) {
  .home-hero {
    padding-top: 62px;
    min-height: 480px;
  }
  .hero-copy h1 {
    font-size: 48px;
    letter-spacing: -1.5px;
  }
  .hero-copy .eyebrow {
    font-size: 9px;
    letter-spacing: 3px;
    margin-bottom: 20px;
  }
  .hero-copy p {
    font-size: 13px;
    margin-top: 22px;
    max-width: 260px;
    line-height: 1.8;
  }
  .hero-art,
  .hero-image {
    left: -18px;
    right: -18px;
  }
  .art-orbit {
    height: 220px;
    width: 155px;
    top: 90px;
    right: -40px;
    opacity: 0.4;
  }
  .orbit-two {
    right: -20px;
    top: 120px;
    width: 100px;
    height: 175px;
  }
  .orbit-three {
    top: 200px;
    right: -40px;
    width: 120px;
    height: 120px;
  }
  .art-caption {
    display: none;
  }
  .idea-form {
    margin-top: 60px;
    gap: 11px;
    padding: 11px 10px 11px 16px;
    border-radius: 22px;
  }
  .idea-form > svg {
    width: 20px;
  }
  .idea-form label > span {
    font-size: 11px;
  }
  .idea-form input {
    border: 0 !important;
    box-shadow: none !important;
    font-size: 11px;
    height: 24px;
  }
  .idea-form .button {
    width: 43px;
    height: 43px;
    padding: 0;
    gap: 0;
    border-radius: 50%;
  }
  .idea-form .button > span,
  .idea-form .button > svg:first-child {
    display: none;
  }
  .hero-tip {
    font-size: 9px;
    line-height: 1.6;
    margin-top: 12px;
  }
  .home-entries {
    grid-template-columns: repeat(4, 1fr);
    margin-bottom: 36px;
    gap: 8px;
  }
  .home-entries > a {
    flex-direction: column;
    align-items: center;
    padding: 10px 0;
    gap: 8px;
    min-height: auto;
  }
  .home-entries h3 {
    font-size: 11px;
    margin: 0;
  }
  .home-entries p,
  .entry-arrow {
    display: none;
  }
  .entry-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
  }
  .home-section {
    margin-bottom: 30px;
  }
  .home-section h2 {
    font-size: 17px;
  }
  .section-header p {
    font-size: 11px;
  }
  .section-header .text-link {
    font-size: 11px;
  }
  .inspiration-grid {
    display: flex;
    overflow: auto;
    gap: 10px;
    margin-right: -18px;
    padding-right: 18px;
  }
  .inspiration-grid button {
    flex-shrink: 0;
    width: 200px;
    min-height: 125px;
    padding: 16px;
  }
  .inspiration-grid button > span {
    font-size: 16px;
  }
  .inspiration-grid small {
    font-size: 10px;
  }
  .bento-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: 180px;
    gap: 10px;
  }
  .bento-grid .bento-wide {
    grid-column: span 1;
  }
  .work-label {
    font-size: 15px;
    left: 14px;
    bottom: 15px;
  }
  .work-label small {
    font-size: 9px;
    max-width: 130px;
  }
  .placeholder-art {
    height: 110px;
    width: 80px;
  }
  .home-guide {
    margin-top: 30px;
    padding: 22px 18px;
  }
  .home-guide .between {
    align-items: start;
    gap: 14px;
  }
  .home-guide h2 {
    font-size: 18px;
  }
  .guide-steps {
    grid-template-columns: 1fr;
    gap: 22px;
    margin-top: 25px;
  }
  .guide-steps p {
    font-size: 12px;
  }
  .home-stats {
    gap: 18px;
    flex-wrap: wrap;
    padding: 24px 0;
  }
  .home-stats > p {
    max-width: none;
    width: 100%;
  }
  .home-stats > div {
    flex: 1;
  }
  .home-stats strong {
    font-size: 22px;
  }
  .home-stats span {
    font-size: 10px;
  }
  .home-seo {
    padding-top: 26px;
  }
  .home-seo > p {
    font-size: 12px;
  }
  .link-cards > a {
    padding: 16px;
  }
  .link-cards small {
    font-size: 11px;
  }
}
</style>
