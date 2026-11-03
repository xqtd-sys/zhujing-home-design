import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddPlanDiscovery1790222100000 implements MigrationInterface {
  name = 'AddPlanDiscovery1790222100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE plans ADD COLUMN is_public tinyint(1) NOT NULL DEFAULT 0 AFTER thumbnail_url`)
    await queryRunner.query(`CREATE INDEX IDX_plans_public_updated ON plans (is_public, updated_at)`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IDX_plans_public_updated ON plans`)
    await queryRunner.query(`ALTER TABLE plans DROP COLUMN is_public`)
  }
}
