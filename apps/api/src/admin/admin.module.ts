import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Plan } from '../plans/plan.entity'
import { PlanLike } from '../plans/plan-like.entity'
import { UsersModule } from '../users/users.module'
import { User } from '../users/user.entity'
import { AdminController } from './admin.controller'
import { AdminGuard } from './admin.guard'
import { AdminService } from './admin.service'

@Module({
  imports: [TypeOrmModule.forFeature([User, Plan, PlanLike]), UsersModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
