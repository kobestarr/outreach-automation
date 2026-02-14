/**
 * Check generic emails in recent export
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'ksd/local-outreach/orchestrator/data/businesses.db');
const db = new Database(dbPath);

// Get recent businesses with emails
const businesses = db.prepare(`
  SELECT name, owner_email, category
  FROM businesses
  WHERE owner_email IS NOT NULL
  ORDER BY id DESC
  LIMIT 40
`).all();

console.log(`\n📊 Total businesses with emails: ${businesses.length}\n`);

// Check for generic emails
const genericPattern = /^(info|contact|hello|support|admin|enquiries|enquiry|mail)@/i;
const genericEmails = businesses.filter(b => genericPattern.test(b.owner_email));

console.log(`✅ Generic emails found: ${genericEmails.length}\n`);

if (genericEmails.length > 0) {
  console.log('Generic email addresses:');
  genericEmails.forEach(b => {
    const emailType = b.owner_email.match(/^([^@]+)@/)[1];
    console.log(`  ${emailType}@... → ${b.name} (${b.category})`);
  });
} else {
  console.log('❌ No generic emails found');
  console.log('\nShowing all email types for comparison:');
  businesses.slice(0, 15).forEach(b => {
    const emailPrefix = b.owner_email.split('@')[0];
    console.log(`  ${emailPrefix}@... → ${b.name}`);
  });
}

console.log();
db.close();
