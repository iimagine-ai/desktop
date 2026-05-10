# Legal Companion Plugin — V1 Spec

## Overview

A paid vertical plugin for lawyers and legal professionals that registers the `legal_matter` project type against the Project Workspace system, provides 40+ pre-loaded prompt templates for common legal workflows, legal-specific entity extraction rules, and a guided practice setup wizard. All client data stays local.

**Lead positioning:** "Your client data never leaves your machine. AI-powered legal workflows with complete attorney-client privilege protection."

**Dependencies:** Cortex Lite (memory) + Project Workspace (project scoping)

---

## Plugin Manifest

```json
{
  "id": "legal-companion",
  "name": "Legal Companion",
  "version": "1.0.0",
  "description": "AI-powered legal workflows with matter management. Contract analysis, document drafting, legal research, time tracking — all with complete client confidentiality.",
  "author": "IIMAGINE",
  "license": "proprietary",
  "price": "subscription",
  "requires": ["cortex-lite", "project-workspace"],
  "hooks": ["chatPreprocess", "chatPostprocess", "sidebar", "settings", "commands"],
  "icon": "scale"
}
```

---

## Guided Practice Setup (First-Run Wizard)

When the plugin is first activated, a 3-step setup wizard collects practice context. This data is stored in the KG and used to personalize all AI responses across matters.

### Step 1: Practice Profile

| Field | Type | Required |
|-------|------|----------|
| Firm name | text | yes |
| Practice areas | multi-select | yes |
| Jurisdictions | multi-text | yes |
| Firm size | select: Solo / 2-5 / 6-20 / 20+ | yes |
| Role | select: Principal / Partner / Associate / Paralegal / In-house Counsel | yes |

**Practice area options:** Corporate & Commercial, Litigation & Disputes, Family Law, Criminal Law, Employment & Workplace, Intellectual Property, Real Estate & Property, Tax, Immigration, Wills & Estates, Personal Injury, Environmental, Construction, Banking & Finance, Insurance, Administrative & Government

### Step 2: Workflow Preferences

| Field | Type | Required |
|-------|------|----------|
| Citation format | select: AGLC4 / Bluebook / OSCOLA / McGill / Custom | no |
| Default document tone | select: Formal / Professional / Plain Language | no |
| Billing model | select: Hourly / Fixed / Mixed / N/A | no |
| Time entry format | text (example: "0.6 — Reviewed contract and identified key risks") | no |

### Step 3: Compliance & Ethics

| Field | Type | Required |
|-------|------|----------|
| Bar association / Law society | text | no |
| Conflict check required | boolean | no |
| Retention policy (years) | number | no |
| Confidentiality protocol notes | textarea | no |

All setup data is stored as KG entities:
- Entity type: `practice_profile` (firm name, size, role)
- Entity type: `practice_area` (one per selected area)
- Entity type: `jurisdiction` (one per jurisdiction)
- Entity type: `preference` (citation format, tone, billing model)

The setup can be re-entered from Settings at any time.

---

## Project Type Registration

The plugin registers `legal_matter` on activate:

