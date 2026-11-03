import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class ListPlansDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 12

  @IsOptional()
  @IsString()
  keyword?: string

  @IsOptional()
  @IsIn(['latest', 'likes'])
  sort: 'latest' | 'likes' = 'latest'
}
