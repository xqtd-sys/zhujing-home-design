import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import type { AuthenticatedUser } from '../auth/auth.types'
import { CurrentUser } from '../common/current-user.decorator'
import { AdminGuard } from './admin.guard'
import { AdminService } from './admin.service'

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  @ApiOperation({ summary: '获取管理员工作台概览' })
  overview() {
    return this.admin.overview()
  }

  @Get('users')
  @ApiOperation({ summary: '获取用户列表' })
  users() {
    return this.admin.listUsers()
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: '启用或停用普通用户' })
  toggleStatus(@Param('id') id: string, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.admin.toggleUserStatus(id, currentUser.id)
  }
}