```js
context.registerProjectType({
  id: 'legal_matter',
  label: 'Matter',
  labelPlural: 'Matters',
  icon: 'scale',

  fields: [
    { key: 'matter_number', label: 'Matter Number', type: 'text', required: false },
    { key: 'practice_area', label: 'Practice Area', type: 'select', required: true, options: [
      'Corporate & Commercial', 'Litigation & Disputes', 'Family Law', 'Criminal Law',
      'Employment & Workplace', 'Intellectual Property', 'Real Estate & Property',
      'Tax', 'Immigration', 'Wills & Estates', 'Personal Injury', 'Environmental',
      'Construction', 'Banking & Finance', 'Insurance', 'Administrative & Government'
    ]},
    { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: true },
    { key: 'client_name', label: 'Client', type: 'text', required: true },
    { key: 'client_type', label: 'Client Type', type: 'select', options: ['Individual', 'Company', 'Government', 'Not-for-profit', 'Trust'] },
    { key: 'opposing_party', label: 'Opposing Party', type: 'text' },
    { key: 'opposing_counsel', label: 'Opposing Counsel', type: 'text' },
    { key: 'court_tribunal', label: 'Court / Tribunal', type: 'text' },
    { key: 'file_number', label: 'Court File Number', type: 'text' },
    { key: 'billing_type', label: 'Billing', type: 'select', options: ['Hourly', 'Fixed Fee', 'Contingency', 'Pro Bono', 'Legal Aid'] },
    { key: 'next_deadline', label: 'Next Deadline', type: 'date' },
    { key: 'deadline_description', label: 'Deadline Description', type: 'text' },
    { key: 'matter_value', label: 'Matter Value / Amount in Dispute', type: 'text' },
  ],

  documentCategories: [
    'Contract', 'Correspondence', 'Court Filing', 'Memo / Advice',
    'Evidence', 'Research', 'Witness Statement', 'Expert Report',
    'Invoice / Costs', 'Legislation', 'Precedent', 'Client Instructions'
  ],

  outputTypes: [
    { id: 'legal_memo', label: 'Legal Memo / Advice', icon: 'file-text' },
    { id: 'client_letter', label: 'Client Letter', icon: 'mail' },
    { id: 'demand_letter', label: 'Letter of Demand', icon: 'alert-triangle' },
    { id: 'court_letter', label: 'Letter to Court', icon: 'landmark' },
    { id: 'opposing_letter', label: 'Letter to Opposing', icon: 'send' },
    { id: 'contract_draft', label: 'Contract / Agreement', icon: 'file-signature' },
    { id: 'time_entry', label: 'Time Entry', icon: 'clock' },
    { id: 'chronology', label: 'Chronology', icon: 'calendar' },
    { id: 'argument_outline', label: 'Argument Outline', icon: 'list' },
    { id: 'case_summary', label: 'Case Summary', icon: 'book-open' },
    { id: 'issue_analysis', label: 'Issue Analysis', icon: 'search' },
    { id: 'compliance_checklist', label: 'Compliance Checklist', icon: 'check-square' },
    { id: 'discovery_request', label: 'Discovery Request', icon: 'folder-search' },
    { id: 'witness_outline', label: 'Witness Examination Outline', icon: 'users' },
    { id: 'settlement_analysis', label: 'Settlement Analysis', icon: 'handshake' },
  ],

  entityRoles: [
    'client', 'opposing_party', 'opposing_counsel', 'judge', 'magistrate',
    'witness', 'expert_witness', 'mediator', 'barrister', 'instructing_solicitor'
  ],

  statuses: [
    { id: 'intake', label: 'Intake', color: 'blue' },
    { id: 'active', label: 'Active', color: 'green' },
    { id: 'discovery', label: 'Discovery', color: 'cyan' },
    { id: 'negotiation', label: 'Negotiation', color: 'yellow' },
    { id: 'mediation', label: 'Mediation', color: 'orange' },
    { id: 'trial_prep', label: 'Trial Preparation', color: 'red' },
    { id: 'hearing', label: 'Hearing / Trial', color: 'purple' },
    { id: 'awaiting_judgment', label: 'Awaiting Judgment', color: 'indigo' },
    { id: 'settled', label: 'Settled', color: 'teal' },
    { id: 'completed', label: 'Completed', color: 'gray' },
    { id: 'archived', label: 'Archived', color: 'slate' },
  ],

  contextRules: {
    priorityEntities: ['client', 'opposing_party', 'judge'],
    priorityFields: ['practice_area', 'jurisdiction', 'next_deadline'],
    maxDocumentsInContext: 5,
  },

  extractionRules: {
    entityTypes: ['deadline', 'court_date', 'limitation_period', 'legal_issue', 'statute', 'precedent', 'obligation'],
    autoLinkToProject: true,
  },
});
```

---

## Prompt Templates (40 templates across 7 categories)

### Category 1: Contract & Document Work (8 templates)

