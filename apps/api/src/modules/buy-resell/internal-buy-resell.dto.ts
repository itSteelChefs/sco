import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreatePurchaseFromSelectionDto {
  @IsUUID()
  selectionCandidateId!: string;

  @IsString()
  @MaxLength(120)
  idempotencyKey!: string;
}

export class CreateSupplierOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  intentIds!: string[];

  @IsString()
  @MaxLength(120)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryContext?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commercialTerms?: string;
}

export class LineConfirmationDto {
  @IsUUID()
  lineId!: string;

  @IsNumber()
  @Min(0)
  confirmedQuantity!: number;
}

export class ConfirmSupplierOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  confirmationReference?: string;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineConfirmationDto)
  lineConfirmations?: LineConfirmationDto[];
}

export class CancelCommercialDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class CreateAllocationDto {
  @IsUUID()
  orderLineId!: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsString()
  @MaxLength(120)
  idempotencyKey!: string;
}

export class ResaleAllocationPriceDto {
  @IsUUID()
  allocationId!: string;

  @IsNumber()
  @Min(0)
  saleUnitPrice!: number;
}

export class CreateResaleOrderDto {
  @IsUUID()
  partnerCompanyId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ResaleAllocationPriceDto)
  allocations!: ResaleAllocationPriceDto[];

  @IsString()
  @MaxLength(120)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryTerms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commercialNotes?: string;
}
