import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, IsUUID, Length } from 'class-validator'

export class ListFurnitureAssetsDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string

  @ApiPropertyOptional({ example: '沙发', minLength: 1, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  keyword?: string
}