| ID | Label | Description |
|----|-------|-------------|
| `contract_review` | Contract Review | Analyze a contract for risks, missing terms, ambiguities, and unusual clauses |
| `contract_comparison` | Contract Comparison | Compare two versions of a contract and identify all changes |
| `clause_drafting` | Clause Drafting | Draft a specific contract clause based on requirements |
| `nda_generation` | NDA / Confidentiality Agreement | Generate a non-disclosure agreement based on party details and scope |
| `lease_review` | Lease Review Checklist | Review a lease agreement against a standard checklist of key terms |
| `terms_conditions` | Terms & Conditions | Draft website/service terms and conditions |
| `engagement_letter` | Engagement Letter | Draft a client engagement letter with scope, fees, and terms |
| `deed_of_release` | Deed of Release | Draft a deed of release / settlement deed |

### Category 2: Legal Research & Analysis (7 templates)

| ID | Label | Description |
|----|-------|-------------|
| `case_summary` | Case Summary | Summarize a case: facts, issues, holding, reasoning, significance |
| `statutory_interpretation` | Statutory Interpretation | Explain a statutory provision in plain language with relevant case law |
| `jurisdiction_comparison` | Jurisdiction Comparison | Compare how different jurisdictions handle a legal issue |
| `issue_spotting` | Issue Spotting | Identify all legal issues from a set of facts |
| `precedent_analysis` | Precedent Analysis | Analyze whether a precedent applies to the current facts |
| `legislative_update` | Legislative Update Summary | Summarize recent legislative changes relevant to a practice area |
| `risk_assessment` | Legal Risk Assessment | Assess legal risks in a proposed transaction or course of action |

### Category 3: Correspondence (7 templates)

| ID | Label | Description |
|----|-------|-------------|
| `demand_letter` | Letter of Demand | Draft a formal letter of demand |
| `client_update` | Client Update Letter | Draft a status update letter to the client |
| `opposing_counsel_letter` | Letter to Opposing Counsel | Draft correspondence to opposing counsel |
| `court_letter` | Letter to Court / Registry | Draft a letter to the court or tribunal registry |
| `advice_letter` | Advice Letter | Draft a structured advice letter (issue, analysis, recommendation, caveats) |
| `plain_language_explainer` | Plain Language Explainer | Translate legal concepts into plain language for a client |
| `fee_estimate` | Fee Estimate Letter | Draft a fee estimate or costs disclosure |

### Category 4: Litigation & Advocacy (7 templates)

| ID | Label | Description |
|----|-------|-------------|
| `chronology_builder` | Chronology Builder | Build a structured timeline from case facts |
| `argument_builder` | Argument Builder | Construct a structured legal argument with counterarguments |
| `discovery_request` | Discovery Request | Draft interrogatories or notice to produce |
| `motion_outline` | Motion / Application Outline | Outline a motion or interlocutory application |
| `witness_examination` | Witness Examination Outline | Prepare examination-in-chief or cross-examination questions |
| `submissions_outline` | Written Submissions Outline | Structure written submissions for a hearing |
| `settlement_analysis` | Settlement Analysis | Analyze settlement options with risk/reward assessment |

### Category 5: Client Intake & Management (5 templates)

| ID | Label | Description |
|----|-------|-------------|
| `intake_questions` | Client Intake Questions | Generate intake questions based on practice area and matter type |
| `conflict_check` | Conflict Check Memo | Document a conflict check analysis |
| `file_note` | File Note | Generate a structured file note from meeting/call notes |
| `matter_summary` | Matter Summary (Handoff) | Generate a comprehensive matter summary for handoff |
| `closing_letter` | Matter Closing Letter | Draft a matter completion / closing letter to client |

### Category 6: Time & Billing (3 templates)

| ID | Label | Description |
|----|-------|-------------|
| `time_entry` | Time Entry Generator | Convert a description of work into a formatted time entry |
| `invoice_narrative` | Invoice Narrative | Generate a narrative description of work for an invoice |
| `costs_estimate` | Costs Estimate | Estimate costs for a phase of work based on matter complexity |

