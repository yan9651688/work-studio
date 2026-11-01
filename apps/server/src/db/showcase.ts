import type { DB } from './index.js';

// 首页默认展示素材，图片位于 apps/web/public/showcase/
export const HERO_IMAGE = '/showcase/hero.jpg';

const palettes = [
  'linear-gradient(135deg,#c6daca,#6a8f78)',
  'linear-gradient(135deg,#d8e6ef,#789eb7)',
  'linear-gradient(135deg,#efdbc9,#be8c6a)',
  'linear-gradient(135deg,#e7dfca,#b3a06d)',
  'linear-gradient(135deg,#ddd9e9,#9a92b4)',
  'linear-gradient(135deg,#dae6df,#91b7a1)',
];

export const inspirations = [
  {
    title: '游戏插画',
    image: 'insp-game',
    prompt:
      '3A 游戏概念插画，一位身披斗篷的东方女剑客站在云海之上的古老石桥，远处悬浮山峰与发光的巨大月亮，青绿与金色配色，史诗感，细节丰富。',
  },
  {
    title: '节日海报',
    image: 'insp-festival',
    prompt:
      '中秋节日海报风格插画，圆月下的江南水乡屋檐与灯笼，玉兔剪影，暖金与深蓝配色，温暖喜庆，上方留白用于排版。',
  },
  {
    title: '杂志封面',
    image: 'insp-magazine',
    prompt:
      '时尚杂志封面风格人像摄影，短发年轻女性穿奶油色西装，纯色暖米色背景，柔和棚拍光，自信眼神，高级极简。',
  },
  {
    title: '电影海报',
    image: 'insp-movie',
    prompt:
      '电影海报风格，雨夜霓虹灯下的城市街道，一个撑透明雨伞的背影走向远处的光，青色与洋红色调，电影感光影与雾气。',
  },
  {
    title: '城市街拍',
    image: 'insp-street',
    prompt:
      '城市街拍摄影，傍晚金色阳光下的老城区街道，年轻男子穿卡其色风衣走过斑马线，胶片色调，自然抓拍感，浅景深。',
  },
  {
    title: '产品广告',
    image: 'insp-product',
    prompt:
      '高端产品广告摄影，磨砂玻璃香水瓶立在浅水面上，周围是绿色植物叶片和水波倒影，柔和侧光，奶油绿色调，极简高级。',
  },
].map((item, i) => ({
  id: `inspiration-${i}`,
  kind: 'inspiration',
  title: item.title,
  subtitle: '从一个方向出发',
  prompt: item.prompt,
  image_url: `/showcase/${item.image}.jpg`,
  gradient: palettes[i],
  span: 1,
  weight: 6 - i,
  enabled: true,
}));

export const works = [
  {
    title: '云端浮岛',
    prompt:
      '超现实奇幻风景，一座漂浮在云端的小岛，岛上有一棵开满白花的巨树和一座小木屋，瀑布流入云海，黄昏粉紫色天空，梦幻插画风格。',
  },
  {
    title: '午后散步',
    prompt: '一只戴着草帽的橘猫，漫步在午后阳光里的乡间小路上，路边是野花，温暖柔和的光线，写实摄影，浅景深。',
  },
  {
    title: '霓虹少女',
    prompt: '赛博朋克风格少女肖像插画，银色短发，发光的耳机，背景是蓝紫色全息光斑，细腻的数字绘画质感。',
  },
  {
    title: '鹤舞荷塘',
    prompt: '水墨与工笔结合的中国风插画，一只白鹤从荷塘上飞起，淡雅青绿与金色点缀，宣纸质感，大量留白。',
  },
  {
    title: '晨光静物',
    prompt: '温馨的室内静物摄影，木桌上的拿铁咖啡、打开的书和一束干花，窗外柔和晨光，暖米色调，生活方式杂志风格。',
  },
  {
    title: '极光海岸',
    prompt: '冰岛风格自然风光摄影，黑色沙滩上的冰块，远处雪山与极光，极光倒映在湿润沙滩上，长曝光，高清细节。',
  },
].map((item, i) => ({
  id: `showcase-${i}`,
  kind: 'bento',
  title: item.title,
  subtitle: '',
  prompt: item.prompt,
  image_url: `/showcase/work-${i + 1}.jpg`,
  gradient: palettes[i],
  span: 1,
  weight: 6 - i,
  enabled: true,
}));

const legacyInspirationTitles = ['自然光影', '几何构成', '静物叙事'];

// 给已有站点补上默认素材：只替换仍是初始占位（无图片）的记录，不覆盖管理员改过的内容
export function fillShowcase(db: DB) {
  let changed = 0;
  db.sql.transaction(() => {
    const hero = (db.settings().home_hero || {}) as Record<string, unknown>;
    if (!hero.image) {
      db.setSetting('home_hero', { ...hero, image: HERO_IMAGE });
      changed++;
    }
    for (const { id, ...item } of [...inspirations, ...works]) {
      const existing = db.get('showcase', id);
      const placeholder =
        existing &&
        !existing.image_url &&
        (String(existing.title).startsWith('创作留白') ||
          legacyInspirationTitles.includes(String(existing.title)));
      if (existing && !placeholder) continue;
      db.put('showcase', item, id);
      changed++;
    }
  })();
  return changed;
}
