import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { compare, hash } from 'bcryptjs'
import { UsersService } from '../users/users.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    try {
      const user = await this.users.create({
        username: dto.username.trim(),
        email: dto.email.trim().toLowerCase(),
        nickname: dto.username.trim(),
        passwordHash: await hash(dto.password, 12),
      })
      return this.createSession(user.id, user.username, user.email, user.nickname, user.role)
    } catch (error) {
      if (this.isDuplicateEntry(error)) {
        throw new ConflictException({ code: 'ACCOUNT_ALREADY_EXISTS', message: '用户名或邮箱已被使用' })
      }
      throw error
    }
  }

  async login(dto: LoginDto) {
    const identity = dto.identity.trim().toLowerCase()
    const user = await this.users.findForLogin(identity)
    if (!user || user.status !== 'active' || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: '用户名、邮箱或密码错误' })
    }
    return this.createSession(user.id, user.username, user.email, user.nickname, user.role)
  }

  private createSession(id: string, username: string, email: string, nickname: string, role: 'user' | 'admin') {
    return {
      accessToken: this.jwt.sign({ sub: id, username, role }),
      user: { id, username, email, nickname, role },
    }
  }

  private isDuplicateEntry(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY'
  }
}
