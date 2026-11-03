import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'

export class LoginDto {
  @ApiProperty({ description: '用户名或邮箱', example: 'designer01' })
  @IsString()
  @Length(3, 191)
  identity!: string

  @ApiProperty({ example: 'Password123' })
  @IsString()
  @Length(8, 64)
  password!: string
}
