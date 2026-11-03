import type { MigrationInterface, QueryRunner } from 'typeorm'

export class CreateUsersAndPlans1758427200000 implements MigrationInterface {
  name = 'CreateUsersAndPlans1758427200000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id varchar(36) NOT NULL,
        username varchar(32) NOT NULL,
        email varchar(191) NOT NULL,
        password_hash varchar(255) NOT NULL,
        nickname varchar(64) NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'active',
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX UQ_users_username (username),
        UNIQUE INDEX UQ_users_email (email),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await queryRunner.query(`
      CREATE TABLE plans (
        id varchar(36) NOT NULL,
        owner_id varchar(36) NOT NULL,
        name varchar(100) NOT NULL,
        document_json json NOT NULL,
        schema_version int unsigned NOT NULL DEFAULT 1,
        revision int unsigned NOT NULL DEFAULT 1,
        thumbnail_url varchar(500) NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at datetime(6) NULL,
        INDEX IDX_plans_owner_updated (owner_id, updated_at),
        PRIMARY KEY (id),
        CONSTRAINT FK_plans_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE plans')
    await queryRunner.query('DROP TABLE users')
  }
}
