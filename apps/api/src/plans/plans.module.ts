import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AssetsModule } from '../assets/assets.module'
import { Plan } from './plan.entity'
import { PlanLike } from './plan-like.entity'
import { PlansController } from './plans.controller'
import { DiscoverController } from './discover.controller'
import { PlansService } from './plans.service'

@Module({
  imports: [TypeOrmModule.forFeature([Plan, PlanLike]), AssetsModule],
  controllers: [PlansController, DiscoverController],
  providers: [PlansService],
})
export class PlansModule {}
