<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useThemeMode } from '../composables/useThemeMode'
import { useHeroShader } from '../composables/useHeroShader'
import { CARD_IMAGES, ENGINE_ROWS, HOME_COPY } from './home-content'
import './home-theme.css'

const router = useRouter()
const { mode, toggle } = useThemeMode()

const canvasRef = ref<HTMLCanvasElement | null>(null)
useHeroShader(canvasRef, mode)

const copy = computed(() => HOME_COPY[mode.value])

/* 导航：滚动后变实 */
const navSolid = ref(false)
function onScroll() {
  navSolid.value = window.scrollY > 40
}

/* 进场动画 */
const rootRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in')
          observer?.unobserve(entry.target)
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
  )
  rootRef.value?.querySelectorAll('.rise').forEach((el) => observer?.observe(el))
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  observer?.disconnect()
  observer = null
})

function goLogin() {
  router.push({ name: 'login' })
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}
</script>

<template>
  <div ref="rootRef" class="home zhu-home">
    <!-- 背景：着色器 + 明暗层 + 颗粒 -->
    <canvas ref="canvasRef" class="gl" aria-hidden="true" />
    <div class="scrim" aria-hidden="true" />
    <div class="grain" aria-hidden="true" />

    <div class="page">
      <nav class="nav" :class="{ solid: navSolid }">
        <div class="brand"><span class="dot" /><b>筑境</b><span class="lat">ZHUJING</span></div>
        <div class="links">
          <a href="#views" @click.prevent="scrollTo('views')">视角</a>
          <a href="#engine" @click.prevent="scrollTo('engine')">引擎</a>
          <a href="#stack" @click.prevent="scrollTo('stack')">技术</a>
        </div>
        <button class="theme-toggle" type="button" aria-label="切换昼夜模式" @click="toggle">
          <svg class="ico-night" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
          </svg>
          <svg class="ico-day" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
          </svg>
          <span>{{ copy.toggleLabel }}</span>
        </button>
        <button class="enter" type="button" @click="goLogin">进入工作台</button>
      </nav>

      <!-- 首屏 -->
      <header class="hero wrap">
        <div class="hero-inner">
          <div>
            <div class="eyebrow rise">
              <span class="bar" />
              <span class="mono">{{ copy.eyebrow }}</span>
            </div>
            <h1 class="rise" style="--d: 0.08s">
              <span class="thin">{{ copy.heroTop }}</span><br />
              <span class="glow">{{ copy.heroBottom }}</span>
            </h1>
            <p class="lede rise" style="--d: 0.18s">{{ copy.lede }}</p>
            <div class="hero-actions rise" style="--d: 0.26s">
              <button class="btn btn-primary" type="button" @click="goLogin">免费开始设计 →</button>
              <button class="btn btn-ghost" type="button" @click="scrollTo('views')">看看效果</button>
            </div>
          </div>

          <div class="spec rise" style="--d: 0.14s">
            <div class="spec-head"><b>户型 / 实时预览</b><span>实时</span></div>
            <svg viewBox="0 0 320 210" fill="none" aria-label="户型示意">
              <defs>
                <linearGradient id="home-wall" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" style="stop-color: var(--accent)" />
                  <stop offset="1" style="stop-color: var(--accent-3)" />
                </linearGradient>
                <filter id="home-glow">
                  <feGaussianBlur stdDeviation="2.4" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <g stroke="url(#home-wall)" stroke-width="1.6" filter="url(#home-glow)" opacity=".95">
                <path d="M24 26 H236 V186 H24 Z" />
                <path d="M24 96 H132" /><path d="M132 26 V186" /><path d="M132 140 H236" />
              </g>
              <g style="fill: var(--accent)" opacity=".14">
                <rect x="34" y="36" width="88" height="50" rx="3" />
                <rect x="142" y="36" width="84" height="94" rx="3" />
              </g>
              <g fill="none" style="stroke: var(--accent-2)" stroke-width="1.1" opacity=".9">
                <rect x="42" y="46" width="46" height="22" rx="4" />
                <rect x="156" y="52" width="30" height="52" rx="4" />
                <rect x="142" y="150" width="54" height="16" rx="3" />
              </g>
              <g font-family="Consolas, monospace" font-size="7" style="fill: var(--muted)">
                <text x="34" y="18">客厅 24.6㎡</text>
                <text x="142" y="18">书房 11.2㎡</text>
                <text x="148" y="176">卧室 8.4㎡</text>
              </g>
            </svg>
            <div class="legend">
              <span><i style="background: var(--accent)" />墙体</span>
              <span><i style="background: var(--accent-2)" />家具</span>
              <span><i style="background: var(--accent-3)" />尺寸</span>
            </div>
          </div>
        </div>

        <div class="hero-foot">
          <div class="k">
            <div><b>60</b><span>帧率</span></div>
            <div><b>1,240</b><span>素材</span></div>
            <div><b>0</b><span>安装</span></div>
          </div>
          <div class="scroll-hint"><i /><span>向下滚动</span></div>
        </div>
      </header>

      <!-- 视角 -->
      <section id="views" class="block wrap">
        <div class="sec-head rise">
          <span class="idx">01</span>
          <h2>{{ copy.viewsTitle }}</h2>
          <p>{{ copy.viewsSub }}</p>
        </div>
        <div class="cards">
          <article v-for="(card, index) in CARD_IMAGES" :key="card.night" class="card rise" :style="{ '--d': `${index * 0.06}s` }">
            <!-- 用 v-if 而非 CSS 显隐：只渲染当前主题那一张，避免两张图叠在一起 -->
            <img v-if="mode === 'day'" class="pic pic-day" :src="card.day" :alt="card.alt" />
            <img v-else class="pic pic-night" :src="card.night" :alt="card.alt" />
            <span class="corner">{{ copy.cards[index].corner }}</span>
            <div class="veil" />
            <div class="body">
              <b>{{ copy.cards[index].title }}</b>
              <span>{{ copy.cards[index].sub }}</span>
            </div>
          </article>
        </div>
      </section>

      <!-- 引擎 -->
      <section id="engine" class="block wrap">
        <div class="sec-head rise">
          <span class="idx">02</span>
          <h2>引擎在做什么</h2>
          <p>四套系统</p>
        </div>
        <div class="engine">
          <div v-for="row in ENGINE_ROWS" :key="row.tag" class="erow rise">
            <span class="tag">{{ row.tag }}</span>
            <b>{{ row.title }}</b>
            <p>{{ row.desc }}</p>
          </div>
        </div>
      </section>

      <!-- 引用 -->
      <section id="stack" class="quote wrap">
        <blockquote class="rise">
          {{ copy.quote.before }}<em>{{ copy.quote.after }}</em>。
        </blockquote>
        <div class="by rise" style="--d: 0.1s">— 筑境 产品笔记 · 二〇二五</div>
      </section>

      <!-- CTA -->
      <section class="wrap">
        <div class="cta rise">
          <h2>{{ copy.ctaTitle }}</h2>
          <p>{{ copy.ctaDesc }}</p>
          <button class="btn btn-primary" type="button" @click="goLogin">开始你的第一个户型</button>
        </div>
      </section>

      <footer class="wrap">
        <span>筑境 ZHUJING</span>
        <span>© 二〇二五</span>
        <div class="r"><a href="#">关于</a><a href="#">联系</a><a href="#">隐私</a></div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* Layout only. Colors/theme variables live in home-theme.css (global). */