### Category 7: Compliance & Regulatory (3 templates)

| ID | Label | Description |
|----|-------|-------------|
| `compliance_checklist` | Compliance Checklist | Generate a compliance checklist for a specific regulatory requirement |
| `regulatory_summary` | Regulatory Summary | Summarize regulatory obligations for a client's industry/activity |
| `due_diligence_checklist` | Due Diligence Checklist | Generate a due diligence checklist for a transaction type |

---

## Legal-Specific Entity Extraction

The plugin extends Cortex Lite's extraction with legal-specific entity types:

### Extraction Prompt Addition

When chatting within a legal matter, the extraction prompt includes:

```
Additionally, extract any legal-specific information:
- deadlines: { description, date, type: "filing" | "limitation" | "compliance" | "court" | "contractual" }
- legal_issues: { description, area_of_law, relevant_statutes }
- precedents: { case_name, citation, principle, relevance }
- obligations: { party, description, due_date, status }
- statutes: { name, section, jurisdiction }
- court_dates: { date, type: "hearing" | "trial" | "mediation" | "directions", location }
```

### Deadline Tracking

Extracted deadlines are:
1. Stored as KG entities linked to the matter
2. Surfaced in the project detail header (next deadline)
3. Available for a "Deadlines" view across all matters (future enhancement)

---

## Conflict Check Helper

A utility accessible from the project list or via the `/conflict` command:

1. User types a name (person or company)
2. Plugin searches the entire KG for matching or related entities
3. Returns: exact matches, partial matches, related entities (e.g., same company, same matter)
4. User can review and confirm no conflict exists
5. Result can be saved as a `conflict_check` output in the matter

---

## Chat Commands (Slash Commands)

The plugin registers these commands accessible via `/` in chat:

| Command | Action |
|---------|--------|
| `/matter` | Switch active matter context (shows matter picker) |
| `/new-matter` | Create a new matter (opens create dialog) |
| `/template` | Open prompt template picker (filtered to legal templates) |
| `/time` | Quick time entry — describe what you did, AI formats it |
| `/conflict` | Run a conflict check against a name |
| `/deadline` | Add a deadline to the current matter |
| `/summarize` | Generate a summary of the current matter based on all context |
| `/export` | Export the current matter (timeline + outputs + summaries) |

---

## Context Injection (Legal-Specific)

When chatting within a matter, the system prompt includes:

```
[Legal Practice Context]
You are assisting a {role} at {firm_name}, a {firm_size} firm.
Practice areas: {practice_areas}
Jurisdictions: {jurisdictions}
Citation format: {citation_format}
Document tone: {tone_preference}

[Active Matter: {matter_name}]
Practice Area: {practice_area}
Jurisdiction: {jurisdiction}
Client: {client_name} ({client_type})
Opposing: {opposing_party}
Court: {court_tribunal} (File: {file_number})
Status: {status}
Next Deadline: {next_deadline} — {deadline_description}
Value: {matter_value}

Key entities:
{linked_entities_list}

Indexed documents ({doc_count}):
{document_summaries}

Recent outputs:
{recent_outputs_list}

IMPORTANT: You are providing legal workflow assistance, not legal advice.
All outputs are drafts for the lawyer's review. Never present AI output as
final legal advice. Always note assumptions and flag areas requiring
professional judgment.
[End Context]
```

---

## Settings Panel

The plugin's settings page shows:

- **Practice Profile** — Edit firm name, practice areas, jurisdictions, role
- **Preferences** — Citation format, tone, billing model, time entry format
- **Statistics** — Total matters, active matters, documents indexed, outputs generated
- **Templates** — View/edit prompt templates, create custom templates
- **Extraction** — Toggle legal entity extraction on/off, view extracted deadlines
- **Data** — Export all data, clear plugin data (with confirmation)

---

## File Structure

