import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddUserRoles1790222200000 implements MigrationInterface {
  name = 'AddUserRoles1790222200000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN role varchar(16) NOT NULL DEFAULT 'user' AFTER status`)
    await queryRunner.query(`UPDATE users SET role = 'admin' WHERE username = 'admin' OR email = 'admin@zhujing.local'`)
    await queryRunner.query(`
      INSERT INTO users (id, username, email, password_hash, nickname, status, role)
      SELECT UUID(), 'admin', 'admin@zhujing.local', '$2b$12$8AGSvvkKAh68Wbxrg2xtpuXGLWADSqtwOu0MCGk8ZvOLorESzLOye', '系统管理员', 'active', 'admin'
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin' OR email = 'admin@zhujing.local')
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM users WHERE username = 'admin' AND email = 'admin@zhujing.local'`)
    await queryRunner.query('ALTER TABLE users DROP COLUMN role')
  }
}
