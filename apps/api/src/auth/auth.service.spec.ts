import { UnauthorizedException } from '@nestjs/common'
import { hash } from 'bcryptjs'
import { AuthService } from './auth.service'

describe('AuthService', () => {
  const jwt = { sign: jest.fn(() => 'signed-token') }

  it('rejects an invalid password', async () => {
    const users = {
      findForLogin: jest.fn().mockResolvedValue({
        id: 'user-id',
        username: 'tester',
        email: 'tester@example.com',
        nickname: 'tester',
        status: 'active',
        passwordHash: await hash('Password123', 4),
      }),
    }
    const service = new AuthService(users as never, jwt as never)
    await expect(service.login({ identity: 'tester', password: 'WrongPass123' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('returns a signed session for valid credentials', async () => {
    const users = {
      findForLogin: jest.fn().mockResolvedValue({
        id: 'user-id',
        username: 'tester',
        email: 'tester@example.com',
        nickname: 'tester',
        status: 'active',
        passwordHash: await hash('Password123', 4),
      }),
    }
    const service = new AuthService(users as never, jwt as never)
    await expect(service.login({ identity: 'tester', password: 'Password123' })).resolves.toMatchObject({
      accessToken: 'signed-token',
    })
  })
})
