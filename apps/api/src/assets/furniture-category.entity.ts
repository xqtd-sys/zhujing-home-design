import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm'
import { FurnitureAsset } from './furniture-asset.entity'

@Entity('furniture_categories')
export class FurnitureCategory {
  @PrimaryColumn('uuid')
  id!: string

  @Column({ length: 64 })
  name!: string

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number

  @Column({ type: 'boolean', default: true })
  enabled!: boolean

  @OneToMany(() => FurnitureAsset, (asset) => asset.category)
  assets!: FurnitureAsset[]
}
