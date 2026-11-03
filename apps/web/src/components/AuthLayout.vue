<script setup lang="ts">
import RoomIllustration from './RoomIllustration.vue'
import BrandMark from './BrandMark.vue'
</script>

<template>
  <main class="auth-page">
    <section class="auth-story">
      <div class="auth-wordmark">
        <BrandMark /><span>筑建设计平台</span>
      </div>
      <div class="auth-story-copy">
        <p class="eyebrow">把想象变成真实的空间</p>
        <h2>理想的家，<br />从你的想象开始。</h2>
        <p>画下空间，摆放生活。<br />让每一个关于家的想法，都看得见。</p>
      </div>
      <RoomIllustration class="auth-scene" />
      <div class="auth-story-footer">
        <span>01 / 绘制户型</span><span>02 / 布置空间</span><span>03 / 预览新家</span>
      </div>
    </section>
    <section class="auth-form-side">
      <div class="auth-panel">
        <p class="eyebrow">筑境设计平台</p>
        <slot />
      </div>
      <p class="auth-footnote">把生活的样子，设计成喜欢的样子。</p>
    </section>
  </main>
</template>
