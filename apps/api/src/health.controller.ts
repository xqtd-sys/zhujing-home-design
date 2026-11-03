import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

@ApiTags('System')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: '检查 API 是否运行' })
  getHealth() {
    return {
      status: 'ok',
      service: 'home-design-api',
      timestamp: new Date().toISOString(),
    }
  }
}