.home {
  --sans: 'HarmonyOS Sans SC', 'MiSans', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --latin: 'Bahnschrift', 'Segoe UI', 'HarmonyOS Sans SC', sans-serif;
  --mono: 'Consolas', 'SFMono-Regular', monospace;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);

  position: relative;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-weight: 300;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
  transition: background 0.7s var(--ease), color 0.7s var(--ease);
}

.home *,
.home *::before,
.home *::after { box-sizing: border-box; }
.home img { display: block; max-width: 100%; }
.home a { color: inherit; text-decoration: none; }
.home a:hover { text-decoration: none; }
/* Reset only bare buttons so .btn keeps its own background. */
.home button:not([class]) { font: inherit; cursor: pointer; color: inherit; background: none; border: 0; padding: 0; }
.home button { font: inherit; cursor: pointer; border: 0; }
.home button.btn { padding: 13px 24px; border-radius: 999px; border: 0; }
.home button.enter { padding: 9px 18px; border-radius: 999px; border: 0; }
.home button.theme-toggle { padding: 8px 14px 8px 11px; border-radius: 999px; border: 0; }
.home button.btn-primary { background: var(--btn); color: var(--btn-ink); }
.home button.btn-primary:hover { background: var(--btn-hover); }
.home button.btn-ghost { background: var(--surface); color: var(--text); }
.home ::selection { background: var(--accent); color: var(--accent-ink); }

.gl { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0; display: block; }

