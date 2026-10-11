import { Type } from 'class-transformer';
import {
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

const SECTORS = ['HVAC', 'ELECTRICAL', 'PLUMBING', 'MULTI'] as const;

export class PartnerProcurementRequirementDraftDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @IsIn(SECTORS)
  sector!: (typeof SECTORS)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  deliveryLocation!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  referenceCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  projectReference?: string;

  @IsOptional()
  @IsDateString()
  neededBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class PartnerProcurementLineDto {
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

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity!: number;

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
  technicalNotes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;
}

export class PartnerProcurementLinesBodyDto {
  @ValidateNested()
  @Type(() => PartnerProcurementLineDto)
  line!: PartnerProcurementLineDto;
}
