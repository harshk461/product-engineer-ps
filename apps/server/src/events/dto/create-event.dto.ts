import { Transform, Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsObject, IsString, Matches, MaxLength } from 'class-validator';

export class CreateEventDto {
  /** Caller-provided idempotency key. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    message: 'eventId may only contain letters, numbers, dot, underscore, colon and dash',
  })
  eventId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  type: string;

  @Type(() => Date)
  @IsDate({ message: 'occurredAt must be an ISO-8601 date string' })
  occurredAt: Date;

  @IsObject()
  @Transform(({ value }) => value ?? {})
  payload: Record<string, unknown>;
}
