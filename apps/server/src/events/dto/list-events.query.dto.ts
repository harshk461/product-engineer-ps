import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DeliveryStatus } from '../../common/delivery-status.enum';

export class ListEventsQueryDto {
  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}
