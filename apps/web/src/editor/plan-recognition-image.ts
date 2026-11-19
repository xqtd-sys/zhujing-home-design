/**
 * 识别用的图片采样层：把用户选的图片文件变成 plan-recognition 需要的灰度图。
 *
 * 这一层是唯一碰 DOM / Canvas 的地方，识别算法本身在 plan-recognition.ts 里，
 * 保持纯计算以便单测。采样时会把大图等比缩小，既省内存也顺手压掉扫描噪点。
 */
import { rgbaToGray, type GrayImage } from './plan-recognition'

/** 采样后最长边的像素上限：太大只会拖慢识别，且原图的扫描噪点会变多。 */
export const MAX_SAMPLE_SIDE = 1400

/** 铺到画布上的参考底图（cm 坐标），与 EditorView 的 PlanBackground 同构。 */
export type PlanBackgroundPatch = { src: string; x: number; y: number; width: number; height: number; opacity: number }

export type SampledImage = {
  gray: GrayImage
  /** 原始图片尺寸（像素）。 */
  naturalWidth: number
  naturalHeight: number
  /** 采样用的缩放比例（sample / natural）。 */
  ratio: number
  /** 采样后的 dataURL，可直接当参考底图铺在画布上。 */
  dataUrl: string
}

/** 从 File 读成 dataURL（本地文件，不联网）。 */
export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败，请重试。'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
}

/** 把 dataURL 解码成 Image 元素（等待 decode 完成）。 */
export function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('这张图片无法解码，请换一张 PNG 或 JPG。'))
    image.src = src
  })
}

/**
 * 等比缩放到最长边不超过 maxSide，再取灰度。
 * 返回的 dataUrl 是**采样后**的图，和灰度图逐像素对齐，便于预览叠加。
 */
export function sampleImage(image: HTMLImageElement, maxSide = MAX_SAMPLE_SIDE): SampledImage {
  const naturalWidth = image.naturalWidth || image.width
  const naturalHeight = image.naturalHeight || image.height
  if (!naturalWidth || !naturalHeight) throw new Error('这张图片没有有效的像素尺寸。')

  const ratio = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight))
  const width = Math.max(1, Math.round(naturalWidth * ratio))
  const height = Math.max(1, Math.round(naturalHeight * ratio))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前浏览器不支持 Canvas 2D，无法识别图片。')

  // 先铺白底：带透明通道的 PNG 才不会把透明区当成墨迹。
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  const pixels = context.getImageData(0, 0, width, height).data
  return {
    gray: rgbaToGray(pixels, width, height),
    naturalWidth,
    naturalHeight,
    ratio,
    // 这张图会存进 localStorage（约 5MB 配额）：线稿用 PNG 又小又清晰，
    // 照片类原图 PNG 会很大，超过阈值就退回 JPEG 压一档。
    dataUrl: encodeBackground(canvas),
  }
}

/** 参考底图的 dataURL：PNG 优先，太大时降级成 JPEG。 */
function encodeBackground(canvas: HTMLCanvasElement): string {
  const png = canvas.toDataURL('image/png')
  if (png.length <= 900_000) return png
  return canvas.toDataURL('image/jpeg', 0.88)
}
