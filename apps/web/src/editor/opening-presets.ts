import type { PlanDocument } from '@home-design/plan-schema'

export type OpeningKind = 'door' | 'window'

export type OpeningPreset = {
  id: string
  kind: OpeningKind
  name: string
  width: number
  height: number
  sillHeight: number
}

/** 门的款式 */
export const DOOR_PRESETS: OpeningPreset[] = [
  { id: 'door-single', kind: 'door', name: '单开门', width: 90, height: 210, sillHeight: 0 },
  { id: 'door-double', kind: 'door', name: '双开门', width: 160, height: 210, sillHeight: 0 },
  { id: 'door-sliding', kind: 'door', name: '推拉门', width: 140, height: 210, sillHeight: 0 },
  { id: 'door-folding', kind: 'door', name: '折叠门', width: 110, height: 210, sillHeight: 0 },
]

/** 窗的款式 */
export const WINDOW_PRESETS: OpeningPreset[] = [
  { id: 'window-casement', kind: 'window', name: '平开窗', width: 120, height: 120, sillHeight: 90 },
  { id: 'window-sliding', kind: 'window', name: '推拉窗', width: 150, height: 140, sillHeight: 90 },
  { id: 'window-french', kind: 'window', name: '落地窗', width: 180, height: 240, sillHeight: 0 },
  { id: 'window-bay', kind: 'window', name: '飘窗', width: 200, height: 150, sillHeight: 60 },
]

export function presetsFor(kind: OpeningKind) {
  return kind === 'door' ? DOOR_PRESETS : WINDOW_PRESETS
}

/**
 * 由门窗的尺寸推导“款式”。这样款式无需额外字段：文档里存的是宽/高/窗台，
 * 保存再打开时样式会自动还原（各款式尺寸互不相同，可稳定区分）。
 */
export function openingStyleKey(opening: PlanDocument['openings'][number]): string {
  if (opening.type === 'door') {
    if (opening.width >= 150) return 'door-double'
    if (opening.width >= 130) return 'door-sliding'
    if (opening.width >= 105) return 'door-folding'
    return 'door-single'
  }
  if (opening.sillHeight <= 5 && opening.height >= 200) return 'window-french'
  if (opening.width >= 190) return 'window-bay'
  if (opening.width >= 140) return 'window-sliding'
  return 'window-casement'
}
