import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { Plan } from '../plans/plan.entity'

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ length: 32, unique: true })
  username!: string

  @Column({ length: 191, unique: true })
  email!: string

  @Column({ name: 'password_hash', length: 255, select: false })
  passwordHash!: string

  @Column({ length: 64 })
  nickname!: string

  @Column({ length: 16, default: 'active' })
  status!: 'active' | 'disabled'

  @Column({ length: 16, default: 'user' })
  role!: 'user' | 'admin'

  @OneToMany(() => Plan, (plan) => plan.owner)
  plans!: Plan[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date
}
