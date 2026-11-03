import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import type { AuthenticatedUser } from '../auth/auth.types'
import { CurrentUser } from '../common/current-user.decorator'
import { ListPlansDto } from './dto/list-plans.dto'
import { PlansService } from './plans.service'

@ApiTags('Discover')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('discover/plans')
export class DiscoverController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @ApiOperation({ summary: '获取发现页公开方案列表' })
  list(@Query() query: ListPlansDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plans.listDiscover(query, user.id)
  }

  @Get(':id')
  @ApiOperation({ summary: '只读查看公开方案' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plans.getDiscover(id, user.id)
  }

  @Post(':id/copy')
  @ApiOperation({ summary: '复制公开方案到当前用户的设计' })
  copy(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.plans.copyPublic(user.id, id)
  }

  @Post(':id/like')
  @ApiOperation({ summary: '点赞或取消点赞公开方案' })
  like(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.plans.toggleLike(user.id, id)
  }
}