```
plugins/legal-companion/
├── plugin.json              ← manifest
├── index.js                 ← entry point (activate, deactivate, hooks)
├── setup-wizard.js          ← guided practice setup (3 steps)
├── project-type.js          ← registerProjectType() config
├── templates/
│   ├── contracts.js         ← contract & document templates
│   ├── research.js          ← legal research templates
│   ├── correspondence.js    ← letter templates
│   ├── litigation.js        ← litigation & advocacy templates
│   ├── intake.js            ← client intake templates
│   ├── billing.js           ← time & billing templates
│   └── compliance.js        ← compliance templates
├── extraction.js            ← legal-specific entity extraction rules
├── conflict-check.js        ← conflict check utility
├── commands.js              ← slash command handlers
├── context-builder.js       ← legal context injection logic
└── ui.js                    ← settings panel + setup wizard HTML
```

---

## Implementation Tasks

### Task 1: Plugin Scaffold
- [ ] Create `plugins/legal-companion/plugin.json` manifest
- [ ] Create `plugins/legal-companion/index.js` with activate/deactivate
- [ ] Register hooks: chatPreprocess, chatPostprocess, sidebar, settings, commands
- [ ] Verify plugin loads, activates, and depends on cortex-lite + project-workspace
- [ ] Handle graceful error if dependencies not installed

### Task 2: Practice Setup Wizard
- [ ] Build 3-step wizard UI (Practice Profile, Workflow Preferences, Compliance)
- [ ] Store setup data as KG entities via Cortex Lite's API
- [ ] Show wizard on first activation (detect if setup complete via KG query)
- [ ] Allow re-entry from Settings
- [ ] Save progress between steps (user can quit and resume)

### Task 3: Project Type Registration
- [ ] Implement `project-type.js` with full `registerProjectType()` config
- [ ] Call registration in `activate()`
- [ ] Verify matter creation form renders all custom fields
- [ ] Verify statuses, document categories, and output types appear correctly

### Task 4: Prompt Templates
- [ ] Implement all 40 templates across 7 category files
- [ ] Each template includes: id, label, category, description, prompt text, required_inputs
- [ ] Register templates with the project workspace's template picker
- [ ] Templates should reference matter context variables (e.g., `{{client_name}}`, `{{jurisdiction}}`)
- [ ] Test each template category produces useful output

### Task 5: Legal Entity Extraction
- [ ] Extend Cortex Lite's extraction prompt with legal-specific types
- [ ] Implement extraction for: deadlines, legal_issues, precedents, obligations, statutes, court_dates
- [ ] Auto-link extracted entities to active matter
- [ ] Store deadlines with structured date + type fields
- [ ] Log extraction events to matter timeline

### Task 6: Context Builder
- [ ] Build `context-builder.js` that assembles legal-specific context
- [ ] Include practice profile + active matter metadata + entities + docs + outputs
- [ ] Add the legal disclaimer ("workflow assistance, not legal advice")
- [ ] Respect token budget (practice context + matter context combined)
- [ ] Hook into chatPreprocess to inject context

### Task 7: Slash Commands
- [ ] Implement `/matter` — matter switcher
- [ ] Implement `/new-matter` — opens create dialog
- [ ] Implement `/template` — template picker filtered to legal
- [ ] Implement `/time` — quick time entry generator
- [ ] Implement `/conflict` — conflict check
- [ ] Implement `/deadline` — add deadline to matter
- [ ] Implement `/summarize` — generate matter summary
- [ ] Implement `/export` — export matter package

### Task 8: Conflict Check
- [ ] Build `conflict-check.js` utility
- [ ] Search KG for exact name matches across all matters
- [ ] Search for partial matches and related entities
- [ ] Return structured results: matches found, related entities, recommendation
- [ ] Allow saving result as a project output

### Task 9: Settings Panel
- [ ] Build settings UI with sections: Profile, Preferences, Statistics, Templates, Data
- [ ] Statistics pulled from project workspace DB (matter count, doc count, output count)
- [ ] Template editor (view, edit prompt text, create custom)
- [ ] Data export (all plugin data as JSON/markdown)
- [ ] Clear data with double-confirmation

