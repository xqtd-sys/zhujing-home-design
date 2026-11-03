<script setup lang="ts">
defineProps<{ name: string; color: string }>()
</script>

<template>
  <svg viewBox="0 0 120 88" fill="none" aria-hidden="true" class="furniture-preview">
    <ellipse cx="60" cy="74" rx="42" ry="6" fill="#243f31" opacity=".08" />
    <g stroke="#536358" stroke-width="1.5" stroke-linejoin="round" :fill="color">
      <template v-if="name.includes('沙发')">
        <path d="M23 43V25q0-5 6-5h62q6 0 6 5v18" />
        <rect x="25" y="40" width="70" height="24" rx="5" />
        <rect x="16" y="36" width="14" height="30" rx="5" />
        <rect x="90" y="36" width="14" height="30" rx="5" />
        <path d="M30 51h60M60 23v27M25 67v6m70-6v6" />
      </template>
      <template v-else-if="name.includes('床')">
        <rect x="25" y="13" width="70" height="41" rx="4" />
        <path d="m25 33-9 31v7h88v-7l-9-31Z" />
        <path d="M18 61h84M23 71v5m74-5v5" />
        <rect x="32" y="27" width="25" height="15" rx="4" fill="#f6f3e9" />
        <rect x="63" y="27" width="25" height="15" rx="4" fill="#f6f3e9" />
        <path d="m21 51 5-7h68l5 7Z" fill="#e5e0cf" />
      </template>
      <template v-else-if="name.includes('桌')">
        <path d="M34 45v27m52-27v27" stroke-width="4" />
        <rect x="13" y="26" width="94" height="25" rx="12" />
        <path d="M24 57v18m72-18v18" />
        <rect x="17" y="52" width="22" height="12" rx="4" fill="#ded9cb" />
        <rect x="81" y="52" width="22" height="12" rx="4" fill="#ded9cb" />
        <ellipse cx="61" cy="37" rx="12" ry="5" fill="#f4efdf" />
      </template>
      <template v-else>
        <rect x="23" y="13" width="74" height="56" rx="3" />
        <path d="M60 14v54M29 69v6m62-6v6" />
        <path d="M53 37v11m14-11v11" stroke="#eee8d8" stroke-width="3" />
      </template>
    </g>
  </svg>
</template>
