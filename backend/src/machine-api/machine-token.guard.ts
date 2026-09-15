import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

/**
 * Machine-to-machine access for the media-buying machine (PRD §2.2, rule I4).
 * A separate token from ADMIN_API_KEY: the machine only reads facts, and
 * rotating its token must not lock the admin out. Fails closed when unset.
 */
@Injectable()
export class MachineTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const match = /^Bearer\s+(.+)$/i.exec(header || '');
    const expected = this.config.get<string>('MACHINE_API_TOKEN');

    if (!expected || !match || !this.safeEqual(match[1].trim(), expected)) {
      throw new UnauthorizedException('Invalid machine token');
    }
    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
