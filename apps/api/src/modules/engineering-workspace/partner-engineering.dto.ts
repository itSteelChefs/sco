import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class PartnerEngineeringRequestDraftDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @IsIn(['HVAC', 'ELECTRICAL', 'PLUMBING', 'MULTI'])
  sector!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsIn(['BOQ_PREPARATION', 'DESIGN_REVIEW', 'SPEC_CLARIFICATION', 'OTHER'])
  requestType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  projectReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class PartnerEngineeringDocumentLinkDto {
  @IsUUID()
  documentId!: string;

  @IsIn(['DRAWING', 'SPECIFICATION', 'SCHEDULE', 'SPREADSHEET', 'IMAGE', 'OTHER'])
  classification!: string;
}
