import type { ThemeMode } from '../composables/useThemeMode'

export type HomeCopy = {
  eyebrow: string
  heroTop: string
  heroBottom: string
  lede: string
  viewsTitle: string
  viewsSub: string
  cards: { corner: string; title: string; sub: string }[]
  quote: { before: string; after: string }
  ctaTitle: string
  ctaDesc: string
  toggleLabel: string
}

/**
 * 首页文案。昼夜两套不只是颜色不同——白天讲“光怎么算”，夜里讲“光怎么看见”。
 * 卡片对应 public/home 下的两套图（夜/昼各三张）。
 */
export const HOME_COPY: Record<ThemeMode, HomeCopy> = {
  night: {
    eyebrow: '实时室内渲染 / 夜间模式',
    heroTop: '把家',
    heroBottom: '先看见',
    lede: '平面画完的那一刻，光就已经在房间里了。实时渲染不必等待，拖动一下视角，窗外的天色、灯带的亮度，都跟着变。',
    viewsTitle: '三个视角，一间房',
    viewsSub: '平面 / 立体 / 夜景，点一下就能切',
    cards: [
      { corner: '平面转三维', title: '俯视 · 结构', sub: '正交视图 · 一比一百' },
      { corner: '光线', title: '入内 · 光线', sub: '窗光角度 · 下午三点' },
      { corner: '夜景', title: '夜里 · 氛围', sub: '暖光 · 2700K' },
    ],
    quote: { before: '好设计不该藏在专业软件里。它应该在一台开着的浏览器里，', after: '随时能看见' },
    ctaTitle: '关灯之前，先看一眼',
    ctaDesc: '免费账户可保存 3 个方案，无需绑定任何支付方式。',
    toggleLabel: '夜间',
  },
  day: {
    eyebrow: '实时室内渲染 / 日间模式',
    heroTop: '把家',
    heroBottom: '先算一遍',
    lede: '窗开在东南还是西北，正午进来多少光，傍晚几点开始发暗 —— 改一扇窗，结果立刻重算。不必等到搬进去，才知道哪间房闷。',
    viewsTitle: '一天里的三段光',
    viewsSub: '清晨 / 正午 / 傍晚，同一间房',
    cards: [
      { corner: '早上七点四十', title: '清晨 · 东窗', sub: '日出方位 · 东偏北' },
      { corner: '正午十二点', title: '正午 · 光面', sub: '太阳高度角 · 六十二度' },
      { corner: '傍晚六点二十', title: '傍晚 · 天光', sub: '日落方位 · 西偏北' },
    ],
    quote: { before: '窗户开在哪、开多大，决定了一整天房间的样子，', after: '不该靠猜' },
    ctaTitle: '先在图上把光算清楚',
    ctaDesc: '免费账户可保存 3 个方案，无需绑定任何支付方式。',
    toggleLabel: '日间',
  },
}

/** 卡片图片：同一间房，夜里用暗调、白天用亮调 */
export const CARD_IMAGES = [
  { night: '/home/d3-loft.jpg', day: '/home/d1-hero.jpg', alt: '户型俯视' },
  { night: '/home/d3-library.jpg', day: '/home/d4-hero.jpg', alt: '室内光线' },
  { night: '/home/d3-lounge.jpg', day: '/home/d4-sunroom.jpg', alt: '夜间氛围' },
]

export const ENGINE_ROWS = [
  { tag: '几何', title: '墙体即时成型', desc: '墙线一画完就挤出成体，门窗直接挖洞，不必等一次构建。' },
  { tag: '光照', title: '窗位即光源', desc: '窗开在哪面墙，日光就从哪里进来；改窗即改光，实时重算。' },
  { tag: '材质', title: '材质不靠贴图堆', desc: '木、石、布、乳胶漆，按真实粗糙度与反射配比，近看也不假。' },
  { tag: '同步', title: '端上同步', desc: '平面、三维、收藏夹共用一份文档，任何一端改动即全端生效。' },
]
