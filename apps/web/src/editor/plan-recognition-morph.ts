/**
 * 形态学与连通域基础操作（纯函数，不碰 DOM，方便在 Web Worker 里跑）。
 *
 * 这里集中放"腐蚀 / 膨胀 / 开运算 / 闭运算 / 去小连通域"这类最底层的掩膜操作。
 * 之所以单独成文件：预处理模块（CLAHE、摆正、多策略去噪打分）需要复用它们，
 * 拆开后依赖方向是单向的（plan-recognition.ts → 本文件），不会出现循环引用。
 *
 * 复杂度统一控制在 O(宽*高*radius)，可分离实现（先横向再纵向）。
 * 半径一般 1–4，1400×1000 的图几毫秒以内。
 */
import type { GrayImage, InkMask } from './plan-recognition.ts'

/** 统计墨迹像素数量。 */
export function countInk(mask: InkMask): number {
  let count = 0
  for (let index = 0; index < mask.data.length; index += 1) if (mask.data[index]) count += 1
  return count
}

/**
 * 可分离腐蚀：radius 邻域内只要有一个非墨迹像素，就把当前像素置 0。
 * 边界外一律视为 0（所以图像边缘会被"腐蚀"掉一圈），与原 openMask 行为一致。
 */
export function erodeMask(mask: InkMask, radius: number): InkMask {
  if (radius <= 0) return mask
  const { width, height, data } = mask
  const erodeRow = new Uint8Array(width * height)
  const erode = new Uint8Array(width * height)
  // 横向腐蚀
  for (let y = 0; y < height; y += 1) {
    const rowBase = y * width
    for (let x = 0; x < width; x += 1) {
      let value = 1
      if (x - radius < 0 || x + radius >= width) {
        value = 0
      } else {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (!data[rowBase + x + dx]) {
            value = 0
            break
          }
        }
      }
      erodeRow[rowBase + x] = value
    }
  }
  // 纵向腐蚀
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 1
      if (y - radius < 0 || y + radius >= height) {
        value = 0
      } else {
        for (let dy = -radius; dy <= radius; dy += 1) {
          if (!erodeRow[(y + dy) * width + x]) {
            value = 0
            break
          }
        }
      }
      erode[y * width + x] = value
    }
  }
  return { width, height, data: erode }
}

/** 可分离膨胀：radius 邻域内只要有一个墨迹像素，当前像素就置 1（不向边界外扩张）。 */
export function dilateMask(mask: InkMask, radius: number): InkMask {
  if (radius <= 0) return mask
  const { width, height, data } = mask
  const dilateRow = new Uint8Array(width * height)
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const rowBase = y * width
    for (let x = 0; x < width; x += 1) {
      if (!data[rowBase + x]) continue
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = x + dx
        if (nx >= 0 && nx < width) dilateRow[rowBase + nx] = 1
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!dilateRow[y * width + x]) continue
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy
        if (ny >= 0 && ny < height) out[ny * width + x] = 1
      }
    }
  }
  return { width, height, data: out }
}

/**
 * 形态学开运算（先腐蚀后膨胀），把比 (2*radius+1) 还细的结构整条抹掉。
 *
 * 真实户型图里，墙是最粗的深色结构；家具轮廓、红色标注线、尺寸线、文字笔画
 * 通常只有 1–3px，开运算一过就全消失，只剩墙。这是把"70 面墙"降回正常的
 * 关键一步。
 */
export function openMask(mask: InkMask, radius: number): InkMask {
  if (radius <= 0) return mask
  return dilateMask(erodeMask(mask, radius), radius)
}

/**
 * 形态学闭运算（先膨胀后腐蚀），把细小的断口/缝隙补上。
 * 用于"墙线中间有个几像素的缺口"这种场景，比单纯膨胀更不容易把墙变胖。
 */
export function closeMask(mask: InkMask, radius: number): InkMask {
  if (radius <= 0) return mask
  return erodeMask(dilateMask(mask, radius), radius)
}

/**
 * 去掉面积小于 minArea 的连通域（把外圈噪声、内部碎块清掉）。
 *
 * 用栈式泛洪 + 紧凑数组代替递归，避免大图爆栈；4/8 邻可切换。
 * 与 findRegions 不同，这里只关心"这块墨迹够不够大"，不做外框判定。
 */
export function removeSmallComponents(mask: InkMask, minArea: number, connectivity: 4 | 8 = 8): InkMask {
  const { width, height, data } = mask
  if (minArea <= 1) return mask
  const labels = new Int32Array(width * height).fill(-1)
  const out = new Uint8Array(width * height)
  const stack: number[] = []
  const component: number[] = []
  const dxs = connectivity === 8 ? [-1, 0, 1, -1, 1, -1, 0, 1] : [0, -1, 1, 0]
  const dys = connectivity === 8 ? [-1, -1, -1, 0, 0, 1, 1, 1] : [-1, 0, 0, 1]
  let nextLabel = 0
  for (let start = 0; start < data.length; start += 1) {
    if (!data[start] || labels[start] !== -1) continue
    component.length = 0
    stack.length = 0
    stack.push(start)
    labels[start] = nextLabel
    while (stack.length > 0) {
      const index = stack.pop() as number
      component.push(index)
      const x = index % width
      const y = (index - x) / width
      for (let k = 0; k < dxs.length; k += 1) {
        const tx = x + dxs[k]
        const ty = y + dys[k]
        if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue
        const next = ty * width + tx
        if (!data[next] || labels[next] !== -1) continue
        labels[next] = nextLabel
        stack.push(next)
      }
    }
    const keep = component.length >= minArea
    for (const index of component) out[index] = keep ? 1 : 0
    nextLabel += 1
  }
  return { width, height, data: out }
}

/** 把灰度图降采样成最长边不超过 maxSide 的缩略图（盒式平均），用于摆正角度估计。 */
export function downsampleGray(gray: GrayImage, maxSide: number): GrayImage {
  const scale = Math.min(1, maxSide / Math.max(gray.width, gray.height))
  const width = Math.max(1, Math.round(gray.width * scale))
  const height = Math.max(1, Math.round(gray.height * scale))
  if (width === gray.width && height === gray.height) return gray
  const out = new Uint8Array(width * height)
  const cellW = gray.width / width
  const cellH = gray.height / height
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * cellH)
    const y1 = Math.min(gray.height, Math.ceil((y + 1) * cellH))
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * cellW)
      const x1 = Math.min(gray.width, Math.ceil((x + 1) * cellW))
      let sum = 0
      let count = 0
      for (let sy = y0; sy < y1; sy += 1) {
        const base = sy * gray.width
        for (let sx = x0; sx < x1; sx += 1) {
          sum += gray.data[base + sx]
          count += 1
        }
      }
      out[y * width + x] = count > 0 ? Math.round(sum / count) : 255
    }
  }
  return { width, height, data: out }
}
