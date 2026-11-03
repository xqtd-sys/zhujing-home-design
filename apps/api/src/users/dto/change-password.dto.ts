import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'

export class ChangePasswordDto {
  @ApiProperty({ minLength: 8, maxLength: 64 })
  @IsString()
  @Length(8, 64)
  currentPassword!: string

  @ApiProperty({ minLength: 8, maxLength: 64 })
  @IsString()
  @Length(8, 64)
  newPassword!: string
}
