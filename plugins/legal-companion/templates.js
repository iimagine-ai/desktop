// Legal Companion — Prompt Templates
// 40 templates across 7 categories for common legal workflows

const TEMPLATES = [
  // ── Category 1: Contract & Document Work ──────────────────────
  {
    id: 'contract_review',
    label: 'Contract Review',
    category: 'Contracts',
    description: 'Analyze a contract for risks, missing terms, ambiguities, and unusual clauses',
    prompt: `Review the following contract and provide a structured analysis:

1. **Key Terms Summary** — parties, dates, obligations, consideration
2. **Risk Flags** — clauses that are unusual, one-sided, or potentially problematic
3. **Missing Terms** — standard clauses that are absent (termination, dispute resolution, force majeure, etc.)
4. **Ambiguities** — language that could be interpreted multiple ways
5. **Recommendations** — specific changes or additions to negotiate

Context: {{practice_area}} matter in {{jurisdiction}} for client {{client_name}}.
Citation format: {{citation_format}}. Tone: {{document_tone}}.

Contract text to review:
`,
  },
  {
    id: 'clause_drafting',
    label: 'Clause Drafting',
    category: 'Contracts',
    description: 'Draft a specific contract clause based on requirements',
    prompt: `Draft a contract clause with the following requirements. Provide 2-3 alternative versions ranging from protective to balanced.

Context: {{practice_area}} matter in {{jurisdiction}}.
Citation format: {{citation_format}}.

Clause requirements:
`,
  },
  {
    id: 'nda_generation',
    label: 'NDA / Confidentiality Agreement',
    category: 'Contracts',
    description: 'Generate a non-disclosure agreement',
    prompt: `Draft a Non-Disclosure Agreement (NDA) with the following parameters:

- Disclosing Party: {{client_name}}
- Jurisdiction: {{jurisdiction}}
- Type: [mutual/one-way]

Include: definition of confidential information, obligations, exclusions, term, remedies, governing law, dispute resolution.

Provide as a complete draft ready for review.
`,
  },
  {
    id: 'engagement_letter',
    label: 'Engagement Letter',
    category: 'Contracts',
    description: 'Draft a client engagement letter',
    prompt: `Draft a client engagement letter for:

- Firm: {{firm_name}}
- Client: {{client_name}}
- Matter: {{matter_name}}
- Practice Area: {{practice_area}}
- Billing: {{billing_type}}
- Jurisdiction: {{jurisdiction}}

Include: scope of work, fees and billing, client obligations, communication expectations, termination, file retention, conflicts disclosure.

Tone: {{document_tone}}.
`,
  },

  // ── Category 2: Legal Research & Analysis ─────────────────────
  {
    id: 'case_summary',
    label: 'Case Summary',
    category: 'Research',
    description: 'Summarize a case: facts, issues, holding, reasoning, significance',
    prompt: `Provide a structured case summary using this format:

1. **Citation** — full citation
2. **Court** — which court decided this
3. **Facts** — key facts (concise)
4. **Issues** — legal questions before the court
5. **Holding** — what the court decided
6. **Reasoning** — key reasoning and principles applied
7. **Significance** — why this case matters, how it's been applied since
8. **Relevance to Current Matter** — how this applies to {{matter_name}} ({{practice_area}}, {{jurisdiction}})

Case to summarize:
`,
  },
  {
    id: 'issue_spotting',
    label: 'Issue Spotting',
    category: 'Research',
    description: 'Identify all legal issues from a set of facts',
    prompt: `Analyze the following facts and identify ALL legal issues. For each issue:

1. **Issue** — state the legal question
2. **Relevant Law** — applicable legislation, common law principles, or regulations
3. **Application** — how the law applies to these facts
4. **Strength** — strong/moderate/weak for our client ({{client_name}})
5. **Further Investigation** — what additional facts or research is needed

Practice Area: {{practice_area}}
Jurisdiction: {{jurisdiction}}
Acting for: {{client_name}}

Facts:
`,
  },
  {
    id: 'statutory_interpretation',
    label: 'Statutory Interpretation',
    category: 'Research',
    description: 'Explain a statutory provision in plain language with relevant case law',
    prompt: `Interpret the following statutory provision:

1. **Plain Language Explanation** — what this section means in everyday language
2. **Key Definitions** — defined terms and their scope
3. **Elements** — what must be proven/satisfied
4. **Relevant Case Law** — key cases interpreting this provision
5. **Practical Application** — how this applies to {{practice_area}} matters in {{jurisdiction}}
6. **Common Pitfalls** — mistakes practitioners make with this section

Statutory provision:
`,
  },
  {
    id: 'risk_assessment',
    label: 'Legal Risk Assessment',
    category: 'Research',
    description: 'Assess legal risks in a proposed transaction or course of action',
    prompt: `Conduct a legal risk assessment for the following proposed action/transaction:

For each identified risk:
- **Risk** — description
- **Likelihood** — high/medium/low
- **Impact** — high/medium/low
- **Mitigation** — how to reduce or eliminate the risk
- **Residual Risk** — risk remaining after mitigation

Context: {{practice_area}}, {{jurisdiction}}, client: {{client_name}}

Proposed action/transaction:
`,
  },

  // ── Category 3: Correspondence ────────────────────────────────
  {
    id: 'demand_letter',
    label: 'Letter of Demand',
    category: 'Correspondence',
    description: 'Draft a formal letter of demand',
    prompt: `Draft a formal Letter of Demand:

- From: {{firm_name}} (acting for {{client_name}})
- To: {{opposing_party}}
- Jurisdiction: {{jurisdiction}}

Structure:
1. Formal letterhead (firm name, date, reference: {{matter_name}})
2. Statement of who we act for
3. Background facts (concise)
4. Legal basis for the demand
5. Specific demand (amount or action)
6. Deadline for compliance
7. Consequences of non-compliance
8. Without prejudice reservation (if applicable)
9. Professional sign-off

Tone: Firm but professional. Avoid inflammatory language.

Details of the demand:
`,
  },
  {
    id: 'client_update',
    label: 'Client Update Letter',
    category: 'Correspondence',
    description: 'Draft a status update letter to the client',
    prompt: `Draft a client update letter:

- To: {{client_name}}
- From: {{firm_name}}
- Re: {{matter_name}}
- Tone: {{document_tone}}

Include:
1. Current status of the matter
2. Recent developments
3. Next steps and timeline
4. Any decisions needed from the client
5. Costs update (if applicable)

Keep it clear and avoid unnecessary jargon. The client should understand exactly where things stand.

Update details:
`,
  },
  {
    id: 'advice_letter',
    label: 'Advice Letter',
    category: 'Correspondence',
    description: 'Draft a structured advice letter',
    prompt: `Draft a formal advice letter:

- To: {{client_name}}
- From: {{firm_name}}
- Re: {{matter_name}} — [topic of advice]
- Jurisdiction: {{jurisdiction}}
- Citation format: {{citation_format}}

Structure:
1. **Summary of Advice** — 2-3 sentence executive summary
2. **Background** — facts as we understand them
3. **Issues** — legal questions addressed
4. **Analysis** — application of law to facts
5. **Advice** — clear recommendations
6. **Caveats** — limitations, assumptions, areas of uncertainty
7. **Next Steps** — recommended actions

Tone: {{document_tone}}. Include appropriate disclaimers.

Topic and facts for advice:
`,
  },
  {
    id: 'opposing_counsel_letter',
    label: 'Letter to Opposing Counsel',
    category: 'Correspondence',
    description: 'Draft correspondence to opposing counsel',
    prompt: `Draft a letter to opposing counsel:

- From: {{firm_name}} (acting for {{client_name}})
- To: {{opposing_counsel}} (acting for {{opposing_party}})
- Re: {{matter_name}}
- Court/File: {{court_tribunal}} {{file_number}}

Tone: Professional and measured. Maintain courtesy while being firm on substance.

Purpose and content of the letter:
`,
  },

  // ── Category 4: Litigation & Advocacy ─────────────────────────
  {
    id: 'chronology_builder',
    label: 'Chronology Builder',
    category: 'Litigation',
    description: 'Build a structured timeline from case facts',
    prompt: `Build a chronology table from the following facts:

Format: | Date | Event | Source/Evidence | Significance |

Rules:
- Chronological order
- Include source document for each entry where known
- Flag gaps in the timeline
- Note any inconsistencies between sources
- Highlight critical dates (limitation periods, deadlines, key events)

Matter: {{matter_name}}
Practice Area: {{practice_area}}

Facts to organize:
`,
  },
  {
    id: 'argument_builder',
    label: 'Argument Builder',
    category: 'Litigation',
    description: 'Construct a structured legal argument with counterarguments',
    prompt: `Build a structured legal argument:

**Our Position** (acting for {{client_name}}):
1. Proposition — state the legal principle
2. Authority — case law and legislation supporting it
3. Application — how it applies to our facts
4. Conclusion — what follows

**Anticipated Counterarguments** (from {{opposing_party}}):
For each counterargument:
1. Their likely argument
2. Our response/rebuttal
3. Authority for our rebuttal

**Weaknesses in Our Case:**
- Identify honestly and suggest how to address

Jurisdiction: {{jurisdiction}}
Citation format: {{citation_format}}

Issue to argue:
`,
  },
  {
    id: 'submissions_outline',
    label: 'Written Submissions Outline',
    category: 'Litigation',
    description: 'Structure written submissions for a hearing',
    prompt: `Outline written submissions for a hearing:

- Matter: {{matter_name}}
- Court: {{court_tribunal}} (File: {{file_number}})
- Acting for: {{client_name}} ({{client_type}})
- Against: {{opposing_party}}
- Jurisdiction: {{jurisdiction}}

Structure:
1. **Introduction** — nature of application, orders sought
2. **Background Facts** — agreed and contested facts
3. **Issues** — questions for determination
4. **Submissions** — argument on each issue with authorities
5. **Orders Sought** — specific relief requested

Citation format: {{citation_format}}

Nature of hearing and key issues:
`,
  },
  {
    id: 'settlement_analysis',
    label: 'Settlement Analysis',
    category: 'Litigation',
    description: 'Analyze settlement options with risk/reward assessment',
    prompt: `Provide a settlement analysis:

- Matter: {{matter_name}}
- Client: {{client_name}}
- Opposing: {{opposing_party}}
- Value: {{matter_value}}

Analyze:
1. **Best Case** — what we could achieve at trial
2. **Worst Case** — what we risk at trial
3. **Likely Outcome** — realistic assessment
4. **Costs to Trial** — estimated legal costs remaining
5. **Settlement Range** — recommended range with reasoning
6. **Non-Monetary Terms** — other terms to negotiate
7. **Recommendation** — settle or proceed, with reasoning

Current offer/situation:
`,
  },

  // ── Category 5: Client Intake & Management ────────────────────
  {
    id: 'intake_questions',
    label: 'Client Intake Questions',
    category: 'Intake',
    description: 'Generate intake questions based on practice area',
    prompt: `Generate a comprehensive client intake questionnaire for:

- Practice Area: {{practice_area}}
- Jurisdiction: {{jurisdiction}}
- Client Type: [individual/company]

Include:
1. Personal/entity details
2. Matter-specific questions (tailored to practice area)
3. Urgency and timeline questions
4. Document checklist (what to bring/provide)
5. Conflict check information
6. Costs disclosure questions

Format as a structured questionnaire the client can fill out.

Specific matter type:
`,
  },
  {
    id: 'conflict_check_memo',
    label: 'Conflict Check Memo',
    category: 'Intake',
    description: 'Document a conflict check analysis',
    prompt: `Document a conflict check for:

- Prospective Client: [name]
- Prospective Matter: {{matter_name}}
- Opposing Parties: {{opposing_party}}
- Related Entities: [list any related persons/companies]

Check against:
- Current clients
- Former clients (within retention period)
- Related entities and associates

Format:
1. Parties searched
2. Results (matches found / no matches)
3. Analysis (if matches found — is there an actual conflict?)
4. Recommendation (accept / decline / seek consent / information barrier)
5. Sign-off

Names to check:
`,
  },
  {
    id: 'matter_summary',
    label: 'Matter Summary (Handoff)',
    category: 'Intake',
    description: 'Generate a comprehensive matter summary for handoff',
    prompt: `Generate a comprehensive matter summary for handoff purposes:

- Matter: {{matter_name}}
- Practice Area: {{practice_area}}
- Client: {{client_name}}
- Status: Current status
- Jurisdiction: {{jurisdiction}}

Include:
1. **Overview** — what this matter is about (2-3 sentences)
2. **Key Parties** — all relevant parties and their roles
3. **Current Status** — where things stand right now
4. **Key Dates** — deadlines, hearing dates, limitation periods
5. **Key Documents** — critical documents and where to find them
6. **Outstanding Issues** — what needs to be done next
7. **Client Instructions** — what the client wants
8. **Risks** — key risks to be aware of
9. **Costs** — billing status and estimates

This should give someone picking up the file everything they need to continue.
`,
  },

  // ── Category 6: Time & Billing ────────────────────────────────
  {
    id: 'time_entry',
    label: 'Time Entry Generator',
    category: 'Billing',
    description: 'Convert a description of work into a formatted time entry',
    prompt: `Convert the following description of work into a professional time entry:

Format: [units] — [description]
Example: 0.6 — Reviewed and annotated contract; identified 3 key risk areas for client discussion

Rules:
- Use 6-minute units (0.1 = 6 mins, 0.5 = 30 mins, 1.0 = 60 mins)
- Be specific but concise
- Use professional language (no first person)
- Include the outcome or purpose of the work
- Matter: {{matter_name}}

Work performed:
`,
  },
  {
    id: 'invoice_narrative',
    label: 'Invoice Narrative',
    category: 'Billing',
    description: 'Generate a narrative description of work for an invoice',
    prompt: `Generate a professional invoice narrative summarizing the following work:

- Matter: {{matter_name}}
- Client: {{client_name}}
- Period: [date range]
- Billing type: {{billing_type}}

The narrative should:
- Summarize work performed in professional language
- Group related tasks logically
- Demonstrate value to the client
- Be suitable for inclusion on a tax invoice

Work entries to summarize:
`,
  },

  // ── Category 7: Compliance & Regulatory ───────────────────────
  {
    id: 'compliance_checklist',
    label: 'Compliance Checklist',
    category: 'Compliance',
    description: 'Generate a compliance checklist for a specific requirement',
    prompt: `Generate a compliance checklist for:

- Regulation/Requirement: [specify]
- Jurisdiction: {{jurisdiction}}
- Entity Type: {{client_type}}
- Client: {{client_name}}

Format:
| # | Requirement | Status | Evidence Required | Deadline | Notes |

Include:
- All mandatory requirements
- Recommended best practices
- Common areas of non-compliance
- Penalties for non-compliance

Regulation to check against:
`,
  },
  {
    id: 'due_diligence_checklist',
    label: 'Due Diligence Checklist',
    category: 'Compliance',
    description: 'Generate a due diligence checklist for a transaction',
    prompt: `Generate a due diligence checklist for:

- Transaction Type: [acquisition/merger/investment/joint venture]
- Target: {{opposing_party}}
- Jurisdiction: {{jurisdiction}}
- Practice Area: {{practice_area}}

Categories to cover:
1. Corporate/constitutional documents
2. Financial records
3. Material contracts
4. Employment/HR
5. Intellectual property
6. Real property
7. Litigation and disputes
8. Regulatory compliance
9. Insurance
10. Tax

For each item: document required, priority (critical/important/nice-to-have), status.

Transaction details:
`,
  },
];

