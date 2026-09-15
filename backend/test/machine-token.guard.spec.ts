import { UnauthorizedException } from '@nestjs/common';
import { MachineTokenGuard } from '../src/machine-api/machine-token.guard';

function contextWith(authorization?: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  } as never;
}

describe('MachineTokenGuard', () => {
  const guardWith = (token?: string) => new MachineTokenGuard({ get: () => token } as never);

  it('rejects every request when MACHINE_API_TOKEN is unset (fails closed)', () => {
    expect(() => guardWith(undefined).canActivate(contextWith('Bearer anything'))).toThrow(
      UnauthorizedException,
    );
    expect(() => guardWith('').canActivate(contextWith('Bearer '))).toThrow(UnauthorizedException);
  });

  it('rejects a missing, malformed or wrong token', () => {
    const guard = guardWith('s3cret-token');
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextWith('s3cret-token'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextWith('Bearer s3cret-tokeN'))).toThrow(UnauthorizedException);
  });

  it('accepts the configured bearer token, whatever the scheme casing', () => {
    const guard = guardWith('s3cret-token');
    expect(guard.canActivate(contextWith('Bearer s3cret-token'))).toBe(true);
    expect(guard.canActivate(contextWith('bearer s3cret-token'))).toBe(true);
  });
});
