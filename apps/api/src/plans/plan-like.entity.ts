import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm'
import { Plan } from './plan.entity'
import { User } from '../users/user.entity'

@Entity('plan_likes')
@Unique('UQ_plan_likes_plan_user', ['planId', 'userId'])
@Index('IDX_plan_likes_plan', ['planId'])
export class PlanLike {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string

  @ManyToOne(() => Plan, (plan) => plan.likes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan!: Plan

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date
}
