import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { TypeOrmModule } from '@nestjs/typeorm'
import { resolve } from 'node:path'
import { AssetsModule } from './assets/assets.module'
import { AdminModule } from './admin/admin.module'
import { AuthModule } from './auth/auth.module'
import { validateEnvironment } from './common/env.validation'
import { HealthController } from './health.controller'
import { PlansModule } from './plans/plans.module'
import { UsersModule } from './users/users.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [resolve(__dirname, '../../../.env'), resolve(process.cwd(), '.env')],
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get('DB_HOST', 'localhost'),
        port: Number(config.get('DB_PORT', 3307)),
        username: config.get('DB_USERNAME', 'home_design'),
        password: config.get('DB_PASSWORD', 'home_design_password'),
        database: config.get('DB_DATABASE', 'home_design'),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
        // Docker Desktop may take a few seconds to make MySQL available after a reboot.
        // Keep the API process alive while the database finishes starting.
        retryAttempts: 15,
        retryDelay: 2_000,
      }),
    }),
    AuthModule,
    AdminModule,
    UsersModule,
    AssetsModule,
    PlansModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
