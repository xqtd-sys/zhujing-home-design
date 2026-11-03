import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Like, Repository } from 'typeorm'
import { ListFurnitureAssetsDto } from './dto/list-furniture-assets.dto'
import { FurnitureAsset } from './furniture-asset.entity'
import { FurnitureCategory } from './furniture-category.entity'

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(FurnitureCategory) private readonly categories: Repository<FurnitureCategory>,
    @InjectRepository(FurnitureAsset) private readonly assets: Repository<FurnitureAsset>,
  ) {}

  listCategories() {
    return this.categories.find({
      where: { enabled: true },
      select: { id: true, name: true, sortOrder: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    })
  }

  listAssets(query: ListFurnitureAssetsDto) {
    return this.assets.find({
      where: {
        enabled: true,
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.keyword?.trim() ? { name: Like(`%${query.keyword.trim()}%`) } : {}),
      },
      select: {
        id: true,
        categoryId: true,
        name: true,
        iconUrl: true,
        modelUrl: true,
        primitiveType: true,
        baseWidth: true,
        baseDepth: true,
        baseHeight: true,
        defaultColor: true,
        sortOrder: true,
      },
      order: { sortOrder: 'ASC', name: 'ASC' },
    })
  }

  async areEnabledAssetIds(assetIds: string[]) {
    const uniqueIds = [...new Set(assetIds)]
    if (uniqueIds.length === 0) return true
    return (await this.assets.countBy({ id: In(uniqueIds), enabled: true })) === uniqueIds.length
  }
}
