import { resolvePortalEmail } from './PortalContext';

describe('portal identity resolution', () => {
  test('uses primary portal user email when present', () => {
    expect(resolvePortalEmail({ email: 'primary@firm.com' }, 'dev@firm.com')).toBe('primary@firm.com');
  });

  test('falls back through Catalyst email aliases', () => {
    expect(resolvePortalEmail({ email_id: 'alias1@firm.com' }, '')).toBe('alias1@firm.com');
    expect(resolvePortalEmail({ user_mailid: 'alias2@firm.com' }, '')).toBe('alias2@firm.com');
    expect(resolvePortalEmail({ user_email: 'alias3@firm.com' }, '')).toBe('alias3@firm.com');
  });

  test('uses development impersonation only when portal identity is absent', () => {
    expect(resolvePortalEmail({}, 'dev@firm.com')).toBe('dev@firm.com');
  });
});
