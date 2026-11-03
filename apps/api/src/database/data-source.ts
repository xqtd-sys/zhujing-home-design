import { config } from 'dotenv'
import { resolve } from 'node:path'
import { DataSource } from 'typeorm'
import { Plan } from '../plans/plan.entity'
import { PlanLike } from '../plans/plan-like.entity'
import { User } from '../users/user.entity'
import { FurnitureAsset } from '../assets/furniture-asset.entity'
import { FurnitureCategory } from '../assets/furniture-category.entity'
import { CreateUsersAndPlans1758427200000 } from './migrations/1758427200000-CreateUsersAndPlans'
import { CreateFurnitureCatalog1790222000000 } from './migrations/1790222000000-CreateFurnitureCatalog'
import { AddPlanDiscovery1790222100000 } from './migrations/1790222100000-AddPlanDiscovery'
import { AddUserRoles1790222200000 } from './migrations/1790222200000-AddUserRoles'
import { AddPlanLikes1790222300000 } from './migrations/1790222300000-AddPlanLikes'

config({ path: resolve(__dirname, '../../../../.env') })

export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3307),
  username: process.env.DB_USERNAME ?? 'home_design',
  password: process.env.DB_PASSWORD ?? 'home_design_password',
  database: process.env.DB_DATABASE ?? 'home_design',
  entities: [User, Plan, PlanLike, FurnitureCategory, FurnitureAsset],
  migrations: [
    CreateUsersAndPlans1758427200000,
    CreateFurnitureCatalog1790222000000,
    AddPlanDiscovery1790222100000,
    AddUserRoles1790222200000,
    AddPlanLikes1790222300000,
  ],
  synchronize: false,
})
