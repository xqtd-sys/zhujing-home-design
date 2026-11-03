import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddPlanLikes1790222300000 implements MigrationInterface {
  name = 'AddPlanLikes1790222300000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE plan_likes (
        id varchar(36) NOT NULL,
        plan_id varchar(36) NOT NULL,
        user_id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX UQ_plan_likes_plan_user (plan_id, user_id),
        INDEX IDX_plan_likes_plan (plan_id),
        PRIMARY KEY (id),
        CONSTRAINT FK_plan_likes_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
        CONSTRAINT FK_plan_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE plan_likes')
  }
}