function getAll() {
  return TEMPLATES;
}

function getByCategory(category) {
  return TEMPLATES.filter(t => t.category === category);
}

function getById(id) {
  return TEMPLATES.find(t => t.id === id);
}

function getCategories() {
  return [...new Set(TEMPLATES.map(t => t.category))];
}

// Replace template variables with matter/profile context
function fillTemplate(templateId, matterData, profileData) {
  const template = getById(templateId);
  if (!template) return null;

  let prompt = template.prompt;
  const vars = {
    practice_area: matterData?.practice_area || 'General',
    jurisdiction: matterData?.jurisdiction || profileData?.jurisdictions?.[0] || 'Not specified',
    client_name: matterData?.client_name || 'Client',
    client_type: matterData?.client_type || 'Not specified',
    opposing_party: matterData?.opposing_party || 'Opposing Party',
    opposing_counsel: matterData?.opposing_counsel || 'Opposing Counsel',
    court_tribunal: matterData?.court_tribunal || 'Court',
    file_number: matterData?.file_number || '',
    billing_type: matterData?.billing_type || profileData?.billing_model || 'Hourly',
    matter_name: matterData?.name || 'Current Matter',
    matter_value: matterData?.matter_value || 'Not specified',
    firm_name: profileData?.firm_name || 'Our Firm',
    citation_format: profileData?.citation_format || 'AGLC4',
    document_tone: profileData?.document_tone || 'Professional',
  };

  for (const [key, val] of Object.entries(vars)) {
    prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
  }

  return { ...template, prompt };
}

module.exports = { getAll, getByCategory, getById, getCategories, fillTemplate };
