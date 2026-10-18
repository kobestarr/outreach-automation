// tests/reply-mailboxes.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { MAILBOXES, isOurMailbox, brandOf, ownMailboxIn } = require('../shared/outreach-core/replies/mailboxes');

test('there are 27 distinct sending mailboxes', () => {
  assert.strictEqual(MAILBOXES.length, 27);
  assert.strictEqual(new Set(MAILBOXES).size, 27);
});
test('brand follows the domain', () => {
  assert.strictEqual(brandOf('kobi@kobestarrdigital.com'), 'ksd');
  assert.strictEqual(brandOf('Kobi.O@TRYKOBESTARRDIGITAL.COM'), 'ksd');
  assert.strictEqual(brandOf('kobi@gostripped.media'), 'stripped');
  assert.strictEqual(brandOf('kobi.omenaka@strippedmedia.org'), 'stripped');
  assert.strictEqual(brandOf('kobi@dealflowmedia.group'), 'dealflow');
  assert.strictEqual(brandOf('someone@gmail.com'), null);
});
test('isOurMailbox is exact, not just the domain', () => {
  assert.ok(isOurMailbox('kobi.o@dealflowmedia.pro'));
  assert.ok(!isOurMailbox('bob@dealflowmedia.pro'));
  assert.ok(!isOurMailbox('kobi@kobestarr.io'));
});
test('ownMailboxIn finds our mailbox in a list or "Name <addr>" string', () => {
  assert.strictEqual(ownMailboxIn(['x@y.com', 'Kobi O <kobi.o@kobestarr.digital>']), 'kobi.o@kobestarr.digital');
  assert.strictEqual(ownMailboxIn('a@b.com, kobi@strippedmedia.co.uk'), 'kobi@strippedmedia.co.uk');
  assert.strictEqual(ownMailboxIn(['a@b.com']), null);
});
