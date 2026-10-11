import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class GBackfillDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class GPriceHistoryQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  comparableKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  sector?: string;

  @IsOptional()
  @IsUUID()
  supplierCompanyId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;

  @IsOptional()
  @IsUUID()
  unitId?: string;
}

export class GDemandQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  sector?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  windowDays?: number;
}

export class GEvidenceQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  comparableKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  factKind?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
