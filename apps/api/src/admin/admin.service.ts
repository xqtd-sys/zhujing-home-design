import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, Repository } from 'typeorm'
import { Plan } from '../plans/plan.entity'
import { User } from '../users/user.entity'
import { PlanLike } from '../plans/plan-like.entity'

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(PlanLike) private readonly likes: Repository<PlanLike>,
  ) {}

  async overview() {
    const [userCount, planCount, publicPlanCount, likeCount, recentUsers, popularPlans] = await Promise.all([
      this.users.count(),
      this.plans.count({ where: { deletedAt: IsNull() } }),
      this.plans.count({ where: { isPublic: true, deletedAt: IsNull() } }),
      this.likes.count(),
      this.users.find({
        select: { id: true, username: true, nickname: true, email: true, role: true, status: true, createdAt: true },
        order: { createdAt: 'DESC' },
        take: 6,
      }),
      this.plans
        .createQueryBuilder('plan')
        .leftJoin('plan.likes', 'like')
        .leftJoin('plan.owner', 'owner')
        .where('plan.is_public = :isPublic AND plan.deleted_at IS NULL', { isPublic: true })
        .select('plan.id', 'id')
        .addSelect('plan.name', 'name')
        .addSelect('owner.username', 'username')
        .addSelect('owner.nickname', 'nickname')
        .addSelect('COUNT(like.id)', 'likeCount')
        .groupBy('plan.id')
        .addGroupBy('plan.name')
        .addGroupBy('owner.username')
        .addGroupBy('owner.nickname')
        .orderBy('likeCount', 'DESC')
        .addOrderBy('plan.updatedAt', 'DESC')
        .limit(5)
        .getRawMany(),
    ])
    return {
      userCount,
      planCount,
      publicPlanCount,
      likeCount,
      recentUsers,
      popularPlans: popularPlans.map((plan) => ({ ...plan, likeCount: Number(plan.likeCount) })),
    }
  }

  async listUsers() {
    return this.users.find({
      select: { id: true, username: true, nickname: true, email: true, role: true, status: true, createdAt: true },
      order: { createdAt: 'DESC' },
    })
  }

  async toggleUserStatus(id: string, currentUserId: string) {
    if (id === currentUserId) throw new BadRequestException({ code: 'CANNOT_DISABLE_SELF', message: '不能停用当前管理员账户' })
    const user = await this.users.findOne({ where: { id } })
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: '用户不存在' })
    if (user.role === 'admin') throw new BadRequestException({ code: 'CANNOT_DISABLE_ADMIN', message: '暂不支持停用其他管理员' })
    user.status = user.status === 'active' ? 'disabled' : 'active'
    await this.users.save(user)
    return { id: user.id, status: user.status }
  }
}
