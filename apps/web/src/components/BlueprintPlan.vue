<script setup lang="ts">
/**
 * 户型蓝图插画。
 *
 * 用来替换原来那块暖米色 3D 房间图：全部走 CSS 变量，
 * 夜间是青色发光线框，白昼自动变成蓝紫线框，和页面主题一致。
 */
</script>

<template>
  <div class="bp-scene">
    <svg viewBox="0 0 640 520" preserveAspectRatio="xMidYMid meet" role="img" aria-label="户型蓝图示意">
      <!-- 房间底色 -->
      <g fill="var(--accent-soft)">
        <rect x="115" y="125" width="210" height="270" rx="2" />
        <rect x="335" y="125" width="170" height="140" rx="2" opacity="0.7" />
        <rect x="335" y="275" width="170" height="120" rx="2" opacity="0.5" />
      </g>

      <!-- 墙体 -->
      <g
        class="bp-walls"
        fill="none"
        stroke="var(--accent)"
        stroke-width="10"
        stroke-linecap="square"
        stroke-linejoin="miter"
      >
        <path d="M110 120 H510 V400 H110 Z" />
        <path d="M330 120 V250" />
        <path d="M330 305 V400" />
        <path d="M330 270 H380" />
        <path d="M430 270 H510" />
      </g>

      <!-- 窗 -->
      <g fill="none" stroke="var(--accent-2)" stroke-width="2">
        <rect x="150" y="114" width="150" height="12" rx="2" />
        <line x1="225" y1="114" x2="225" y2="126" stroke-width="1.4" />
        <rect x="104" y="300" width="12" height="60" rx="2" />
        <line x1="104" y1="330" x2="116" y2="330" stroke-width="1.4" />
      </g>

      <!-- 门 -->
      <g fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 5">
        <path d="M330 250 A 55 55 0 0 1 385 305" />
        <path d="M430 270 A 50 50 0 0 0 380 220" />
      </g>
      <g stroke="var(--muted)" stroke-width="2" stroke-linecap="round">
        <line x1="330" y1="305" x2="385" y2="305" />
        <line x1="380" y1="270" x2="380" y2="220" />
      </g>

      <!-- 家具 -->
      <g fill="var(--accent-3)" fill-opacity="0.12" stroke="var(--accent-3)" stroke-width="1.6">
        <rect x="145" y="305" width="120" height="44" rx="8" />
        <path d="M160 305 v-16 h90 v16" fill="none" />
        <ellipse cx="215" cy="235" rx="42" ry="26" />
        <rect x="350" y="145" width="120" height="80" rx="6" />
        <path d="M350 165 h120" fill="none" opacity="0.6" />
        <rect x="350" y="300" width="120" height="42" rx="6" />
        <circle cx="300" cy="160" r="11" fill="none" stroke-width="1.4" />
        <circle cx="470" cy="330" r="11" fill="none" stroke-width="1.4" />
      </g>

      <!-- 尺寸标注 -->
      <g stroke="var(--muted)" stroke-width="1" fill="none" opacity="0.85">
        <line x1="110" y1="84" x2="510" y2="84" />
        <line x1="110" y1="78" x2="110" y2="90" />
        <line x1="510" y1="78" x2="510" y2="90" />
        <line x1="76" y1="120" x2="76" y2="400" />
        <line x1="70" y1="120" x2="82" y2="120" />
        <line x1="70" y1="400" x2="82" y2="400" />
      </g>
      <text class="bp-dim" x="310" y="73" text-anchor="middle">5200</text>
      <text class="bp-dim" x="66" y="260" text-anchor="middle" transform="rotate(-90 66 260)">4200</text>

      <!-- 房间名 -->
      <text class="bp-label" x="215" y="218" text-anchor="middle">客厅</text>
      <text class="bp-sub" x="215" y="238" text-anchor="middle">24.6㎡</text>
      <text class="bp-label" x="420" y="192" text-anchor="middle">主卧</text>
      <text class="bp-sub" x="420" y="212" text-anchor="middle">15.2㎡</text>
      <text class="bp-label" x="420" y="352" text-anchor="middle">书房</text>
      <text class="bp-sub" x="420" y="372" text-anchor="middle">9.4㎡</text>

      <!-- 角落标记 -->
      <g fill="var(--accent-2)">
        <circle cx="110" cy="120" r="2.2" />
        <circle cx="510" cy="120" r="2.2" />
        <circle cx="510" cy="400" r="2.2" />
        <circle cx="110" cy="400" r="2.2" />
      </g>

      <!-- 指北 -->
      <g stroke="var(--muted)" fill="none" opacity="0.9">
        <circle cx="572" cy="86" r="13" />
        <line x1="572" y1="99" x2="572" y2="73" />
        <path d="M572 73 l-4 8 h8 Z" fill="var(--muted)" stroke="none" />
      </g>
      <text class="bp-dim" x="572" y="118" text-anchor="middle">N</text>

      <text class="bp-chip" x="110" y="44">户型 / 2D 蓝图</text>
      <text class="bp-chip" x="510" y="44" text-anchor="end">1 : 100</text>
    </svg>
  </div>
</template>

<style scoped>
.bp-scene {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background-image: linear-gradient(var(--line) 1px, transparent 1px),
    linear-gradient(90deg, var(--line) 1px, transparent 1px);
  background-size: 26px 26px;
  background-position: center;
}

.bp-scene > svg {
  display: block;
  width: 100%;
  height: 100%;
}

.bp-walls {
  filter: drop-shadow(0 0 6px var(--glow));
}

.bp-label {
  fill: var(--text-strong);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.bp-sub {
  fill: var(--muted);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.bp-dim {
  fill: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
}

.bp-chip {
  fill: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.18em;
}
</style>