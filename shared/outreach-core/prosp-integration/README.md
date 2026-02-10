# Prosp LinkedIn Integration

LinkedIn outreach automation via [Prosp.ai](https://prosp.ai) platform.

## Features

✅ **Add leads to LinkedIn campaigns** - Automatically add business owners to Prosp campaigns
✅ **Send LinkedIn messages** - Send personalized messages via Prosp
✅ **Track replies** - Webhook handlers for reply detection
✅ **Multi-owner support** - Handle businesses with multiple owners
✅ **Custom fields** - Pass business data as custom fields
✅ **Rate limiting** - Built-in delays to avoid LinkedIn limits

---

## Setup

### 1. Environment Variables

Add to `.env`:

```bash
# Prosp API Configuration
PROSP_API_KEY=your_prosp_api_key
PROSP_CAMPAIGN_ID=your_campaign_id
PROSP_LIST_ID=your_contact_list_id
PROSP_SENDER_URL=https://www.linkedin.com/in/your-profile

# Optional
CONTENT_PROVIDER=claude  # or gpt
```

### 2. Get Prosp Credentials

1. **API Key**:
   - Go to Prosp Settings → API
   - Generate new API key
   - Copy to `PROSP_API_KEY`

2. **Campaign ID**:
   - Go to Campaigns → Select campaign
   - Copy campaign ID from URL: `prosp.ai/campaigns/{CAMPAIGN_ID}`

3. **List ID**:
   - Go to Contacts → Lists → Select list
   - Copy list ID from URL

4. **Sender URL**:
   - Your LinkedIn profile URL (the account connected to Prosp)

### 3. Configure Webhooks (Optional)

For reply tracking:

1. Go to Prosp Settings → Webhooks
2. Add webhook URL: `https://your-domain.com/webhooks/prosp`
3. Enable events:
   - `has_msg_replied` (required for reply detection)
   - `send_msg` (optional, for sent tracking)
   - `accept_invite` (optional, for connection tracking)

---

## Usage

### Export Single Business to Prosp

```bash
cd /Users/kobestarr/Downloads/outreach-automation

# Basic export (adds to campaign, campaign auto-sends)
node ksd/local-outreach/orchestrator/utils/export-to-prosp.js "KissDental Bramhall"

# With LinkedIn enrichment first
node ksd/local-outreach/orchestrator/utils/export-to-prosp.js "Dentist Practice"

# Send message immediately (not via campaign flow)
node ksd/local-outreach/orchestrator/utils/export-to-prosp.js "Hair Salon" --send-now

# Dry run (preview without sending)
node ksd/local-outreach/orchestrator/utils/export-to-prosp.js "Restaurant" --dry-run
```

### Programmatic Usage

```javascript
const { sendLinkedInOutreach } = require("./shared/outreach-core/prosp-integration");

// Export business to Prosp campaign
const result = await sendLinkedInOutreach(business, {
  campaignId: "cam_123",
  listId: "list_456",
  sender: "https://www.linkedin.com/in/your-profile",
  sendImmediately: false,  // Campaign auto-sends
});

console.log(`Added ${result.addedToCampaign} owners to campaign`);
console.log(`Sent ${result.messagesSent} messages`);
```

### Check for Replies

```javascript
const { checkLinkedInReplies } = require("./shared/outreach-core/prosp-integration");

const businesses = loadBusinesses({ status: "exported" });

const replies = await checkLinkedInReplies(businesses,
  "https://www.linkedin.com/in/your-profile"
);

replies.forEach(reply => {
  if (reply.hasReplied) {
    console.log(`${reply.ownerName} replied!`);
  }
});
```

---

## Custom Fields Sent to Prosp

When adding leads, these custom fields are automatically populated:

| Field | Source | Example |
|-------|--------|---------|
| `firstName` | `business.ownerFirstName` | "John" |
| `lastName` | `business.ownerLastName` | "Smith" |
| `companyName` | `business.businessName` | "KissDental" |
| `category` | `business.category` | "dentist" |
| `location` | `business.location` | "Bramhall" |
| `website` | `business.website` | "https://kissdental.co.uk" |
| `businessId` | `business.id` | "kissdental-sk71pa-c260c5f9" |
| `offerTier` | `business.assignedOfferTier` | "tier3" |
| `setupFee` | `business.setupFee` | "1500" |
| `monthlyPrice` | `business.monthlyPrice` | "297" |

Use these in Prosp campaign messages with `{{companyName}}`, `{{firstName}}`, etc.

---

## Webhook Handler

If using reply tracking, set up webhook endpoint:

```javascript
const express = require("express");
const { handleProspWebhookMiddleware } = require("./shared/outreach-core/prosp-integration");

const app = express();
app.use(express.json());

// Prosp webhook endpoint
app.post("/webhooks/prosp", handleProspWebhookMiddleware);

app.listen(3000, () => {
  console.log("Webhook server running on port 3000");
});
```

---

## Prosp API Endpoints Used

| Endpoint | Purpose | Docs |
|----------|---------|------|
| `POST /api/v1/leads` | Add lead to contact list + campaign | [Docs](https://prosp.ai/api) |
| `POST /api/v1/leads/send-message` | Send LinkedIn message | [Docs](https://prosp.ai/api) |
| `POST /api/v1/leads/conversation` | Get conversation history | [Docs](https://prosp.ai/api) |
| `POST /api/v1/campaigns/lists` | Get all campaigns | [Docs](https://prosp.ai/api) |
| `POST /api/v1/campaigns/start` | Start campaign | [Docs](https://prosp.ai/api) |
| `POST /api/v1/campaigns/stop` | Stop campaign | [Docs](https://prosp.ai/api) |

---

## Rate Limiting

Built-in rate limiting to avoid LinkedIn restrictions:

- **1 second delay** between processing multiple owners
- **2 seconds delay** before sending immediate messages
- **500ms delay** when checking conversations

**Recommendations:**
- Max 100 connection requests per day
- Max 50 messages per day
- Use campaign auto-send for best results

---

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| `Missing required field: linkedinUrl` | Owner has no LinkedIn URL | Run LinkedIn enrichment first (`--skip-linkedin` not set) |
| `Prosp authentication expired` | LinkedIn account disconnected | Reconnect LinkedIn account in Prosp settings |
| `no permission to message` | Not connected on LinkedIn | Wait for connection acceptance or use connection request |
| `voice not trained` | Voice messaging not set up | Train voice in Prosp settings or use text messages |
| `already in workspace` | Lead already added | Not an error - lead is already in campaign |

---

## Testing

Test with dry run first:

```bash
# Dry run (no API calls)
node ksd/local-outreach/orchestrator/utils/export-to-prosp.js "Test Business" --dry-run

# Test with single business
node ksd/local-outreach/orchestrator/utils/export-to-prosp.js "KissDental Bramhall"

# Check Prosp dashboard
# Verify lead appears in campaign
# Verify custom fields populated correctly
```

---

## Next Steps

1. **Set up Prosp campaign flow** in Prosp UI:
   - Connection request → Wait 2 days → Message 1 → Wait 3 days → Message 2
   - Use `{{firstName}}`, `{{companyName}}` variables

2. **Configure webhooks** for reply tracking

3. **Export businesses to Prosp**:
   ```bash
   node ksd/local-outreach/orchestrator/utils/export-to-prosp.js "Business Name"
   ```

4. **Start campaign** in Prosp dashboard

5. **Monitor replies** via webhooks or Prosp UI

---

## Files Created

- `prosp-client.js` - Core Prosp API client
- `linkedin-outreach.js` - LinkedIn outreach orchestrator
- `webhook-handler.js` - Webhook event handlers
- `index.js` - Main export file
- `../../../ksd/local-outreach/orchestrator/utils/export-to-prosp.js` - CLI export utility

---

**Questions?** Check [Prosp API Docs](https://prosp.ai/api) or contact Prosp support.
