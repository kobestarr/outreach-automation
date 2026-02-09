/**
 * Approval CLI - Interactive terminal interface for reviewing and approving email templates
 */

const readline = require('readline');
const {
  loadApprovalQueue,
  approveTemplate,
  rejectTemplate,
  editAndApproveTemplate,
  approveAllPending
} = require('./approval-manager');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Create simple prompt using readline
 * @param {string} question - Prompt text
 * @returns {Promise<string>} User input
 */
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

/**
 * Wrap text at specified width
 * @param {string} text - Text to wrap
 * @param {number} width - Maximum width
 * @returns {string} Wrapped text
 */
function wrapText(text, width) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + word).length > width) {
      lines.push(currentLine.trim());
      currentLine = word + ' ';
    } else {
      currentLine += word + ' ';
    }
  }
  if (currentLine) lines.push(currentLine.trim());

  return lines.join('\n');
}

/**
 * Display detailed approval item
 * @param {Object} item - Queue item with business and email data
 * @param {number} index - Item index for display
 * @param {number} total - Total pending items
 */
function displayApprovalDetail(item, index, total) {
  console.log(`\n${'─'.repeat(68)}`);
  console.log(`APPROVAL ${index}/${total} - Category: ${item.category || 'unknown'}`);
  console.log(`${'─'.repeat(68)}\n`);
  console.log(`Business: ${item.business.name}`);
  console.log(`Owner: ${item.business.ownerFirstName || 'Unknown'}`);
  console.log(`Category: ${item.business.category || 'unknown'}\n`);
  console.log(`Subject: ${item.email.subject}`);
  console.log(`${'─'.repeat(68)}`);
  console.log(wrapText(item.email.body, 68));
  console.log(`${'─'.repeat(68)}\n`);
}

/**
 * Prompt user for action
 * @returns {Promise<string>} User action
 */
async function promptAction() {
  console.log(`Actions:`);
  console.log(`  [a] Approve  - Save template and allow export`);
  console.log(`  [r] Reject   - Block this category from export`);
  console.log(`  [e] Edit     - Modify subject/body before approving`);
  console.log(`  [s] Skip     - Review later`);
  console.log(`  [b] Batch    - Approve all remaining templates`);
  console.log(`  [q] Quit\n`);

  return await prompt('Your choice: ');
}

/**
 * Handle edit action - prompt for new subject/body
 * @param {string} category - Business category
 * @param {Object} currentEmail - Current email content
 * @returns {Promise<Object>} {subject, body}
 */
async function handleEdit(category, currentEmail) {
  console.log(`\n=== EDIT EMAIL ===\n`);
  console.log(`Current subject: ${currentEmail.subject}\n`);

  const newSubject = await prompt('New subject (press Enter to keep current): ');
  const subject = newSubject.trim() || currentEmail.subject;

  console.log(`\nCurrent body:\n${currentEmail.body}\n`);
  console.log(`New body (type 'END' on new line when finished):`);

  const bodyLines = [];
  while (true) {
    const line = await prompt('');
    if (line.trim() === 'END') break;
    bodyLines.push(line);
  }

  const body = bodyLines.length > 0 ? bodyLines.join('\n') : currentEmail.body;

  console.log(`\n✓ Email updated\n`);
  console.log(`Subject: ${subject}`);
  console.log(`Body: ${body.substring(0, 100)}...\n`);

  const confirm = await prompt('Confirm approval? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    return { subject: currentEmail.subject, body: currentEmail.body };
  }

  return { subject, body };
}

/**
 * Process single approval item with interactive prompts
 * @param {string} category - Business category
 * @param {Object} item - Queue item
 * @param {number} index - Current index
 * @param {number} total - Total items
 * @returns {Promise<string>} Action taken
 */
async function processApprovalItem(category, item, index, total) {
  displayApprovalDetail({ ...item, category }, index, total);

  const action = await promptAction();

  switch (action.toLowerCase()) {
    case 'a': // Approve
      approveTemplate(category, 'cli-user');
      console.log(`\n✓ Template approved for category: ${category}\n`);
      return 'approved';

    case 'r': // Reject
      const reason = await prompt('Rejection reason (optional): ');
      rejectTemplate(category, reason);
      console.log(`\n✗ Template rejected for category: ${category}\n`);
      return 'rejected';

    case 'e': // Edit
      const { subject, body } = await handleEdit(category, item.email);
      editAndApproveTemplate(category, subject, body, 'cli-user');
      console.log(`\n✓ Template edited and approved for category: ${category}\n`);
      return 'approved';

    case 's': // Skip
      console.log(`\n⊙ Skipped ${category}\n`);
      return 'skipped';

    case 'b': // Batch approve all
      const confirmBatch = await prompt('Approve ALL remaining templates? (y/n): ');
      if (confirmBatch.toLowerCase() === 'y') {
        const count = approveAllPending('cli-user');
        console.log(`\n✓ Batch approved ${count} templates\n`);
        return 'quit';
      }
      return 'skipped';

    case 'q': // Quit
      return 'quit';

    default:
      console.log(`\nInvalid choice. Please try again.\n`);
      return await processApprovalItem(category, item, index, total);
  }
}

/**
 * Display summary statistics
 * @param {Object} stats - { approved: number, rejected: number, skipped: number }
 */
function displaySummary(stats) {
  console.log(`\n=== APPROVAL SUMMARY ===\n`);
  console.log(`✓ Approved: ${stats.approved}`);
  console.log(`✗ Rejected: ${stats.rejected}`);
  console.log(`⊙ Skipped: ${stats.skipped}\n`);
  console.log(`Next steps:`);
  console.log(`  Run: node ksd/local-outreach/orchestrator/utils/resume-approval.js <location> <postcode>\n`);
}

/**
 * Main entry point - displays menu and handles user input
 */
async function main() {
  const queue = loadApprovalQueue();
  const pending = Object.entries(queue).filter(([cat, item]) => item.status === "pending");

  if (pending.length === 0) {
    console.log("\nNo pending approvals found.\n");
    process.exit(0);
  }

  console.log(`\n=== EMAIL APPROVAL SYSTEM ===\n`);
  console.log(`Found ${pending.length} pending approval${pending.length === 1 ? '' : 's'}:\n`);

  // List all pending approvals
  pending.forEach(([category, item], index) => {
    console.log(`  ${index + 1}. ${category} - ${item.business.name}`);
  });
  console.log();

  const stats = { approved: 0, rejected: 0, skipped: 0 };

  for (let i = 0; i < pending.length; i++) {
    const [category, item] = pending[i];
    const action = await processApprovalItem(category, item, i + 1, pending.length);

    if (action === 'approved') stats.approved++;
    if (action === 'rejected') stats.rejected++;
    if (action === 'skipped') stats.skipped++;
    if (action === 'quit') break;
  }

  displaySummary(stats);
  rl.close();
}

// Run CLI
if (require.main === module) {
  main().catch(err => {
    console.error(`\n✗ Error: ${err.message}\n`);
    rl.close();
    process.exit(1);
  });
}

module.exports = { main };
