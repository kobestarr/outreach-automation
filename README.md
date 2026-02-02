# Outreach Automation System

Modular AI-powered outreach automation system for KSD, Stripped Media, and Dealflow Media.

## Architecture

### Shared Core Modules (`shared/outreach-core/`)

Reusable modules that can be used across all projects:

- **credentials-loader.js** - Centralized credential management and usage tracking
- **email-verification/** - Reoon API integration with daily limit tracking
- **email-discovery/** - HasData + Icypeas email finding
- **linkedin-enrichment/** - LinkedIn profile enrichment with decision logic
- **content-generation/** - GPT-4 content generation for emails and LinkedIn
- **approval-system/** - Human-in-the-loop approval workflow
- **export-managers/** - Lemlist and Prosp integrations

### Project-Specific Implementations

- **ksd/local-outreach/** - KSD local business outreach (Google Maps, Companies House, revenue estimation)
- **stripped-media/** - Stripped Media implementations (founders, journalists, podcast promotion)
- **dealflow-media/** - Dealflow Media implementations (podcast guest outreach)

## Setup

1. Install dependencies: `npm install`
2. Configure credentials in `/root/.credentials/api-keys.json` (not in repo)
3. Run tests: `node shared/outreach-core/test-modules.js`

## Usage

See individual module READMEs for usage examples.

## Security

- All API keys stored in `/root/.credentials/` (excluded from git)
- Usage tracking for rate-limited services (Icypeas, Reoon)
- Daily limit enforcement
