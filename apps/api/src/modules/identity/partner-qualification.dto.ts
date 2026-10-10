import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const SECTORS = ['HVAC_REFRIGERATION', 'ELECTRICAL', 'PLUMBING', 'MULTI'] as const;
const NEED_TYPES = ['VERIFY_QUOTE_CHECK', 'PROCUREMENT_SUPPORT', 'BOTH'] as const;
const SIZES = ['SMALL', 'MEDIUM', 'LARGE', 'PROJECT_BASED'] as const;
const FREQUENCIES = ['OCCASIONAL', 'MONTHLY', 'WEEKLY', 'PROJECT_BASED'] as const;

export class PartnerQualificationDraftDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  companyName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  commercialIdentifier?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  responsiblePerson!: string;

  @IsEmail()
  @MinLength(3)
  @MaxLength(320)
  contact!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city!: string;

  @IsIn(SECTORS)
  sector!: (typeof SECTORS)[number];

  @IsIn(NEED_TYPES)
  needType!: (typeof NEED_TYPES)[number];

  @IsIn(SIZES)
  procurementSize!: (typeof SIZES)[number];

  @IsIn(FREQUENCIES)
  procurementFrequency!: (typeof FREQUENCIES)[number];
}
