import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class InternalProcurementTransitionDto {
  @IsIn(['IN_REVIEW', 'SOURCING', 'QUOTES_RECEIVED', 'COMPARISON_READY', 'SELECTION_READY'])
  nextStatus!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class InternalSupplierEnsureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  name!: string;
}

export class InternalQuoteLineDto {
  @IsOptional()
  @IsUUID()
  requirementLineId?: string;

  @IsIn(['MATCHED', 'UNMATCHED', 'ALTERNATIVE', 'EXCLUDED', 'NOT_QUOTED'])
  matchState!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  offeredDescription?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  offeredQuantity?: number;

  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  lineAmount?: number;

  @IsOptional()
  @IsIn(['EXCL', 'INCL', 'ZERO', 'UNKNOWN', 'NOT_APPLICABLE'])
  taxState?: string;

  @IsOptional()
  @IsIn(['QUOTED', 'EXPLICIT_ZERO', 'NOT_QUOTED', 'INCLUDED', 'UNKNOWN'])
  valueState?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class InternalQuoteRecordDto {
  @IsUUID()
  supplierCompanyId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  quoteReference!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currencyCode!: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  commercialTerms?: string;

  @IsOptional()
  @IsUUID()
  documentId?: string;

  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => InternalQuoteLineDto)
  lines!: InternalQuoteLineDto[];
}

export class InternalAssessmentDto {
  @IsUUID()
  requirementLineId!: string;

  @IsUUID()
  quoteId!: string;

  @IsIn(['PENDING', 'COMPLIANT', 'EQUIVALENT', 'NON_COMPLIANT', 'NOT_ASSESSED', 'NOT_QUOTED'])
  technicalState!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  technicalNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  commercialNotes?: string;
}

export class InternalSelectionDto {
  @IsUUID()
  quoteId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  rationale!: string;
}
