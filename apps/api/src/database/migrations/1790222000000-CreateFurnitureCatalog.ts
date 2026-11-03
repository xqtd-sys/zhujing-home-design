import type { MigrationInterface, QueryRunner } from 'typeorm'

export class CreateFurnitureCatalog1790222000000 implements MigrationInterface {
  name = 'CreateFurnitureCatalog1790222000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE furniture_categories (
        id varchar(36) NOT NULL,
        name varchar(64) NOT NULL,
        sort_order int NOT NULL DEFAULT 0,
        enabled tinyint NOT NULL DEFAULT 1,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await queryRunner.query(`
      CREATE TABLE furniture_assets (
        id varchar(36) NOT NULL,
        category_id varchar(36) NOT NULL,
        name varchar(64) NOT NULL,
        icon_url varchar(500) NULL,
        model_url varchar(500) NULL,
        primitive_type varchar(32) NULL,
        base_width int unsigned NOT NULL,
        base_depth int unsigned NOT NULL,
        base_height int unsigned NOT NULL,
        default_color varchar(7) NOT NULL,
        sort_order int NOT NULL DEFAULT 0,
        enabled tinyint NOT NULL DEFAULT 1,
        INDEX IDX_furniture_assets_category_sort (category_id, sort_order),
        PRIMARY KEY (id),
        CONSTRAINT FK_furniture_assets_category FOREIGN KEY (category_id)
          REFERENCES furniture_categories(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await queryRunner.query(`
      INSERT INTO furniture_categories (id, name, sort_order, enabled) VALUES
        ('b1111111-1111-4111-8111-111111111111', '客厅', 10, 1),
        ('b2222222-2222-4222-8222-222222222222', '卧室', 20, 1),
        ('b3333333-3333-4333-8333-333333333333', '餐厅', 30, 1),
        ('b4444444-4444-4444-8444-444444444444', '收纳', 40, 1)
    `)
    await queryRunner.query(`
      INSERT INTO furniture_assets (
        id, category_id, name, icon_url, model_url, primitive_type,
        base_width, base_depth, base_height, default_color, sort_order, enabled
      ) VALUES
        ('a1111111-1111-4111-8111-111111111111', 'b1111111-1111-4111-8111-111111111111', '沙发', NULL, NULL, 'box', 200, 90, 85, '#94b5a5', 10, 1),
        ('a2222222-2222-4222-8222-222222222222', 'b2222222-2222-4222-8222-222222222222', '床', NULL, NULL, 'box', 180, 200, 55, '#b8aa91', 20, 1),
        ('a3333333-3333-4333-8333-333333333333', 'b3333333-3333-4333-8333-333333333333', '餐桌', NULL, NULL, 'box', 140, 80, 75, '#a88e72', 30, 1),
        ('a4444444-4444-4444-8444-444444444444', 'b4444444-4444-4444-8444-444444444444', '柜子', NULL, NULL, 'box', 120, 45, 200, '#8d9b91', 40, 1)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE furniture_assets')
    await queryRunner.query('DROP TABLE furniture_categories')
  }
}
