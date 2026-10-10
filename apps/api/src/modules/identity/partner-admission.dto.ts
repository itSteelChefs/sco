import { IsBoolean, IsDateString, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateQualificationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  legalName!: string;

  @IsString()
  @IsEmail()
  @MinLength(3)
  @MaxLength(320)
  contactEmail!: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class QualificationDecisionDto {
  @IsIn(['UNDER_REVIEW', 'ACTION_REQUIRED', 'APPROVED', 'REJECTED'])
  status!: 'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED';

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class PartnershipTypeDto {
  @IsIn(['BUYER_PARTNERSHIP', 'SUPPLIER_PARTNERSHIP'])
  type!: 'BUYER_PARTNERSHIP' | 'SUPPLIER_PARTNERSHIP';
}

export class PartnershipReasonDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class CreateAgreementPolicyDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,63}$/)
  agreementType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  versionCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(262144)
  contentText!: string;

  @IsDateString()
  effectiveAt!: string;

  @IsString()
  @Matches(/^[a-z][a-z0-9._-]{2,127}$/)
  acceptancePermissionCode!: string;

  @IsBoolean()
  reacceptanceRequired!: boolean;

  @IsIn(['NO_ACCESS_CHANGE', 'REQUIRE_REACCEPTANCE', 'BLOCK_OPERATIONAL_ACCESS'])
  suspensionEffect!: string;

  @IsIn(['NO_ACCESS_CHANGE', 'REQUIRE_REACCEPTANCE', 'BLOCK_OPERATIONAL_ACCESS'])
  terminationEffect!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  retentionClassification!: string;

  @IsBoolean()
  required!: boolean;
}

export class PartnerAgreementAcceptanceDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,63}$/)
  agreementType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  versionCode!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}
