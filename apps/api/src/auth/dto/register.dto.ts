import { ApiProperty } from '@nestjs/swagger'
import { IsEmail, IsString, Length, Matches } from 'class-validator'

export class RegisterDto {
  @ApiProperty({ example: 'designer01', minLength: 3, maxLength: 32 })
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: '用户名只能包含字母、数字和下划线' })
  username!: string

  @ApiProperty({ example: 'designer@example.com' })
  @IsEmail()
  @Length(3, 191)
  email!: string

  @ApiProperty({ example: 'Password123', minLength: 8, maxLength: 64 })
  @IsString()
  @Length(8, 64)
  password!: string
}
