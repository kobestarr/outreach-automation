---
name: Database-Backed Email Template System
overview: Create a database-backed email template system where templates are generated once per category+tier combination, stored in the database, and then personalized with business-specific details. This dramatically reduces API costs and allows direct database editing for tweaks.
todos:
  - id: create_template_schema
    content: Add email_templates table to database.js with CRUD functions
    status: pending
  - id: create_template_applier
    content: Create email-template-applier.js to load and apply templates with placeholders
    status: pending
  - id: create_template_generator
    content: Create generate-email-templates.js script to generate templates once per category+tier
    status: pending
  - id: update_email_generator
    content: Modify gpt-email-generator.js to use templates first, fallback to OpenAI
    status: pending
  - id: create_template_manager
    content: Create manage-email-templates.js CLI for viewing/editing templates
    status: pending
  - id: generate_initial_templates
    content: Generate initial templates for restaurant category (all tiers, all 3 sequence positions) as proof of concept
    status: pending
  - id: add_signature_support
    content: Ensure all templates include 'Sent from my iPhone' signature and preserve line breaks
    status: pending
  - id: add_guarantee_offer
    content: Add ultra low-risk guarantee/offer to Email 1 templates
    status: pending
  - id: update_sequence_to_3
    content: Change email sequence from 4 emails to 3 emails throughout system
    status: pending
isProject: false
---

# Database-Backed Email Template System

## Overview

Store email templates in the database (one per category × tier combination), generate them once with OpenAI, then reuse and personalize with business-specific details. This makes email generation much faster, cheaper, and allows direct database editing for tweaks.

## Architecture

### Template Storage

- One template per `category` × `tier` combination
- Template contains placeholders for personalization: `{ownerFirstName}`, `{businessName}`, `{location}`, `{rating}`, `{jtbdFear}`, etc.
- Stored in new `email_templates` table

### Generation Flow

1. **One-time generation**: Use OpenAI to create template for each category+tier combo
2. **Storage**: Save template in database with placeholders
3. **Reuse**: For each business, load template and replace placeholders
4. **Personalization**: Apply business-specific data (name, location, rating, etc.)

### Benefits

- Generate once per category+tier (e.g., 7 categories × 5 tiers = 35 templates)
- Reuse thousands of times without API calls
- Direct database editing for quick tweaks
- Much faster (no API latency)
- Much cheaper (35 API calls vs thousands)

## Database Schema

### New Table: `email_templates`

```sql
CREATE TABLE email_templates (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  tier_id TEXT NOT NULL,
  tier_name TEXT NOT NULL,
  sequence_position INTEGER NOT NULL,  -- 1, 2, or 3 (3-email sequence)
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT DEFAULT 'system',
  notes TEXT,
  UNIQUE(category, tier_id, sequence_position)
);

CREATE INDEX idx_email_templates_category_tier ON email_templates(category, tier_id);
CREATE INDEX idx_email_templates_sequence ON email_templates(sequence_position);
```

**Template Format:**

- Subject template: `"Quick question about {businessName}"`
- Body template: `"Hi {ownerFirstName},\n\nI noticed {businessName} in {location}...\n\n{signature}"`
- Line breaks (`\n`) must be preserved for proper email formatting
- Signature: Always ends with `"\n\nSent from my iPhone"`

**Placeholders:**

- `{ownerFirstName}` - Owner's first name
- `{businessName}` - Business name
- `{location}` - Location/city
- `{postcode}` - Postcode
- `{rating}` - Rating (or "excellent" if null)
- `{reviewCount}` - Number of reviews
- `{jtbdFear}` - Job-to-be-done fear
- `{leadMagnet}` - Lead magnet name
- `{category}` - Business category
- `{barterMention}` - Optional barter mention (only if barter available)
- `{guarantee}` - Ultra low-risk guarantee/offer
- `{signature}` - Always "\n\nSent from my iPhone"

## Implementation Plan

### Phase 1: Database Schema

**File:** `ksd/local-outreach/orchestrator/modules/database.js`

Add:

- `initEmailTemplatesTable()` - Create table if not exists
- `saveEmailTemplate(template)` - Save template to database (includes sequence_position)
- `getEmailTemplate(category, tierId, sequencePosition)` - Retrieve template for specific sequence position
- `getEmailSequence(category, tierId)` - Retrieve all 3 templates for a sequence
- `updateEmailTemplate(id, updates)` - Update template (for editing)
- `listEmailTemplates(filters)` - List all templates

### Phase 2: Template Generator

**File:** `ksd/local-outreach/orchestrator/utils/generate-email-templates.js`

Script to:

1. Generate templates for all category × tier combinations
2. Use OpenAI to create template with placeholders
3. Save to database
4. Can be run once or re-run to regenerate

**Template Generation Prompt:**

```
Create an email template for a UK {category} business owner in {tierName} tier.

Requirements:
- Use placeholders: {ownerFirstName}, {businessName}, {location}, {rating}, {jtbdFear}
- 3-5 sentences, 60-80 words
- UK tone, British English
- Low-pressure CTA

Output format:
Subject: [template with placeholders]
Body: [template with placeholders]
```

