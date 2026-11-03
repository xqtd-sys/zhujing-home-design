import { toRaw } from 'vue'

// Plan documents contain plain objects and arrays. Points read from refs or
// snapped to existing geometry can still be proxies inside an otherwise raw document.
function unwrapDocument(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  const raw = toRaw(value)
  if (Array.isArray(raw)) return raw.map(unwrapDocument)
  if (Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null) {
    return Object.fromEntries(Object.entries(raw).map(([key, item]) => [key, unwrapDocument(item)]))
  }
  return raw
}

export function cloneReactive<T extends object>(value: T): T {
  return structuredClone(unwrapDocument(value)) as T
}
