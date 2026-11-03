import type { PlanDocument } from '@home-design/plan-schema'

const CLIPBOARD_KEY = 'home-design:design-clipboard:v1'

export type DesignClipboard = {
  sourceName: string
  documentJson: PlanDocument
  copiedAt: number
}

export function writeDesignClipboard(value: DesignClipboard) {
  localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(value))
}

export function readDesignClipboard(): DesignClipboard | null {
  try {
    const raw = localStorage.getItem(CLIPBOARD_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as DesignClipboard
    if (!value || typeof value.sourceName !== 'string' || !value.documentJson || typeof value.copiedAt !== 'number') {
      return null
    }
    return value
  } catch {
    return null
  }
}

export function clearDesignClipboard() {
  localStorage.removeItem(CLIPBOARD_KEY)
}
