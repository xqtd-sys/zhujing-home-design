/**
 * 识别 Worker：把 recognizeFloorplan 的计算搬出主线程。
 *
 * 一张噪点多的图，光二值化 + 线带提取就要几百毫秒；放在主线程上会让
 * el-dialog 的 loading 转圈都不动，浏览器直接弹"此页面没有响应"。
 * 算法本身是纯计算（不碰 DOM），所以可以整体搬进 Worker。
 */
import {
  recognizeFloorplan,
  type GrayImage,
  type RecognizeOptions,
  type RecognizedFloorplan,
} from './plan-recognition'

export type RecognizeRequest = { id: number; gray: GrayImage; options: RecognizeOptions }

export type RecognizeResponse =
  | { id: number; ok: true; result: RecognizedFloorplan }
  | { id: number; ok: false; message: string }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RecognizeRequest>) => void) | null
  postMessage: (message: RecognizeResponse, transfer?: Transferable[]) => void
}

scope.onmessage = (event: MessageEvent<RecognizeRequest>) => {
  const { id, gray, options } = event.data
  try {
    const result = recognizeFloorplan(gray, options)
    scope.postMessage({ id, ok: true, result })
  } catch (error) {
    scope.postMessage({
      id,
      ok: false,
      message: error instanceof Error ? error.message : '识别失败，请换一张图试试',
    })
  }
}