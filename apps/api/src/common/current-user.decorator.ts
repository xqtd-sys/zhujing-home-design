import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { AuthenticatedUser } from '../auth/auth.types'

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedUser => {
  return context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user
})
