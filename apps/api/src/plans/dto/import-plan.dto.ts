import { ApiProperty } from '@nestjs/swagger'
import { IsObject, IsString, Length } from 'class-validator'

export class ImportPlanDto {
  @ApiProperty({ example: '客厅方案副本' })
  @IsString()
  @Length(1, 100)
  name!: string

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  documentJson!: Record<string, unknown>
}
