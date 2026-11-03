import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'

export class RenamePlanDto {
  @ApiProperty({ example: '温馨两居室' })
  @IsString()
  @Length(1, 100)
  name!: string
}
