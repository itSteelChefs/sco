import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export const PARTNER_DOCUMENT_CATEGORIES = ['QUALIFICATION_SUPPORT', 'AGREEMENT_ARTIFACT', 'VERIFY_QUOTE', 'GENERAL'] as const;
export type PartnerDocumentCategory = (typeof PARTNER_DOCUMENT_CATEGORIES)[number];

export const RETENTION_CLASSES = ['PARTNER_ORIGINAL', 'PROCESSED_DERIVATIVE', 'VERIFY_RESULT', 'AUDIT_RECORD'] as const;

export class PartnerDocumentUploadDto {
  @IsIn(PARTNER_DOCUMENT_CATEGORIES)
  category!: PartnerDocumentCategory;

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  filename!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  contentType!: string;

  /** Base64-encoded file bytes (Wave2 HTTP JSON surface; no multipart/OSS). */
  @IsString()
  @MinLength(1)
  contentBase64!: string;

  @IsOptional()
  @IsIn(['QUALIFICATION_APPLICATION', 'VERIFY_REQUEST', 'AGREEMENT_POLICY_VERSION'])
  linkedEntityType?: 'QUALIFICATION_APPLICATION' | 'VERIFY_REQUEST' | 'AGREEMENT_POLICY_VERSION';

  @IsOptional()
  @IsUUID()
  linkedEntityId?: string;
}
