import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

export class InternalAssignDto {
  @IsUUID()
  engineerUserId!: string;
}

export class InternalTransitionDto {
  @IsIn(['IN_REVIEW', 'ACTION_REQUIRED', 'BOQ_IN_PROGRESS', 'PENDING_APPROVAL', 'APPROVED'])
  nextStatus!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class InternalBoqLineDto {
  @IsOptional()
  @IsUUID()
  lineId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  specification?: string;

  @IsOptional()
  @IsIn(['HVAC', 'ELECTRICAL', 'PLUMBING', 'MULTI', 'OTHER'])
  discipline?: string;

  @IsString()
  @Matches(/^\d{1,14}(?:\.\d{1,4})?$/)
  quantity!: string;

  @IsUUID()
  unitId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  brandPreference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  modelPreference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  engineeringNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  partnerVisibleNotes?: string;

  @IsOptional()
  @IsUUID()
  sourceDocumentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceReference?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;
}

export class InternalDHandoffDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  deliveryLocation!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  idempotencyKey!: string;
}
