import { AssetsService } from './assets.service'

describe('AssetsService', () => {
  it('returns enabled categories in configured order', async () => {
    const categories = { find: jest.fn().mockResolvedValue([]) }
    const assets = { find: jest.fn(), countBy: jest.fn() }
    const service = new AssetsService(categories as never, assets as never)

    await service.listCategories()
    expect(categories.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true }, order: { sortOrder: 'ASC', name: 'ASC' } }),
    )
  })

  it('applies category and trimmed keyword filters', async () => {
    const categories = { find: jest.fn() }
    const assets = { find: jest.fn().mockResolvedValue([]), countBy: jest.fn() }
    const service = new AssetsService(categories as never, assets as never)

    await service.listAssets({ categoryId: 'b1111111-1111-4111-8111-111111111111', keyword: ' 沙发 ' })
    expect(assets.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          enabled: true,
          categoryId: 'b1111111-1111-4111-8111-111111111111',
        }),
      }),
    )
  })

  it('requires every referenced asset to be enabled', async () => {
    const categories = { find: jest.fn() }
    const assets = { find: jest.fn(), countBy: jest.fn().mockResolvedValue(1) }
    const service = new AssetsService(categories as never, assets as never)

    await expect(service.areEnabledAssetIds(['a', 'a'])).resolves.toBe(true)
    await expect(service.areEnabledAssetIds(['a', 'b'])).resolves.toBe(false)
    await expect(service.areEnabledAssetIds([])).resolves.toBe(true)
  })
})
