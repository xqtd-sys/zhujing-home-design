import { ApiProperty } from '@nestjs/swagger'
import { IsInt, IsObject, Min } from 'class-validator'

export class UpdatePlanDto {
  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  expectedRevision!: number

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  documentJson!: Record<string, unknown>
}
