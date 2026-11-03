import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { IsNull } from 'typeorm'
import { EMPTY_PLAN_DOCUMENT } from '@home-design/plan-schema'
import { PlansService } from './plans.service'

describe('PlansService', () => {
  it('renames without overwriting a concurrent document save or its revision', async () => {
    const initial = {
      id: '11111111-1111-4111-8111-111111111111',
      ownerId: 'owner',
      name: 'original',
      revision: 1,
      schemaVersion: 1,
      documentJson: structuredClone(EMPTY_PLAN_DOCUMENT),
    }
    const current = structuredClone(initial)
    const savedDocument = structuredClone(EMPTY_PLAN_DOCUMENT)
    savedDocument.walls.push({
      id: '22222222-2222-4222-8222-222222222222',
      start: { x: 0, y: 0 },
      end: { x: 300, y: 0 },
      thickness: 20,
      height: 280,
    })
    const concurrentSave = () => {
      current.documentJson = savedDocument
      current.revision = 2
    }
    const repository = {
      findOne: jest.fn(async () => structuredClone(current)),
      update: jest.fn(async (_criteria, patch) => {
        concurrentSave()
        Object.assign(current, patch)
        return { affected: 1 }
      }),
      save: jest.fn(async (stale) => {
        concurrentSave()
        Object.assign(current, stale)
        return structuredClone(current)
      }),
    }
    const result = await new PlansService(repository as never, {} as never).rename('owner', initial.id, ' new name ')
    expect(result.name).toBe('new name')
    expect(result.revision).toBe(2)
    expect(result.documentJson).toEqual(savedDocument)
    expect(repository.update).toHaveBeenCalledWith(
      { id: initial.id, ownerId: 'owner', deletedAt: IsNull() },
      { name: 'new name' },
    )
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('cannot rename a deleted or another user’s plan', async () => {
    const repository = { update: jest.fn().mockResolvedValue({ affected: 0 }), findOne: jest.fn() }
    const service = new PlansService(repository as never, {} as never)
    await expect(service.rename('owner', 'plan-id', 'new name')).rejects.toBeInstanceOf(NotFoundException)
    expect(repository.findOne).not.toHaveBeenCalled()
  })

  it('returns a conflict when an atomic revision update affects no row', async () => {
    const plan = {
      id: '11111111-1111-4111-8111-111111111111',
      ownerId: 'owner',
      name: 'plan',
      revision: 2,
      schemaVersion: 1,
      documentJson: EMPTY_PLAN_DOCUMENT,
    }
    const execute = jest.fn().mockResolvedValue({ affected: 0 })
    const builder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute,
    }
    const repository = {
      findOne: jest.fn().mockResolvedValue(plan),
      createQueryBuilder: jest.fn(() => builder),
    }
    const assets = { areEnabledAssetIds: jest.fn().mockResolvedValue(true) }
    const service = new PlansService(repository as never, assets as never)
    await expect(service.update('owner', plan.id, 1, EMPTY_PLAN_DOCUMENT)).rejects.toBeInstanceOf(ConflictException)
  })

  it('rejects a plan that references a disabled or missing furniture asset', async () => {
    const plan = {
      id: '11111111-1111-4111-8111-111111111111',
      ownerId: 'owner',
      name: 'plan',
      revision: 1,
      schemaVersion: 1,
      documentJson: EMPTY_PLAN_DOCUMENT,
    }
    const repository = { findOne: jest.fn().mockResolvedValue(plan), createQueryBuilder: jest.fn() }
    const assets = { areEnabledAssetIds: jest.fn().mockResolvedValue(false) }
    const service = new PlansService(repository as never, assets as never)
    const document = {
      ...EMPTY_PLAN_DOCUMENT,
      furniture: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          assetId: '33333333-3333-4333-8333-333333333333',
          position: { x: 0, y: 0 },
          rotation: 0,
          width: 100,
          depth: 50,
          height: 50,
          locked: false,
          zIndex: 1,
        },
      ],
    }

    await expect(service.update('owner', plan.id, 1, document)).rejects.toBeInstanceOf(BadRequestException)
    expect(repository.createQueryBuilder).not.toHaveBeenCalled()
  })
})
