import { ApiProperty } from '@nestjs/swagger'
import { IsEmail, IsString, Length, Matches } from 'class-validator'

export class UpdateProfileDto {
  @ApiProperty({ example: '筑境设计师', minLength: 1, maxLength: 64 })
  @IsString()
  @Length(1, 64)
  @Matches(/\S/, { message: '昵称不能为空' })
  nickname!: string

  @ApiProperty({ example: 'designer@example.com' })
  @IsEmail()
  @Length(3, 191)
  email!: string
}
