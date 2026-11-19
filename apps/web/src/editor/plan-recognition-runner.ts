/**
 * 识别调度层：优先在 Web Worker 里跑，跑不动时退回主线程。
 *
 * 为什么必须走 Worker：一张真实户型图（1400px 长边、带纹理/文字/家具底色）
 * 二值化后可能有几千条候选线段，纯计算部分几百毫秒到几秒不等。
 * 放在主线程上 el-dialog 连 loading 动画都不转，浏览器直接弹
 * "此页面没有响应"，用户只能强退。
 */
import {
  recognizeFloorplan,
  type GrayImage,
  type RecognizeOptions,
  type RecognizedFloorplan,
} from './plan-recognition'
import type { RecognizeRequest, RecognizeResponse } from './plan-recognition.worker'

/** 单次识别的等待上限：超时说明这张图对当前算法来说太复杂，直接放弃而不是无限等。 */
const RECOGNIZE_TIMEOUT_MS = 30_000

/** 在途任务的中止函数：换成新图或关对话框时要让旧任务立刻停手。 */
let abortActive: (() => void) | null = null

/** 取消在途识别（换图 / 关对话框 / 改参数时调用），避免旧任务继续烧 CPU。 */
export function cancelRecognition(): void {
  const abort = abortActive
  abortActive = null
  abort?.()
}

/**
 * 在 Worker 里识别。
 *
 * 灰度图**不做 transfer**（而是结构化克隆）：参数改动会重新识别同一张图，
 * 主线程上这份 `gray.data` 必须还能再用，transfer 会把它 detach 掉。
 * 1400x1400 的灰度图约 2MB，克隆一次在 1ms 量级，可以忽略。
 */
export function recognizeFloorplanAsync(
  gray: GrayImage,
  options: RecognizeOptions,
): Promise<RecognizedFloorplan> {
  cancelRecognition()

  if (typeof Worker === 'undefined') {
    return Promise.resolve(recognizeFloorplan(gray, options))
  }

  let worker: Worker
  try {
    worker = new Worker(new URL('./plan-recognition.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    // 构建环境不支持 module worker（或浏览器太老）：退回主线程，至少结果是对的。
    return Promise.resolve(recognizeFloorplan(gray, options))
  }

  return new Promise<RecognizedFloorplan>((resolve, reject) => {
    let finished = false
    const finish = (run: () => void): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      worker.terminate()
      if (abortActive === abort) abortActive = null
      run()
    }
    const abort = (): void => finish(() => reject(new Error('识别已取消。')))

    const timer = setTimeout(() => {
      finish(() =>
        reject(new Error('识别超时了：这张图对当前的识别算法来说太复杂，请换一张更清晰的户型图。')),
      )
    }, RECOGNIZE_TIMEOUT_MS)

    worker.onmessage = (event: MessageEvent<RecognizeResponse>) => {
      const response = event.data
      if (response.ok) finish(() => resolve(response.result))
      else finish(() => reject(new Error(response.message)))
    }

    worker.onerror = () => {
      // Worker 起不来（CSP / 打包路径问题）时退回主线程，别让用户看到白屏。
      finish(() => resolve(recognizeFloorplan(gray, options)))
    }

    abortActive = abort
    const request: RecognizeRequest = { id: 1, gray: plainGray(gray), options: { ...options } }
    worker.postMessage(request)
  })
}

/**
 * 把调用方传进来的灰度图转成可以结构化克隆的纯对象。
 *
 * 调用方（Vue 组件）常常把图存在 `ref` 里，拿到的是响应式代理，
 * 代理对象直接 `postMessage` 会报
 * "Failed to execute 'postMessage' on 'Worker': #<Object> could not be cloned."。
 */
function plainGray(gray: GrayImage): GrayImage {
  return {
    width: gray.width,
    height: gray.height,
    data: Uint8Array.from(gray.data),
  }
}