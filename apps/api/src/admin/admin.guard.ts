import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { UsersService } from '../users/users.service'

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: { id: string } }>()
    const user = request.user?.id ? await this.users.findById(request.user.id) : null
    if (!user || user.role !== 'admin') throw new ForbiddenException({ code: 'ADMIN_REQUIRED', message: '需要管理员权限' })
    return true
  }
}
