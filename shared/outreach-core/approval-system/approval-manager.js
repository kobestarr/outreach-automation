/**
 * Approval Manager
 * Human-in-the-loop approval system for first email of each business type
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const APPROVAL_QUEUE_PATH = path.join(DATA_DIR, "approval-queue.json");
const APPROVED_TEMPLATES_PATH = path.join(DATA_DIR, "approved-templates.json");

/**
 * Check if email needs approval (first of business type)
 */
function needsApproval(business, approvedTemplates) {
  const category = (business.category || "unknown").toLowerCase();
  return !approvedTemplates[category];
}

/**
 * Add email to approval queue
 */
function addToApprovalQueue(business, emailContent) {
  const queue = loadApprovalQueue();
  
  const category = (business.category || "unknown").toLowerCase();
  
  if (!queue[category]) {
    queue[category] = {
      business: {
        name: business.businessName || business.name,
        category: business.category,
        location: business.location || business.address,
        ownerFirstName: business.ownerFirstName,
        owners: business.owners || [] // Multi-owner support for Lemlist export
      },
      email: {
        subject: emailContent.subject,
        body: emailContent.body
      },
      status: "pending",
      createdAt: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null
    };
    
    saveApprovalQueue(queue);
  }
  
  return queue[category];
}

/**
 * Approve email template for category
 */
function approveTemplate(category, approvedBy = "system") {
  const queue = loadApprovalQueue();
  const templates = loadApprovedTemplates();
  
  if (queue[category] && queue[category].status === "pending") {
    queue[category].status = "approved";
    queue[category].approvedAt = new Date().toISOString();
    queue[category].approvedBy = approvedBy;
    
    templates[category] = {
      subject: queue[category].email.subject,
      body: queue[category].email.body,
      approvedAt: queue[category].approvedAt,
      approvedBy: approvedBy
    };
    
    saveApprovalQueue(queue);
    saveApprovedTemplates(templates);
    
    return true;
  }
  
  return false;
}

/**
 * Reject email template for category
 */
function rejectTemplate(category, reason) {
  const queue = loadApprovalQueue();
  
  if (queue[category]) {
    queue[category].status = "rejected";
    queue[category].rejectedAt = new Date().toISOString();
    queue[category].rejectionReason = reason;
    
    saveApprovalQueue(queue);
    return true;
  }
  
  return false;
}

/**
 * Load approval queue
 */
function loadApprovalQueue() {
  try {
    if (fs.existsSync(APPROVAL_QUEUE_PATH)) {
      const data = fs.readFileSync(APPROVAL_QUEUE_PATH, "utf8");
      return JSON.parse(data);
    }
    return {};
  } catch (error) {
    // Log error for debugging but return empty queue to allow system to continue
    console.error('[approval-manager] Failed to load approval queue:', error.message);
    return {};
  }
}

/**
 * Save approval queue
 */
function saveApprovalQueue(queue) {
  const dir = path.dirname(APPROVAL_QUEUE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(APPROVAL_QUEUE_PATH, JSON.stringify(queue, null, 2));
}

/**
 * Load approved templates
 */
function loadApprovedTemplates() {
  try {
    if (fs.existsSync(APPROVED_TEMPLATES_PATH)) {
      const data = fs.readFileSync(APPROVED_TEMPLATES_PATH, "utf8");
      return JSON.parse(data);
    }
    return {};
  } catch (error) {
    // Log error for debugging but return empty templates to allow system to continue
    console.error('[approval-manager] Failed to load approved templates:', error.message);
    return {};
  }
}

/**
 * Save approved templates
 */
function saveApprovedTemplates(templates) {
  const dir = path.dirname(APPROVED_TEMPLATES_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(APPROVED_TEMPLATES_PATH, JSON.stringify(templates, null, 2));
}

/**
 * Get pending approvals
 */
function getPendingApprovals() {
  const queue = loadApprovalQueue();
  return Object.entries(queue)
    .filter(([category, item]) => item.status === "pending")
    .map(([category, item]) => ({ category, ...item }));
}

/**
 * Edit and approve a template with new content
 * @param {string} category - Business category
 * @param {string} newSubject - Updated email subject
 * @param {string} newBody - Updated email body
 * @param {string} approvedBy - Name/identifier of approver (default: "system")
 * @returns {boolean} Success status
 */
function editAndApproveTemplate(category, newSubject, newBody, approvedBy = "system") {
  const queue = loadApprovalQueue();
  const templates = loadApprovedTemplates();

  if (!queue[category] || queue[category].status !== "pending") {
    return false;
  }

  // Update email content in queue
  queue[category].email.subject = newSubject;
  queue[category].email.body = newBody;
  queue[category].status = "approved";
  queue[category].approvedAt = new Date().toISOString();
  queue[category].approvedBy = approvedBy;
  queue[category].edited = true;

  // Save to approved templates
  templates[category] = {
    subject: newSubject,
    body: newBody,
    approvedAt: queue[category].approvedAt,
    approvedBy: approvedBy,
    edited: true
  };

  saveApprovalQueue(queue);
  saveApprovedTemplates(templates);

  return true;
}

/**
 * Batch approve all pending templates
 * @param {string} approvedBy - Name/identifier of approver
 * @returns {number} Number of templates approved
 */
function approveAllPending(approvedBy = "system") {
  const queue = loadApprovalQueue();
  let approvedCount = 0;

  for (const [category, item] of Object.entries(queue)) {
    if (item.status === "pending") {
      const success = approveTemplate(category, approvedBy);
      if (success) approvedCount++;
    }
  }

  return approvedCount;
}

/**
 * Get approval queue item by category
 * @param {string} category - Business category
 * @returns {Object|null} Queue item or null
 */
function getQueueItem(category) {
  const queue = loadApprovalQueue();
  return queue[category] || null;
}

module.exports = {
  needsApproval,
  addToApprovalQueue,
  approveTemplate,
  rejectTemplate,
  loadApprovalQueue,
  loadApprovedTemplates,
  getPendingApprovals,
  editAndApproveTemplate,
  approveAllPending,
  getQueueItem
};
