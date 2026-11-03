import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AssetsService } from './assets.service'
import { ListFurnitureAssetsDto } from './dto/list-furniture-assets.dto'

@ApiTags('Assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get('furniture-categories')
  @ApiOperation({ summary: '获取启用的家具分类' })
  listCategories() {
    return this.assets.listCategories()
  }

  @Get('furniture-assets')
  @ApiOperation({ summary: '按分类或关键词获取启用的家具素材' })
  listAssets(@Query() query: ListFurnitureAssetsDto) {
    return this.assets.listAssets(query)
  }
}
