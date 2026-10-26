import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export type CourierReconciliationAction =
  | 'ADOPT_CONSIGNMENT'
  | 'CLEAR_AND_RETRY'
  | 'CANCEL_DISPATCH';

export class ResolveCourierReconciliationDto {
  @IsNotEmpty({ message: 'Action is required' })
  @IsIn(['ADOPT_CONSIGNMENT', 'CLEAR_AND_RETRY', 'CANCEL_DISPATCH'], {
    message:
      'Action must be one of: ADOPT_CONSIGNMENT, CLEAR_AND_RETRY, CANCEL_DISPATCH',
  })
  action!: CourierReconciliationAction;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'consignmentId cannot be empty when provided' })
  consignmentId?: string;

  @IsOptional()
  @IsString()
  trackingCode?: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @IsOptional()
  confirmCarrierRejection?: boolean;

  @IsNotEmpty({
    message: 'Audit notes are mandatory for administrative reconciliation',
  })
  @IsString()
  @MinLength(5, { message: 'Audit notes must be at least 5 characters long' })
  notes!: string;
}
