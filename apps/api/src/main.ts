import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { ApiExceptionFilter } from './common/api-exception.filter'
import { ApiResponseInterceptor } from './common/api-response.interceptor'
import { requestIdMiddleware } from './common/request-id.middleware'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.setGlobalPrefix('api/v1')
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' })
  app.use(requestIdMiddleware)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.useGlobalFilters(new ApiExceptionFilter())
  app.useGlobalInterceptors(new ApiResponseInterceptor())

  const config = new DocumentBuilder()
    .setTitle('家居设计平台 API')
    .setDescription('2D 可编辑、3D 只读预览的家居设计平台接口')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('/api/docs', app, document)

  await app.listen(Number(process.env.API_PORT ?? 3000))
}

void bootstrap()
