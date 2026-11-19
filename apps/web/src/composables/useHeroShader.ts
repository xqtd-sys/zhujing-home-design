import { onBeforeUnmount, onMounted, watch } from 'vue'
import type { Ref } from 'vue'
import type { ThemeMode } from './useThemeMode'

const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'

const FRAG = `
  precision highp float;
  uniform vec2 uRes;
  uniform float uTime;
  uniform vec2 uPtr;
  uniform vec3 uAccentA;   // 主色
  uniform vec3 uAccentB;   // 副色
  uniform vec3 uBaseA;     // 底色
  uniform vec3 uBaseB;     // 底色 2
  uniform float uExposure; // 整体曝光
  uniform float uBeam;     // 日光束强度：夜里 0，白天 1
  uniform float uGrain;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++){ v += a * noise(p); p = rot * p * 2.03; a *= 0.5; }
    return v;
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
    vec2 p = uv * 0.95;
    float t = uTime * 0.045;

    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3 - t)));
    vec2 r = vec2(fbm(p + 2.2 * q + vec2(1.7, 9.2) + 0.16 * t),
                  fbm(p + 2.2 * q + vec2(8.3, 2.8) - 0.13 * t));
    float f = fbm(p + 2.0 * r + uPtr * 0.42);

    vec3 col = mix(uBaseA, uAccentA, smoothstep(0.10, 0.86, f) * 0.9);
    col = mix(col, uAccentB, smoothstep(0.26, 0.96, r.x) * 0.75);
    col = mix(col, uBaseB, smoothstep(0.52, 1.02, q.y) * 0.5);

    float band = pow(smoothstep(0.32, 0.94, f), 2.0);
    col += uAccentA * band * 0.9;

    float sweep = exp(-pow((uv.x + uPtr.x * 0.25 - sin(uTime * 0.055) * 0.75) * 1.9, 2.0));
    col += mix(uAccentA, uAccentB, 0.35) * sweep * (0.30 + 0.60 * band);

    /* 日光束：斜向的百叶窗光，缓慢扫过；夜里这一项几乎为零 */
    if (uBeam > 0.001) {
      float ang = 0.62;
      float d = (uv.x * cos(ang) + uv.y * sin(ang));
      float bars = 0.5 + 0.5 * sin(d * 4.6 + sin(uTime * 0.18) * 0.5);
      bars = pow(bars, 1.7);
      float mask = smoothstep(1.05, -0.35, length(uv * vec2(0.55, 0.85)));
      col += uAccentA * bars * mask * uBeam * 0.55;
      /* 远处一团暖光，像窗 */
      vec2 lp = uv - vec2(0.50 + sin(uTime * 0.05) * 0.06, 0.26);
      float halo = exp(-dot(lp * vec2(1.0, 1.2), lp * vec2(1.0, 1.2)) * 3.6);
      col += mix(uAccentA, uAccentB, 0.45) * halo * uBeam * 0.75;
    }

    col *= uExposure;

    float vig = smoothstep(1.55, 0.10, length(uv * vec2(0.86, 1.0)));
    col *= mix(0.75, 1.0, vig);

    col += (hash(gl_FragCoord.xy + uTime) - 0.5) * uGrain;

    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`

type Palette = {
  accentA: number[]
  accentB: number[]
  baseA: number[]
  baseB: number[]
  exposure: number
  beam: number
  grain: number
}

const PALETTE: Record<ThemeMode, Palette> = {
  night: {
    accentA: [0.1, 0.55, 0.52],
    accentB: [0.62, 0.16, 0.5],
    baseA: [0.018, 0.024, 0.042],
    baseB: [0.3, 0.13, 0.62],
    exposure: 1.35,
    beam: 0,
    grain: 0.03,
  },
  day: {
    accentA: [0.31, 0.72, 0.94],
    accentB: [0.55, 0.55, 0.94],
    baseA: [0.965, 0.976, 0.988],
    baseB: [0.905, 0.933, 0.968],
    exposure: 1,
    beam: 1,
    grain: 0.012,
  },
}

function lerpPalette(from: Palette, to: Palette, t: number): Palette {
  const mix = (a: number, b: number) => a + (b - a) * t
  return {
    accentA: from.accentA.map((v, i) => mix(v, to.accentA[i])),
    accentB: from.accentB.map((v, i) => mix(v, to.accentB[i])),
    baseA: from.baseA.map((v, i) => mix(v, to.baseA[i])),
    baseB: from.baseB.map((v, i) => mix(v, to.baseB[i])),
    exposure: mix(from.exposure, to.exposure),
    beam: mix(from.beam, to.beam),
    grain: mix(from.grain, to.grain),
  }
}

/**
 * 首页背景的 WebGL 着色器。
 *
 * 和静态页面版本的关键差别：组件会被路由反复挂载/卸载，
 * 所以这里把 raf、事件监听、WebGL 资源全部登记下来，卸载时逐个释放；
 * 另外在 prefers-reduced-motion 下只画一帧静态图，避免无谓耗电。
 */
