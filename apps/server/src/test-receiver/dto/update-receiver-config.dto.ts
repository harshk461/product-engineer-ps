import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ReceiverMode } from '../test-receiver.service';

export class UpdateReceiverConfigDto {
  @IsOptional()
  @IsEnum(ReceiverMode)
  mode?: ReceiverMode;

  /** 503 demonstrates a retryable failure; 400 demonstrates a permanent one. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(400)
  @Max(599)
  failureStatus?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60000)
  latencyMs?: number;

  /** Clears the receiver's per-event memory so a demo can be re-run cleanly. */
  @IsOptional()
  @IsBoolean()
  resetState?: boolean;
}