### Phase 3: Template Application

**File:** `ksd/local-outreach/orchestrator/modules/email-template-applier.js`

Functions to:

- `loadTemplate(category, tierId, sequencePosition)` - Load from database
- `loadSequence(category, tierId)` - Load all 3 templates for sequence
- `applyTemplate(template, businessData)` - Replace placeholders, preserve line breaks
- `handleBarterMention(template, businessData)` - Add barter if available
- `handleRating(template, businessData)` - Format rating appropriately
- `addSignature(body)` - Ensure "Sent from my iPhone" signature is present
- `formatEmailBody(body)` - Preserve line breaks, ensure proper formatting

### Phase 4: Update Email Generator

**File:** `shared/outreach-core/content-generation/gpt-email-generator.js`

Modify `generateEmailContent()` to:

1. Check if template exists in database for category+tier+sequencePosition
2. If exists: Load template and apply personalization
3. If not exists: Fall back to OpenAI generation (and optionally save as template)

Modify `generateEmailSequence()` to:

1. Generate 3 emails instead of 4
2. Use templates for each sequence position (1, 2, 3)
3. Ensure signature "Sent from my iPhone" is added
4. Preserve line breaks in email body

**New functions:**

- `generateEmailFromTemplate(businessData, sequencePosition)`
- `generateSequenceFromTemplates(businessData)` - Generate all 3 emails from templates

### Phase 5: Template Management

**File:** `ksd/local-outreach/orchestrator/utils/manage-email-templates.js`

CLI tool for:

- List all templates
- View specific template
- Edit template directly (update database)
- Regenerate template (re-run OpenAI)
- Delete template

## Template Examples

### Restaurant - Tier 2 Template

**Subject Template:**

```
Quick question about {businessName}
```

**Body Template (Email 1):**

```
Hi {ownerFirstName},

I noticed {businessName} in {location} and your {rating} rating shows strong customer satisfaction. As a restaurant owner, I reckon you're focused on {jtbdFear}.

I've got an ultra low-risk way to help - {guarantee}. Fancy a quick chat over a cuppa?

Sent from my iPhone
```

**Body Template (Email 2):**

```
Hi {ownerFirstName},

Just following up on my last message about {businessName}. I've helped similar restaurants in {location} with {jtbdFear} - happy to share a quick example if useful.

Fancy a brief chat?

Sent from my iPhone
```

**Body Template (Email 3):**

```
Hi {ownerFirstName},

Last message about {businessName} - no worries if it's not the right time. If you change your mind about {jtbdFear}, drop me a line.

All the best,

Sent from my iPhone
```

## Files to Create/Modify

1. **`ksd/local-outreach/orchestrator/modules/database.js`** (MODIFY)

   - Add email_templates table schema
   - Add template CRUD functions

2. **`ksd/local-outreach/orchestrator/modules/email-template-applier.js`** (NEW)

   - Template loading and application
   - Placeholder replacement logic
   - Barter/rating handling

3. **`ksd/local-outreach/orchestrator/utils/generate-email-templates.js`** (NEW)

   - One-time template generation script
   - Uses OpenAI to create templates
   - Saves to database

4. **`ksd/local-outreach/orchestrator/utils/manage-email-templates.js`** (NEW)

   - CLI for template management
   - View, edit, regenerate templates

5. **`shared/outreach-core/content-generation/gpt-email-generator.js`** (MODIFY)

   - Add template-based generation option
   - Fallback to OpenAI if no template

## Workflow

### Initial Setup

1. Run `generate-email-templates.js` once
2. Generates 105 templates (7 categories × 5 tiers × 3 sequence positions)
3. Stores in database
4. Each template includes "Sent from my iPhone" signature
5. Email 1 templates include ultra low-risk guarantee/offer

### Daily Usage

1. Business comes in with category + tier
2. Load template from database
3. Apply business-specific data
4. Send email (no API call needed)

### Template Updates

1. Edit directly in database via `manage-email-templates.js`
2. Or regenerate specific template with OpenAI
3. Changes apply to all future emails using that template

## Success Criteria

- Templates stored in database (one per category × tier × sequence position = 105 templates)
- 3-email sequence instead of 4
- Email formatting preserved (line breaks maintained)
- "Sent from my iPhone" signature always present
- Ultra low-risk offer/guarantee in Email 1
- Template application works correctly
- Placeholder replacement accurate
- Barter/rating handling appropriate
- Direct database editing possible
- Much faster than API calls
- Much cheaper (105 API calls vs thousands)
- Fallback to OpenAI if template missing

## Migration Strategy

1. Create database schema
2. Generate initial templates (can be done gradually)
3. Update email generator to use templates
4. Keep OpenAI fallback for missing templates
5. Gradually populate all templates
6. Eventually remove OpenAI dependency (optional)