export function useHeroShader(canvasRef: Ref<HTMLCanvasElement | null>, mode: Ref<ThemeMode>) {
  let gl: WebGLRenderingContext | null = null
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null

  let rafId = 0
  let disposed = false
  let visible = true
  let frameStart = 0

  let palette: Palette = { ...PALETTE[mode.value] }
  let targetPalette: Palette = { ...PALETTE[mode.value] }
  let blendFrom: Palette = palette
  let blendStart = 0

  const pointer = [0, 0]
  const target = [0, 0]
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const uniforms: Record<string, WebGLUniformLocation | null> = {}

  function compile(type: number, source: string) {
    if (!gl) return null
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }
    return shader
  }

  function resize() {
    const canvas = canvasRef.value
    if (!gl || !canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6) * 0.78
    // 用视口尺寸而不是 clientWidth：canvas 是 fixed 全屏，clientWidth 在首帧可能还没稳定
    const cssWidth = canvas.clientWidth || window.innerWidth
    const cssHeight = canvas.clientHeight || window.innerHeight
    const width = Math.max(1, Math.floor(cssWidth * dpr))
    const height = Math.max(1, Math.floor(cssHeight * dpr))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      // 关键：把 CSS 尺寸钉死为布局尺寸，否则缓冲区会被 CSS 拉伸，
      // 画面发虚发灰（这是从静态页面搬进组件后最容易踩的坑）
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      gl.viewport(0, 0, width, height)
    }
    // 每次 resize 都同步分辨率 uniform（尺寸没变也要保证它被设置过）
    gl.uniform2f(uniforms.res, width, height)
  }

  function draw(time: number) {
    if (!gl) return
    pointer[0] += (target[0] - pointer[0]) * 0.05
    pointer[1] += (target[1] - pointer[1]) * 0.05
    gl.uniform1f(uniforms.time, time)
    gl.uniform2f(uniforms.ptr, pointer[0], pointer[1])
    gl.uniform3fv(uniforms.a, palette.accentA)
    gl.uniform3fv(uniforms.b, palette.accentB)
    gl.uniform3fv(uniforms.baseA, palette.baseA)
    gl.uniform3fv(uniforms.baseB, palette.baseB)
    gl.uniform1f(uniforms.exp, palette.exposure)
    gl.uniform1f(uniforms.beam, palette.beam)
    gl.uniform1f(uniforms.grain, palette.grain)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  function loop(now: number) {
    if (disposed) return

    if (targetPalette !== blendFrom && blendStart === 0) {
      blendFrom = palette
      blendStart = now
    }
    if (blendStart) {
      const k = Math.min((now - blendStart) / 800, 1)
      palette = lerpPalette(blendFrom, targetPalette, k * k * (3 - 2 * k))
      if (k >= 1) {
        blendStart = 0
        blendFrom = targetPalette
      }
    }

    if (visible) draw((now - frameStart) / 1000)
    rafId = requestAnimationFrame(loop)
  }

  function onPointerMove(event: PointerEvent) {
    target[0] = (event.clientX / window.innerWidth - 0.5) * 1.6
    target[1] = (event.clientY / window.innerHeight - 0.5) * 1.6
  }

  function onVisibilityChange() {
    visible = !document.hidden
  }

  function onResize() {
    resize()
    if (reduceMotion) draw(12)
  }

  function dispose() {
    disposed = true
    cancelAnimationFrame(rafId)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('visibilitychange', onVisibilityChange)

    if (gl) {
      if (buffer) gl.deleteBuffer(buffer)
      if (program) gl.deleteProgram(program)
      // 主动丢弃上下文，避免来回切路由时累积显存
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    gl = null
    program = null
    buffer = null
  }

  onMounted(() => {
    const canvas = canvasRef.value
    if (!canvas) return

    gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' })
    if (!gl) {
      canvas.style.display = 'none'
      return
    }

    const vs = compile(gl.VERTEX_SHADER, VERT)
    const fs = compile(gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) {
      canvas.style.display = 'none'
      return
    }

    program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.useProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)

    buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    uniforms.res = gl.getUniformLocation(program, 'uRes')
    uniforms.time = gl.getUniformLocation(program, 'uTime')
    uniforms.ptr = gl.getUniformLocation(program, 'uPtr')
    uniforms.a = gl.getUniformLocation(program, 'uAccentA')
    uniforms.b = gl.getUniformLocation(program, 'uAccentB')
    uniforms.baseA = gl.getUniformLocation(program, 'uBaseA')
    uniforms.baseB = gl.getUniformLocation(program, 'uBaseB')
    uniforms.exp = gl.getUniformLocation(program, 'uExposure')
    uniforms.beam = gl.getUniformLocation(program, 'uBeam')
    uniforms.grain = gl.getUniformLocation(program, 'uGrain')

    resize()
    // 组件刚挂载时上一帧可能还没布局完，等一帧后再校正尺寸
    requestAnimationFrame(() => resize())
    window.addEventListener('resize', onResize)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('visibilitychange', onVisibilityChange)

    if (reduceMotion) {
      draw(12)
    } else {
      frameStart = performance.now()
      rafId = requestAnimationFrame(loop)
    }
  })

  // 主题一变就换调色板（0.8s 插值在 loop 里完成）
  watch(mode, (next) => {
    targetPalette = { ...PALETTE[next] }
    if (reduceMotion) {
      palette = targetPalette
      blendStart = 0
      blendFrom = palette
      draw(12)
    }
  })

  onBeforeUnmount(dispose)
}
