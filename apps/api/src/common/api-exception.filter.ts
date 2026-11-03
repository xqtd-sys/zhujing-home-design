import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { Response } from 'express'

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null
    const objectResponse =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as Record<string, unknown>)
        : null
    const rawMessage = objectResponse?.message ?? exceptionResponse
    const message = Array.isArray(rawMessage)
      ? rawMessage.join('; ')
      : typeof rawMessage === 'string'
        ? rawMessage
        : '服务器内部错误'
    const code = typeof objectResponse?.code === 'string' ? objectResponse.code : `HTTP_${status}`

    if (!(exception instanceof HttpException)) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception))
    }

    response.status(status).json({ code, message, data: null, requestId: response.locals.requestId })
  }
}
