import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm'
import { FurnitureCategory } from './furniture-category.entity'

@Entity('furniture_assets')
@Index('IDX_furniture_assets_category_sort', ['categoryId', 'sortOrder'])
export class FurnitureAsset {
  @PrimaryColumn('uuid')
  id!: string

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string

  @ManyToOne(() => FurnitureCategory, (category) => category.assets, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category!: FurnitureCategory

  @Column({ length: 64 })
  name!: string

  @Column({ name: 'icon_url', type: 'varchar', length: 500, nullable: true })
  iconUrl!: string | null

  @Column({ name: 'model_url', type: 'varchar', length: 500, nullable: true })
  modelUrl!: string | null

  @Column({ name: 'primitive_type', type: 'varchar', length: 32, nullable: true })
  primitiveType!: string | null

  @Column({ name: 'base_width', type: 'int', unsigned: true })
  baseWidth!: number

  @Column({ name: 'base_depth', type: 'int', unsigned: true })
  baseDepth!: number

  @Column({ name: 'base_height', type: 'int', unsigned: true })
  baseHeight!: number

  @Column({ name: 'default_color', length: 7 })
  defaultColor!: string

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number

  @Column({ type: 'boolean', default: true })
  enabled!: boolean
}
