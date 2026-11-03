import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import type { AuthenticatedUser } from '../auth/auth.types'
import { CurrentUser } from '../common/current-user.decorator'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { UsersService } from './users.service'

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: '获取当前用户' })
  getMe(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.users.getRequired(currentUser.id)
  }

  @Patch('me')
  @ApiOperation({ summary: '修改当前用户的昵称和邮箱' })
  updateMe(@CurrentUser() currentUser: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(currentUser.id, dto)
  }

  @Patch('me/password')
  @ApiOperation({ summary: '校验当前密码后修改密码' })
  changePassword(@CurrentUser() currentUser: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.users.changePassword(currentUser.id, dto)
  }
}