.scrim {
  position: fixed; inset: 0; z-index: 1; pointer-events: none;
  background:
    radial-gradient(130% 90% at 62% 12%,
      rgba(var(--scrim-a), 0) 0%,
      rgba(var(--scrim-a), var(--scrim-a2)) 58%,
      rgba(var(--scrim-a), var(--scrim-a3)) 100%),
    linear-gradient(180deg,
      rgba(var(--scrim-b), var(--scrim-b1)) 0%,
      rgba(var(--scrim-b), var(--scrim-b2)) 42%,
      rgba(var(--scrim-b), var(--scrim-b3)) 100%);
  transition: background 0.7s var(--ease);
}
/* grain: normal blend keeps blacks black (screen/overlay washed them out) */
.grain {
  position: fixed; inset: 0; z-index: 2; pointer-events: none;
  opacity: var(--grain-opacity);
  mix-blend-mode: normal;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E");
  transition: opacity 0.7s var(--ease);
}
.page { position: relative; z-index: 3; }

.wrap { width: min(1200px, calc(100% - 56px)); margin: 0 auto; }
@media (max-width: 760px) { .wrap { width: calc(100% - 36px); } }

.mono { font-family: var(--mono); font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); }

.nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 40;
  display: flex; align-items: center; gap: 14px;
  padding: 14px min(28px, 4vw);
  border-bottom: 1px solid transparent;
  transition: background 0.6s, border-color 0.6s, backdrop-filter 0.6s;
}
.nav.solid {
  background: color-mix(in srgb, var(--bg) 76%, transparent);
  border-color: var(--surface-line);
  backdrop-filter: blur(14px);
}
.brand { display: flex; align-items: center; gap: 9px; }
.dot {
  width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 12px 2px var(--glow-strong);
  transition: background 0.7s, box-shadow 0.7s;
}
.nav b { font-weight: 500; font-size: 15px; letter-spacing: 0.18em; color: var(--text-strong); }
.lat { font-family: var(--latin); font-size: 9.5px; letter-spacing: 0.34em; color: var(--muted); }
.links { display: flex; gap: 22px; margin-left: auto; font-size: 12px; }
.links a {
  padding-bottom: 2px; border-bottom: 1px solid transparent;
  transition: color 0.3s, border-color 0.3s;
}
.links a:hover { color: var(--accent); border-color: var(--accent); }

.theme-toggle {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px 8px 11px; border-radius: 999px;
  background: var(--surface); box-shadow: inset 0 0 0 1px var(--surface-line);
  color: var(--text); font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.14em;
  transition: background 0.4s, box-shadow 0.4s, transform 0.3s;
}
.theme-toggle:hover { transform: translateY(-1px); box-shadow: inset 0 0 0 1px var(--accent); }
.theme-toggle svg { width: 14px; height: 14px; flex: 0 0 14px; }
.ico-day { display: none; }

.enter {
  padding: 9px 18px; border-radius: 999px; font-size: 12px; letter-spacing: 0.1em;
  color: var(--btn-ink); background: var(--btn);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06), 0 4px 12px -6px var(--btn-shadow);
  transition: transform 0.35s var(--ease), box-shadow 0.35s, background 0.7s, color 0.7s;
}
.enter:hover {
  transform: translateY(-1px); background: var(--btn-hover);
  box-shadow: 0 2px 4px rgba(16, 24, 40, 0.08), 0 8px 18px -8px var(--btn-shadow);
}
.enter:active { transform: translateY(0); }
@media (max-width: 820px) {
  .links, .lat { display: none; }
  .enter { margin-left: auto; }
  .theme-toggle span { display: none; }
  .theme-toggle { padding: 9px; }
}

.hero {
  min-height: 100svh; display: grid; grid-template-rows: 1fr auto;
  padding: clamp(96px, 14vh, 160px) 0 clamp(28px, 5vh, 56px);
}
.hero-inner { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: clamp(20px, 5vw, 64px); align-items: center; }
.eyebrow { display: flex; align-items: center; gap: 10px; margin-bottom: clamp(16px, 3vw, 28px); }
.eyebrow .bar { width: 34px; height: 1px; background: linear-gradient(90deg, var(--accent), transparent); }
h1 {
  margin: 0; font-weight: 200; letter-spacing: -0.01em;
  font-size: clamp(44px, 7.6vw, 116px); line-height: 1.02; color: var(--text-strong);
}
h1 .glow {
  background: linear-gradient(96deg, var(--headline-a) 0%, var(--accent) 42%, var(--accent-3) 76%, var(--accent-2) 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 26px var(--glow-strong));
}
h1 .thin { color: var(--text); font-weight: 200; }
.lede {
  margin: clamp(18px, 3vw, 30px) 0 0; max-width: 30em;
  font-size: clamp(13px, 1.1vw, 15px); line-height: 2.1; color: var(--text); opacity: 0.78;
}
.hero-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-top: clamp(24px, 3.4vw, 40px); }

