import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class PaginationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

/** Normalizes query input even when a test adapter does not install Nest's global pipe. */
export function parsePagination(input: Record<string, unknown>): PaginationDto {
  const page = input.page === undefined ? 1 : Number(input.page);
  const pageSize = input.pageSize === undefined ? 20 : Number(input.pageSize);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new BadRequestException({ error: { code: 'VALIDATION_FAILED' } });
  }
  return Object.assign(new PaginationDto(), { page, pageSize });
}
