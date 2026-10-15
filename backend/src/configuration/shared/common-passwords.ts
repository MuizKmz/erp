/**
 * Passwords that are refused when "Common passwords: Refused" is on (SDD 10.2): the most used ones from public breach
 * lists, plus local ones a Malaysian office would pick. Compared in lower case, ignoring a trailing digits-and-symbols
 * run, so "Password123!" counts as "password".
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890', '0123456789', '111111', '000000', '121212', '123123', '654321',
  '666666', '696969', '112233', '987654321', 'password', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'pass', 'passwd', 'qwerty',
  'qwertyuiop', 'qwerty123', 'qwe123', 'asdfgh', 'asdfghjkl', 'zxcvbnm', 'abc123', 'abcd1234', 'abcdef', 'abcdefg', 'aa123456',
  'iloveyou', 'admin', 'administrator', 'welcome', 'welcome1', 'login', 'letmein', 'monkey', 'dragon', 'master', 'sunshine',
  'princess', 'football', 'baseball', 'soccer', 'superman', 'batman', 'trustno1', 'shadow', 'michael', 'jennifer', 'charlie',
  'freedom', 'whatever', 'computer', 'internet', 'secret', 'changeme', 'default', 'guest', 'test', 'testing', 'hello',
  'hellohello', 'starwars', 'pokemon', 'mustang', 'access', 'flower', 'lovely', 'summer', 'winter', 'killer', 'hunter',
  'ranger', 'jordan', 'harley', 'zaq12wsx', '1q2w3e4r', '1qaz2wsx', 'q1w2e3r4', 'qazwsx', 'aaaaaa', 'abcabc', 'user',
  'company', 'office', 'erp', 'zora', 'zorapro', 'malaysia', 'kualalumpur', 'selamat', 'sayang', 'cintaku', 'rahsia',
  'katalaluan', 'warehouse', 'clbgroups', 'clb',
]);
