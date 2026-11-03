import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'

export class CreatePlanDto {
  @ApiProperty({ example: '我的新家' })
  @IsString()
  @Length(1, 100)
  name!: string
}
