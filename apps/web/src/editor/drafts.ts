import { PlanDocumentSchema, type PlanDocument } from '@home-design/plan-schema'

export type PlanDraft = {
  version: 1
  ownerId: string
  planId: string
  baseRevision: number
  savedAt: number
  documentJson: PlanDocument
}

export function draftKey(ownerId: string, planId: string) {
  return `zhujing:draft:v1:${ownerId}:${planId}`
}

export function readDraft(storage: Storage, ownerId: string, planId: string): PlanDraft | null {
  const raw = storage.getItem(draftKey(ownerId, planId))
  if (!raw) return null
  const draft = JSON.parse(raw) as PlanDraft
  if (
    draft.version !== 1 ||
    draft.ownerId !== ownerId ||
    draft.planId !== planId ||
    !Number.isSafeInteger(draft.baseRevision) ||
    draft.baseRevision < 1 ||
    !Number.isFinite(draft.savedAt) ||
    !PlanDocumentSchema.safeParse(draft.documentJson).success
  )
    throw new Error('Invalid local draft')
  return draft
}
