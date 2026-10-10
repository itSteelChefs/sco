import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
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

/** Wave2 Partner Verify is Quote Check only — reject any other productMode. */
export class PartnerVerifyCreateDto {
  @IsIn(['QUOTE_CHECK'])
  productMode!: 'QUOTE_CHECK';
}

export class PartnerVerifyQuoteLineDto {
  @IsNumber()
  @Min(1)
  lineNumber!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lineReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  itemDescription?: string;

  @IsOptional()
  @IsUUID()
  productIdentityId?: string;

  @IsUUID()
  unitId!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currencyCode!: string;

  @IsNumber()
  unitPrice!: number;

  @IsOptional()
  @IsBoolean()
  isPriceBearing?: boolean;

  @IsOptional()
  @IsBoolean()
  isInformational?: boolean;

  @IsOptional()
  @IsBoolean()
  isRealZeroValue?: boolean;
}

export class PartnerVerifyAttachQuoteDto {
  @IsUUID()
  documentId!: string;

  @IsUUID()
  documentVersionId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  currencies!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PartnerVerifyQuoteLineDto)
  lines!: PartnerVerifyQuoteLineDto[];

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;

  @IsOptional()
  @IsUUID()
  expectedPredecessorRevisionId?: string;
}

export class PartnerVerifySubmitDto {
  @IsUUID()
  revisionId!: string;
}
