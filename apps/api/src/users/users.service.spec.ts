import { BadRequestException } from '@nestjs/common'
import { compare, hash } from 'bcryptjs'
import { UsersService } from './users.service'

describe('UsersService', () => {
  it('normalizes and updates profile fields', async () => {
    const current = { id: 'user-id', username: 'tester', email: 'old@example.com', nickname: 'Old' }
    const updated = { ...current, email: 'new@example.com', nickname: 'New name' }
    const users = {
      findOne: jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(updated),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    }
    const service = new UsersService(users as never)

    await expect(
      service.updateProfile('user-id', { email: ' New@Example.com ', nickname: ' New name ' }),
    ).resolves.toBe(updated)
    expect(users.update).toHaveBeenCalledWith({ id: 'user-id' }, { email: 'new@example.com', nickname: 'New name' })
  })

  it('rejects a wrong current password without updating it', async () => {
    const users = passwordRepository(await hash('Password123', 4))
    const service = new UsersService(users as never)

    await expect(
      service.changePassword('user-id', { currentPassword: 'WrongPass123', newPassword: 'NewPassword123' }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_CURRENT_PASSWORD' },
    })
    expect(users.update).not.toHaveBeenCalled()
  })

  it('rejects reusing the current password', async () => {
    const users = passwordRepository(await hash('Password123', 4))
    const service = new UsersService(users as never)

    await expect(
      service.changePassword('user-id', { currentPassword: 'Password123', newPassword: 'Password123' }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(users.update).not.toHaveBeenCalled()
  })

  it('hashes and stores a valid new password', async () => {
    const users = passwordRepository(await hash('Password123', 4))
    const service = new UsersService(users as never)

    await expect(
      service.changePassword('user-id', { currentPassword: 'Password123', newPassword: 'NewPassword123' }),
    ).resolves.toEqual({ updated: true })
    const passwordHash = users.update.mock.calls[0][1].passwordHash
    await expect(compare('NewPassword123', passwordHash)).resolves.toBe(true)
  })
})

function passwordRepository(passwordHash: string) {
  const queryBuilder = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue({ id: 'user-id', passwordHash }),
  }
  return {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  }
}