.btn {
  display: inline-flex; align-items: center; gap: 9px; padding: 13px 24px; border-radius: 999px;
  font-size: 13px; letter-spacing: 0.06em;
  transition: transform 0.35s var(--ease), box-shadow 0.35s, background 0.5s;
}
/* Flat button: solid fill, one soft neutral shadow for elevation.
   No inner white stroke (it read as a matte seam) and no colored glow. */
.btn-primary {
  color: var(--btn-ink); background: var(--btn);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06), 0 6px 16px -8px var(--btn-shadow);
}
.btn-primary:hover {
  transform: translateY(-1px); background: var(--btn-hover);
  box-shadow: 0 2px 4px rgba(16, 24, 40, 0.08), 0 10px 22px -10px var(--btn-shadow);
}
.btn-primary:active { transform: translateY(0); }
.btn-ghost {
  color: var(--text); background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--surface-line); backdrop-filter: blur(6px);
}

.spec {
  position: relative; padding: 20px; border-radius: 18px;
  background: linear-gradient(160deg, var(--surface), color-mix(in srgb, var(--surface) 40%, transparent));
  box-shadow: inset 0 0 0 1px var(--surface-line), 0 30px 70px -40px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
  transform: perspective(900px) rotateY(-7deg) rotateX(3deg);
  transition: transform 0.7s var(--ease), background 0.7s;
}
.spec:hover { transform: perspective(900px) rotateY(-2deg) rotateX(1deg) translateY(-4px); }
.spec::after {
  content: ''; position: absolute; inset: -1px; border-radius: 19px; pointer-events: none; padding: 1px;
  background: linear-gradient(140deg, color-mix(in srgb, var(--accent) 60%, transparent), transparent 42%, color-mix(in srgb, var(--accent-3) 45%, transparent));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
}
.spec-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.spec-head b { font-weight: 400; font-size: 12px; letter-spacing: 0.16em; color: var(--text-strong); }
.spec-head span { font-family: var(--mono); font-size: 9px; letter-spacing: 0.18em; color: var(--accent); }
.spec svg { width: 100%; height: auto; display: block; }
.legend { display: flex; gap: 14px; margin-top: 12px; font-family: var(--mono); font-size: 9px; letter-spacing: 0.1em; color: var(--muted); }
.legend i { display: inline-block; width: 8px; height: 1px; margin-right: 5px; vertical-align: middle; }
@media (max-width: 860px) {
  .hero-inner { grid-template-columns: 1fr; gap: 26px; }
  .spec { transform: none; }
  .hero { padding-top: 96px; }
}

