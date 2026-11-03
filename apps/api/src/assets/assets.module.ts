import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AssetsController } from './assets.controller'
import { AssetsService } from './assets.service'
import { FurnitureAsset } from './furniture-asset.entity'
import { FurnitureCategory } from './furniture-category.entity'

@Module({
  imports: [TypeOrmModule.forFeature([FurnitureCategory, FurnitureAsset])],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
