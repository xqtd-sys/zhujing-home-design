import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { compare, hash } from 'bcryptjs'
import { Repository } from 'typeorm'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { User } from './user.entity'

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  findById(id: string) {
    return this.users.findOne({ where: { id } })
  }

  findForLogin(identity: string) {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.username = :identity OR user.email = :identity', { identity })
      .getOne()
  }

  create(data: Pick<User, 'username' | 'email' | 'nickname' | 'passwordHash'>) {
    return this.users.save(this.users.create(data))
  }

  async getRequired(id: string) {
    const user = await this.findById(id)
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: '用户不存在' })
    return user
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    await this.getRequired(id)
    try {
      await this.users.update(
        { id },
        {
          nickname: dto.nickname.trim(),
          email: dto.email.trim().toLowerCase(),
        },
      )
    } catch (error) {
      if (this.isDuplicateEntry(error)) {
        throw new ConflictException({ code: 'EMAIL_ALREADY_EXISTS', message: '邮箱已被使用' })
      }
      throw error
    }
    return this.getRequired(id)
  }

  async changePassword(id: string, dto: ChangePasswordDto) {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne()
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: '用户不存在' })
    if (!(await compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException({ code: 'INVALID_CURRENT_PASSWORD', message: '当前密码错误' })
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException({ code: 'PASSWORD_UNCHANGED', message: '新密码不能与当前密码相同' })
    }
    await this.users.update({ id }, { passwordHash: await hash(dto.newPassword, 12) })
    return { updated: true }
  }

  private isDuplicateEntry(error: unknown) {
    if (typeof error !== 'object' || error === null) return false
    if ('code' in error && error.code === 'ER_DUP_ENTRY') return true
    if (!('driverError' in error) || typeof error.driverError !== 'object' || error.driverError === null) return false
    return 'code' in error.driverError && error.driverError.code === 'ER_DUP_ENTRY'
  }
}