.hero-foot { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 20px; margin-top: 34px; }
.hero-foot .k { display: flex; gap: 30px; }
.hero-foot .k div b { display: block; font-family: var(--latin); font-weight: 600; font-size: 26px; letter-spacing: -0.01em; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.hero-foot .k div span { font-family: var(--mono); font-size: 9px; letter-spacing: 0.18em; color: var(--muted); }
.scroll-hint { margin-left: auto; display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 9px; letter-spacing: 0.22em; color: var(--muted); }
.scroll-hint i { display: block; width: 1px; height: 34px; background: linear-gradient(var(--accent), transparent); animation: drop 2.4s var(--ease) infinite; }
@keyframes drop { 0%, 100% { opacity: 0.2; transform: scaleY(0.35); } 50% { opacity: 1; transform: scaleY(1); } }
@media (max-width: 860px) { .scroll-hint { display: none; } }

.block { padding: clamp(64px, 10vw, 140px) 0 0; }
.sec-head { display: flex; align-items: baseline; gap: 16px; margin-bottom: clamp(24px, 4vw, 44px); }
.sec-head .idx { font-family: var(--mono); font-size: 10px; letter-spacing: 0.2em; color: var(--accent); }
.sec-head h2 { margin: 0; font-weight: 300; font-size: clamp(23px, 3.4vw, 40px); letter-spacing: 0.04em; color: var(--text-strong); }
.sec-head p { margin: 0 0 0 auto; font-size: 12px; color: var(--muted); }

.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: clamp(10px, 1.6vw, 18px); }
.pic {
  width: 100%; aspect-ratio: 4/5; object-fit: cover;
  position: absolute; inset: 0; opacity: 0.86;
  transition: opacity 0.6s, transform 1.1s var(--ease), filter 0.7s;
}
.card:hover .pic { opacity: 1; transform: scale(1.04); }
.card {
  position: relative; overflow: hidden; border-radius: 16px; aspect-ratio: 4/5;
  background: var(--card-bg); box-shadow: inset 0 0 0 1px var(--surface-line);
  transition: transform 0.6s var(--ease), box-shadow 0.6s, background 0.7s;
}
.card:hover { transform: translateY(-6px); box-shadow: inset 0 0 0 1px var(--accent), 0 30px 60px -30px var(--glow-strong); }
.veil { position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, rgba(var(--scrim-a), 0.92) 100%); transition: background 0.7s; }
.body { position: absolute; left: 0; right: 0; bottom: 0; padding: 16px; }
.body b { display: block; font-weight: 400; font-size: 15px; letter-spacing: 0.06em; color: var(--text-strong); }
.body span { display: block; margin-top: 6px; font-family: var(--mono); font-size: 9px; letter-spacing: 0.16em; color: var(--muted); }
.corner {
  position: absolute; top: 12px; left: 12px; padding: 4px 8px; border-radius: 999px;
  font-family: var(--mono); font-size: 8.5px; letter-spacing: 0.16em; color: var(--accent);
  background: color-mix(in srgb, var(--bg) 62%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
}
@media (max-width: 860px) {
  .cards { grid-template-columns: 1fr; }
  .card, .pic { aspect-ratio: 16 / 11; }
}

.engine { border-top: 1px solid var(--surface-line); }
.erow {
  display: grid; grid-template-columns: 76px 1fr 1.3fr; gap: clamp(12px, 3vw, 40px);
  align-items: center; padding: clamp(16px, 2.2vw, 26px) 4px;
  border-bottom: 1px solid var(--surface-line);
  transition: background 0.5s, padding-left 0.5s;
}
.erow:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); padding-left: 14px; }
.erow .tag { font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.16em; color: var(--accent); }
.erow b { font-weight: 400; font-size: clamp(15px, 1.7vw, 19px); letter-spacing: 0.04em; color: var(--text-strong); }
.erow p { margin: 0; font-size: 12.5px; line-height: 1.9; color: var(--text); opacity: 0.72; }
@media (max-width: 860px) { .erow { grid-template-columns: 1fr; gap: 6px; } }

.quote { padding: clamp(70px, 12vw, 170px) 0 clamp(30px, 5vw, 60px); }
.quote blockquote {
  margin: 0; font-weight: 200; letter-spacing: 0.01em; line-height: 1.35;
  font-size: clamp(24px, 4.4vw, 54px);
  background: linear-gradient(96deg, var(--quote-a), var(--quote-b) 55%, color-mix(in srgb, var(--quote-b) 70%, var(--accent-3)));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.quote blockquote em { font-style: normal; color: var(--accent); -webkit-text-fill-color: var(--accent); }
.quote .by { margin-top: 22px; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.2em; color: var(--muted); }

.cta {
  margin-top: clamp(40px, 7vw, 90px); padding: clamp(30px, 5vw, 60px);
  border-radius: 22px; text-align: center; position: relative; overflow: hidden;
  background: radial-gradient(120% 140% at 50% 0%,
    color-mix(in srgb, var(--accent) 14%, transparent),
    color-mix(in srgb, var(--accent-3) 10%, transparent) 45%, transparent 75%);
  box-shadow: inset 0 0 0 1px var(--surface-line);
  transition: background 0.7s;
}
.cta h2 { margin: 0 0 10px; font-weight: 200; font-size: clamp(26px, 4.2vw, 48px); letter-spacing: 0.06em; color: var(--text-strong); }
.cta p { margin: 0 0 26px; font-size: 13px; color: var(--text); opacity: 0.72; }
.cta .btn-primary { padding: 15px 30px; font-size: 14px; }

footer {
  display: flex; flex-wrap: wrap; gap: 10px 24px; align-items: center;
  padding: 34px 0 40px; margin-top: clamp(50px, 8vw, 100px);
  border-top: 1px solid var(--surface-line);
  font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.16em; color: var(--muted);
}
footer .r { margin-left: auto; display: flex; gap: 20px; }

.rise { opacity: 0; transform: translateY(26px); transition: opacity 1.1s var(--ease), transform 1.2s var(--ease); transition-delay: var(--d, 0s); }
.rise.in { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  .rise { opacity: 1; transform: none; }
  .scroll-hint i { animation: none; }
}
</style>
