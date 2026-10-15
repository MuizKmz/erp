import { passwordHint, passwordProblem } from './password.rules';

describe('password rules (rule 7; SDD 10.2)', () => {
  const policy = { passwordMinLength: 10, refuseCommonPasswords: true };
  const aina = { code: 'AR', name: 'Aina Rahman', email: 'aina@warehouse.com' };

  it('takes a long password that is not common and not the user’s own', () => {
    expect(passwordProblem('River-stone-2026', policy, aina)).toBeNull();
  });

  it('needs the shortest length the settings name', () => {
    expect(passwordProblem('Short-1', policy, aina)).toBe('Use at least 10 characters.');
    expect(passwordProblem('Short-12', { ...policy, passwordMinLength: 8 }, aina)).toBeNull();
    expect(passwordProblem('x'.repeat(201), policy, aina)).toBe('Use at most 200 characters.');
  });

  it('refuses common passwords, also behind trailing digits and symbols, and one repeated character', () => {
    const common = 'That password is too common. Pick something harder to guess.';
    expect(passwordProblem('qwertyuiop', policy, aina)).toBe(common);
    expect(passwordProblem('QWERTYUIOP', policy, aina)).toBe(common);
    expect(passwordProblem('qwertyuiop2026!', policy, aina)).toBe(common);
    expect(passwordProblem('aaaaaaaaaaaa', policy, aina)).toBe(common);
    expect(passwordProblem('qwertyuiop', { ...policy, refuseCommonPasswords: false }, aina)).toBeNull();
  });

  it('refuses the user’s name, code or email name (parts of 3 letters or more)', () => {
    const own = 'Do not use your name, user code or email in your password.';
    expect(passwordProblem('Rahman-2026-sales', policy, aina)).toBe(own);
    expect(passwordProblem('my-aina-password', policy, aina)).toBe(own);
    expect(passwordProblem('Tanjung-ar-2026', policy, aina)).toBeNull(); // "AR" is too short to count
    expect(passwordProblem('weiling-2026-x', policy, { code: 'TWL', name: 'Tan Wei Ling', email: 'weiling@warehouse.com' })).toBe(own);
  });

  it('says the policy under the password fields', () => {
    expect(passwordHint(policy)).toBe('At least 10 characters. Common passwords are refused.');
    expect(passwordHint({ passwordMinLength: 12, refuseCommonPasswords: false })).toBe('At least 12 characters.');
  });
});
