import type { PlanDocument } from '@home-design/plan-schema'
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { User } from '../users/user.entity'
import { PlanLike } from './plan-like.entity'

@Entity('plans')
@Index('IDX_plans_owner_updated', ['ownerId', 'updatedAt'])
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string

  @ManyToOne(() => User, (user) => user.plans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner!: User

  @OneToMany(() => PlanLike, (like) => like.plan)
  likes!: PlanLike[]

  @Column({ length: 100 })
  name!: string

  @Column({ name: 'document_json', type: 'json' })
  documentJson!: PlanDocument

  @Column({ name: 'schema_version', type: 'int', unsigned: true, default: 1 })
  schemaVersion!: number

  @Column({ type: 'int', unsigned: true, default: 1 })
  revision!: number

  @Column({ name: 'thumbnail_url', type: 'varchar', length: 500, nullable: true })
  thumbnailUrl!: string | null

  @Column({ name: 'is_public', type: 'boolean', default: false })
  isPublic!: boolean

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date

  @DeleteDateColumn({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt!: Date | null
}
