const { isValidPersonName } = require('./shared/outreach-core/validation/data-quality');
const tests = [
  ['Bali1room', false],
  ['Cheatdazebradford', false],
  ['Gm', false],
  ['Dataprotectionofficer', false],
  ['Aviator', false],
  // Good short names still pass
  ['Ed', true],
  ['Jo', true],
  ['Eben', true],
  ['Liz', true],
  ['Chris', true],
  ['Derek', true],
  ['Peter', true],
  ['Anna', true],
  ['Warren', true],
];
let allPass = true;
for (const [name, expected] of tests) {
  const result = isValidPersonName(name);
  const ok = result === expected;
  const marker = ok ? 'OK  ' : 'FAIL';
  console.log(marker + '  ' + name.padEnd(25) + ' expected=' + String(expected).padEnd(6) + ' got=' + result);
  if (!ok) allPass = false;
}
console.log(allPass ? '\nAll passed!' : '\nSOME FAILED!');
process.exit(allPass ? 0 : 1);
