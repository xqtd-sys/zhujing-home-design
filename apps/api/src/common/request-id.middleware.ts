import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'

export function requestIdMiddleware(request: Request, response: Response, next: NextFunction) {
  const incoming = request.header('x-request-id')
  const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID()
  response.locals.requestId = requestId
  response.setHeader('x-request-id', requestId)
  next()
}
