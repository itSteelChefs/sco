import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class HWorkUpsertDto {
  @IsString() @MaxLength(8) domain!: string;
  @IsString() @MaxLength(80) sourceEntityType!: string;
  @IsUUID() sourceEntityId!: string;
  @IsString() @MaxLength(80) workType!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) priority?: number;
  @IsOptional() @IsISO8601() dueAt?: string;
  @IsOptional() @IsBoolean() actionRequired?: boolean;
  @IsOptional() @IsString() @MaxLength(240) nextAction?: string;
  @IsOptional() @IsUUID() partnerCompanyId?: string;
}

export class HAssignDto {
  @IsUUID() assigneeUserId!: string;
}

export class HTransitionDto {
  @IsString() @MaxLength(20) status!: string;
  @IsOptional() @IsString() @MaxLength(500) blockedReason?: string;
}

export class HExceptionUpsertDto {
  @IsString() @MaxLength(8) domain!: string;
  @IsString() @MaxLength(80) sourceEntityType!: string;
  @IsUUID() sourceEntityId!: string;
  @IsString() @MaxLength(80) exceptionType!: string;
  @IsOptional() @IsBoolean() retryable?: boolean;
  @IsString() @MaxLength(80) safeErrorCode!: string;
  @IsString() @MaxLength(500) safeErrorMessage!: string;
  @IsOptional() @IsUUID() workItemId?: string;
}

export class HResolveDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class HCycleCreateDto {
  @IsISO8601() startsAt!: string;
  @IsISO8601() cutoffAt!: string;
  @IsISO8601() endsAt!: string;
}

export class HCycleOverrideDto {
  @IsUUID() workItemId!: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class HJobEnqueueDto {
  @IsString() @MaxLength(40) jobType!: string;
  @IsString() @MinLength(1) @MaxLength(200) idempotencyKey!: string;
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
}

export class HConfigSetDto {
  @IsString() @MaxLength(64) key!: string;
  @IsObject() value!: Record<string, unknown>;
}

export class HQueueQueryDto {
  @IsOptional() @IsString() @MaxLength(20) view?: string;
  @IsOptional() @IsString() @MaxLength(8) domain?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