### Task 10: Testing & Validation
- [ ] Test full flow: install plugin → setup wizard → create matter → chat with context → generate output
- [ ] Test template generation for each category (at least 1 per category)
- [ ] Test entity extraction (deadlines, precedents, obligations detected correctly)
- [ ] Test conflict check (finds matches across matters)
- [ ] Test context injection (matter context appears in AI responses)
- [ ] Test with different models (Gemma, Llama, Mistral) — model-agnostic
- [ ] Test matter export produces complete package
- [ ] Test plugin disable/re-enable (data persists, no corruption)

---

## Prompt Template Format (Example)

```js
// templates/correspondence.js
module.exports = [
  {
    id: 'demand_letter',
    label: 'Letter of Demand',
    category: 'Correspondence',
    description: 'Draft a formal letter of demand for payment or action',
    requiredInputs: ['amount_or_action', 'basis_for_claim', 'deadline_to_comply'],
    prompt: `Draft a formal Letter of Demand with the following structure:

**Context:**
- Client: {{client_name}}
- Opposing Party: {{opposing_party}}
- Jurisdiction: {{jurisdiction}}
- Matter: {{matter_name}}

**Requirements:**
- Amount/Action demanded: {{amount_or_action}}
- Legal basis: {{basis_for_claim}}
- Deadline to comply: {{deadline_to_comply}}

**Format:**
1. Formal letterhead format (firm name, date, reference)
2. Clear statement of who you act for
3. Background facts (concise)
4. Legal basis for the demand
5. Specific demand (amount or action required)
6. Deadline for compliance
7. Consequences of non-compliance
8. Without prejudice reservation (if applicable)
9. Professional sign-off

**Tone:** Firm but professional. Avoid inflammatory language.
**Citation format:** {{citation_format}}

Generate the complete letter as a draft for review.`
  },
  // ... more templates
];
```

---

## What's NOT in V1 (Future Enhancements)

| Feature | Why deferred |
|---------|-------------|
| Court filing integration | Too jurisdiction-specific, too many APIs |
| Billing system sync | Too many systems (LEAP, Clio, Actionstep, etc.) |
| Legal research DB access | Westlaw/LexisNexis APIs expensive and restricted |
| Automated deadline calculation | Liability risk — limitation periods vary by jurisdiction |
| Multi-user / team features | Single-user desktop app in v1 |
| Document comparison (visual diff) | Complex UI, defer to v2 |
| Precedent database | Requires curated content, defer to v2 |
| Voice dictation for time entries | Requires speech-to-text integration |
| Calendar integration for court dates | Requires OS calendar API |
| Cross-matter reporting / analytics | Defer to v2 when there's enough data |

---

## Pricing & Positioning

- **Price:** Subscription via IIMAGINE web app (monthly or annual)
- **Position:** "Less than one billable hour per month" — target $29-49/month
- **Trial:** 14 days full access
- **Value prop:** Save 5-10 hours per week on document drafting, research summaries, and time entries. That's $1,000-5,000/month in recovered billable time for a single lawyer.

---

## Privacy & Ethics Compliance

- All data stored locally in encrypted SQLite (SQLCipher)
- No client names, matter details, or documents ever transmitted
- AI outputs are explicitly labelled as drafts requiring professional review
- The plugin never presents itself as providing legal advice
- Conflict check is a convenience tool — does not replace proper conflict procedures
- Extraction of deadlines is informational — does not replace a proper diary system
- Users are reminded that AI can hallucinate and all outputs must be verified

---

## Success Metrics

- **Activation:** 30% of Cortex Lite subscribers try the Legal Companion trial
- **Conversion:** 10% of trial users convert to paid
- **Engagement:** Average user creates 3+ matters within first month
- **Retention:** 80% monthly retention after first 3 months
- **Template usage:** Average 5+ template generations per week per active user
- **Target:** 100 paying subscribers within 6 months of launch
