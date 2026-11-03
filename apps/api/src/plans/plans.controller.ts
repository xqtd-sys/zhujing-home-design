import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import type { AuthenticatedUser } from '../auth/auth.types'
import { CurrentUser } from '../common/current-user.decorator'
import { CreatePlanDto } from './dto/create-plan.dto'
import { ImportPlanDto } from './dto/import-plan.dto'
import { ListPlansDto } from './dto/list-plans.dto'
import { RenamePlanDto } from './dto/rename-plan.dto'
import { UpdatePlanDto } from './dto/update-plan.dto'
import { UpdatePlanVisibilityDto } from './dto/update-plan-visibility.dto'
import { PlansService } from './plans.service'

@ApiTags('Plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Post()
  @ApiOperation({ summary: '创建空白方案，初始 revision 为 1' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePlanDto) {
    return this.plans.create(user.id, dto)
  }

  @Post('import')
  @ApiOperation({ summary: '粘贴并创建方案副本' })
  importPlan(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportPlanDto) {
    return this.plans.importPlan(user.id, dto)
  }

  @Get()
  @ApiOperation({ summary: '获取当前用户的方案列表' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPlansDto) {
    return this.plans.list(user.id, query)
  }

  @Patch(':id/visibility')
  @ApiOperation({ summary: '公开或取消公开当前方案' })
  updateVisibility(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanVisibilityDto,
  ) {
    return this.plans.updateVisibility(user.id, id, dto.isPublic)
  }

  @Get(':id')
  @ApiOperation({ summary: '获取完整方案' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.plans.get(user.id, id)
  }

  @Put(':id')
  @ApiOperation({ summary: '使用 expectedRevision 保存完整方案' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto) {
    return this.plans.update(user.id, id, dto.expectedRevision, dto.documentJson)
  }

  @Patch(':id/name')
  @ApiOperation({ summary: '重命名方案' })
  rename(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenamePlanDto) {
    return this.plans.rename(user.id, id, dto.name)
  }

  @Delete(':id')
  @ApiOperation({ summary: '软删除方案' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.plans.remove(user.id, id)
  }
}
