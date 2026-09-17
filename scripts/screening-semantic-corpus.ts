import type {
  ScreeningSemanticExpectation,
  ScreeningSemanticLabInput,
} from '../src/dossier/screening-semantic-lab';

export interface ScreeningSemanticCorpusCase {
  id: string;
  role: string;
  input: ScreeningSemanticLabInput;
  expected: ScreeningSemanticExpectation;
  scored: boolean;
  note: string;
}

const singleQuote = (text: string) => [{ id: 'Q1', text }];
const required = (
  requirement: string,
  text: string,
  roleImportance: 'CORE_CAPABILITY' | 'ENABLER' = 'CORE_CAPABILITY',
): ScreeningSemanticLabInput => ({
  requirement: { requirement, strength: 'REQUIRED', roleImportance },
  quoteCatalog: singleQuote(text),
});
const preferred = (
  requirement: string,
  text: string,
  roleImportance: 'CORE_CAPABILITY' | 'ENABLER' = 'ENABLER',
): ScreeningSemanticLabInput => ({
  requirement: { requirement, strength: 'PREFERRED', roleImportance },
  quoteCatalog: singleQuote(text),
});

export const screeningSemanticCorpus: ScreeningSemanticCorpusCase[] = [
  {
    id: 'spice-tenure-5-8', role: 'Product Growth Head - Spice Money', scored: true,
    input: required('5 to 8 years of experience', 'Job Title: Product Growth Head - Spice Money. Location: Noida. Experience: 5 to 8 Years.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'MINIMUM_TENURE' },
    note: 'Explicit experience-duration doorway.',
  },
  {
    id: 'spice-degree-top-tier', role: 'Product Growth Head - Spice Money', scored: true,
    input: required('B.Tech or Post Graduate degree from a Top Tier Institute', 'Education: B.Tech/Post Graduate from Top Tier Institute.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'MANDATORY_CREDENTIAL' },
    note: 'Formal educational credential.',
  },
  {
    id: 'spice-data-tools', role: 'Product Growth Head - Spice Money', scored: true,
    input: required('Proficiency in data-driven growth tools including Google Sheets, Tableau, CRM dashboards, and Excel-based modeling', 'Strong command over digital communication tools, user segmentation and campaign management. Proficiency in data-driven growth: Google Sheets, Tableau, CRM dashboards, Excel-based modeling.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Tool proficiency is a performance capability, not a credential.',
  },
  {
    id: 'cargill-total-tenure', role: 'R&D Leader - Health & Nutrition', scored: true,
    input: required('10-18 years of total experience', 'R&D Leader - Health & Nutrition. Experience: 10-18 Yrs. Skills: Research and Development, New Product Development.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'MINIMUM_TENURE' },
    note: 'Explicit duration threshold.',
  },
  {
    id: 'cargill-degree', role: 'R&D Leader - Health & Nutrition', scored: true,
    input: required("Bachelor's degree in Food Science & Technology or Pharma", 'New Product Development. Bachelors degree in Food Science & Technology or in Pharma with minimum 10 years of experience in food & beverage or Pharma industry. MINIMUM QUALIFICATIONS.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'MANDATORY_CREDENTIAL' },
    note: 'Degree under minimum qualifications.',
  },
  {
    id: 'cargill-industry-tenure', role: 'R&D Leader - Health & Nutrition', scored: true,
    input: required('Minimum 10 years of experience in food & beverage or Pharma industry', 'Bachelors degree in Food Science & Technology or in Pharma with minimum 10 years of experience in food & beverage or Pharma industry. MINIMUM QUALIFICATIONS.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'MINIMUM_TENURE' },
    note: 'Explicit minimum duration.',
  },
  {
    id: 'cargill-rd-skills', role: 'R&D Leader - Health & Nutrition', scored: true,
    input: required('Research and Development skills', 'Skills: Research and Development, New Product Development.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Skill statement has no entry doorway semantics.',
  },
  {
    id: 'cargill-npd-skills', role: 'R&D Leader - Health & Nutrition', scored: true,
    input: required('New Product Development skills', 'Skills: Research and Development, New Product Development.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Original v4 false-positive gate.',
  },
  {
    id: 'remote-marketing-tenure', role: 'Marketing Professional (Remote)', scored: true,
    input: required('5+ years of professional experience in marketing or advertising with a focus on strategic evaluation and creative judgment', 'Required Skills & Qualifications: 5+ years of professional experience in marketing or advertising with a focus on strategic evaluation and creative judgment.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'MINIMUM_TENURE' },
    note: 'Explicit tenure threshold under required qualifications.',
  },
  {
    id: 'remote-evaluate-deliverables', role: 'Marketing Professional (Remote)', scored: true,
    input: required('Fluency in evaluating marketing deliverables such as creative briefs, campaign concepts, brand positioning, and ad copy against defined briefs and objectives', 'Fluency in evaluating marketing deliverables such as creative briefs, campaign concepts, brand positioning, and ad copy against defined briefs and objectives.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Performance capability.',
  },
  {
    id: 'remote-written-communication', role: 'Marketing Professional (Remote)', scored: true,
    input: required('Exceptionally strong written communication skills with the ability to articulate precise, evidence-based reasons for scoring decisions', 'Exceptionally strong written communication skills with the ability to articulate precise, evidence-based reasons for scoring decisions.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Communication capability.',
  },
  {
    id: 'digital-specialist-passion', role: 'Digital Marketing Specialist', scored: true,
    input: required('Passion for Digital Marketing and eagerness to learn', 'Passion for Digital Marketing and eagerness to learn.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Work style/motivation wording is not an entry basis.',
  },
  {
    id: 'digital-specialist-understanding', role: 'Digital Marketing Specialist', scored: true,
    input: required('Basic understanding of social media platforms and digital marketing concepts', 'Basic understanding of social media platforms and digital marketing concepts.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Knowledge requirement.',
  },
  {
    id: 'digital-specialist-communication', role: 'Digital Marketing Specialist', scored: true,
    input: required('Good communication skills', 'Good communication skills.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Performance skill.',
  },
  {
    id: 'digital-exec-proficiency', role: 'Digital Marketing Executive', scored: true,
    input: required('Proficiency in Google Ads, Facebook Ads, SEO tools, and Google Analytics', 'Proficiency in Google Ads, Facebook Ads, SEO tools, and Google Analytics.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Tool proficiency is not a formal credential.',
  },
  {
    id: 'digital-exec-communication', role: 'Digital Marketing Executive', scored: true,
    input: required('Excellent written and verbal communication skills', 'Excellent written and verbal communication skills.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Performance skill.',
  },
  {
    id: 'digital-exec-channel-understanding', role: 'Digital Marketing Executive', scored: true,
    input: required('Good understanding of online marketing channels and strategies', 'Good understanding of online marketing channels and strategies.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Knowledge/capability.',
  },
  {
    id: 'digital-exec-content-creation', role: 'Digital Marketing Executive', scored: true,
    input: required('Basic content creation skills (e.g., Canva, copywriting)', 'Basic content creation skills (e.g., Canva, copywriting).', 'ENABLER'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Role capability.',
  },
  {
    id: 'travel-ppc-tenure', role: 'Digital Marketing Specialist - Travel PPC', scored: true,
    input: required('2–5 years of hands-on experience in PPC/Performance Marketing', 'Required Skills: 2–5 years of hands-on experience in PPC / Performance Marketing.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'MINIMUM_TENURE' },
    note: 'Explicit duration in required-skills doorway.',
  },
  {
    id: 'travel-google-bing-expertise', role: 'Digital Marketing Specialist - Travel PPC', scored: true,
    input: required('Strong expertise in Google Ads and Microsoft Ads/Bing Ads', 'The ideal candidate should have strong expertise in Google Ads, Microsoft Ads/Bing Ads, and Meta Ads, along with a solid understanding of conversion tracking, campaign optimization, keyword research, and performance metrics.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Expertise/capability without an explicit entry condition.',
  },
  {
    id: 'travel-meta-knowledge', role: 'Digital Marketing Specialist - Travel PPC', scored: true,
    input: required('Working knowledge of Meta Ads', 'Working knowledge of Meta Ads.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Knowledge requirement.',
  },
  {
    id: 'travel-inbound-call-experience', role: 'Digital Marketing Specialist - Travel PPC', scored: true,
    input: required('Experience generating inbound calls for flight bookings, cancellations, changes, car rentals, cruises, or hotels', 'Required Skills: Experience generating inbound calls for flight bookings, cancellations, changes, car rentals, cruises, or hotels.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'PRIOR_RELEVANT_EXPERIENCE' },
    note: 'Explicit prior experience in required-skills context.',
  },
  {
    id: 'travel-us-market-campaigns', role: 'Digital Marketing Specialist - Travel PPC', scored: true,
    input: required('Experience managing campaigns targeting the US market', 'Required Skills: Experience managing campaigns targeting the US market.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'PRIOR_RELEVANT_EXPERIENCE' },
    note: 'Prior experience framed as required skill.',
  },
  {
    id: 'travel-search-understanding', role: 'Digital Marketing Specialist - Travel PPC', scored: true,
    input: required('Strong understanding of search campaigns, call campaigns, remarketing, audience targeting, and bidding strategies', 'Strong understanding of search campaigns, call campaigns, remarketing, audience targeting, and bidding strategies.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Knowledge/capability.',
  },
  {
    id: 'travel-keyword-knowledge', role: 'Digital Marketing Specialist - Travel PPC', scored: true,
    input: required('Strong knowledge of keyword research, match types, negative keywords, ad copy, and campaign optimization', 'Strong knowledge of keyword research, match types, negative keywords, ad copy, and campaign optimization.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Knowledge/capability.',
  },
  {
    id: 'travel-ga4-gtm', role: 'Digital Marketing Specialist - Travel PPC', scored: true,
    input: required('Knowledge of GA4, Google Tag Manager, and conversion/call tracking', 'Required Skills: Knowledge of GA4, Google Tag Manager, and conversion/call tracking.', 'ENABLER'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Original v4 credential false positive.',
  },
  {
    id: 'travel-analytical', role: 'Digital Marketing Specialist - Travel PPC', scored: true,
    input: required('Strong analytical and problem-solving skills', 'Strong analytical and problem-solving skills.', 'ENABLER'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Performance capability.',
  },
  {
    id: 'travel-budget-ability', role: 'Digital Marketing Specialist - Travel PPC', scored: true,
    input: required('Ability to work with large campaign budgets and performance targets', 'Ability to work with large campaign budgets and performance targets.', 'ENABLER'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Role-performance expectation.',
  },
  {
    id: 'travel-call-lead-preferred', role: 'Digital Marketing Specialist - Travel PPC', scored: true,
    input: preferred('Experience with call-based lead generation', 'Preferred: Experience with call-based lead generation.', 'CORE_CAPABILITY'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Preferred cannot gate.',
  },
  {
    id: 'travel-us-travel-preferred', role: 'Digital Marketing Specialist - Travel PPC', scored: true,
    input: preferred('Preference for experience within the US travel industry', 'Preference for experience within the US travel industry.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Explicit preference cannot gate.',
  },
  {
    id: 'change-tenure', role: 'Associate Director, Change Management', scored: true,
    input: required('5–10 years of experience in Change Management', 'Skills & Capabilities (Must-Have) — Change & Transformation: 5–10 years of experience in Change Management, preferably in technology-led or digital transformation programs.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'MINIMUM_TENURE' },
    note: 'Explicit duration in must-have section.',
  },
  {
    id: 'change-framework-grounding', role: 'Associate Director, Change Management', scored: true,
    input: {
      requirement: { requirement: 'Strong grounding in change frameworks (Prosci, ADKAR, or equivalent) with ability to apply pragmatically', strength: 'REQUIRED', roleImportance: 'CORE_CAPABILITY' },
      quoteCatalog: [
        { id: 'Q1', text: 'Skills & Capabilities (Must-Have) — Change & Transformation: Strong grounding in change frameworks (Prosci,' },
        { id: 'Q2', text: 'ADKAR, or equivalent) with the ability to apply pragmatically, not theoretically.' },
      ],
    },
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Must-have capability is not automatically prior-experience doorway.',
  },
  {
    id: 'change-technical-comfort', role: 'Associate Director, Change Management', scored: true,
    input: required('Strong comfort engaging with technical concepts (digital platforms, AI, automation)', 'Strong comfort engaging with technical concepts (digital platforms, AI, automation).'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Capability/comfort wording.',
  },
  {
    id: 'change-masters-degree', role: 'Associate Director, Change Management', scored: true,
    input: required("Master's degree in business, Change Management, Organizational Psychology, HR, Technology Management, or a related field", "Qualifications: Master's degree in business, Change Management, Organizational Psychology, HR, Technology Management, or a related field."),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'MANDATORY_CREDENTIAL' },
    note: 'Formal degree under Qualifications.',
  },
  {
    id: 'change-certification-preferred', role: 'Associate Director, Change Management', scored: true,
    input: preferred('Change certifications (Prosci, APMG, etc.)', 'Preferred Qualifications: Change certifications (Prosci, APMG, etc.).'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Preferred formal credential still cannot gate.',
  },
  {
    id: 'change-consulting-preferred', role: 'Associate Director, Change Management', scored: true,
    input: preferred('Prior experience in consulting or transformation-heavy environments', 'Preferred Qualifications: Prior experience in consulting or transformation-heavy environments.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Preferred prior experience cannot gate.',
  },

  // Challenge cases are deliberately excluded from the headline score. They expose
  // where product semantics still need a human policy decision rather than hiding
  // ambiguity behind a benchmark label.
  {
    id: 'challenge-digital-exec-hands-on', role: 'Digital Marketing Executive', scored: false,
    input: required('Hands-on experience in paid advertising, SEO, and social media management', 'Profile Summary: We are seeking a skilled performance-driven Digital Marketing Executive with hands-on experience in paid advertising, SEO, and social media management.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Challenge: experience phrasing appears in descriptive profile summary rather than an explicit qualification doorway.',
  },
  {
    id: 'challenge-digital-exec-proven-ads', role: 'Digital Marketing Executive', scored: false,
    input: required('Proven experience in Meta Ads and Google Ads campaigns', 'Knowledge & Skills — Experience: Proven experience in Meta Ads and Google Ads campaigns.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'PRIOR_RELEVANT_EXPERIENCE' },
    note: 'Challenge: explicit experience field but capability-heavy content.',
  },
  {
    id: 'challenge-digital-exec-graduate', role: 'Digital Marketing Executive', scored: false,
    input: required('Graduate degree or equivalent in a related field', 'Knowledge & Skills — Education: Graduate or any related field.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'MANDATORY_CREDENTIAL' },
    note: 'Challenge: source wording is grammatically weak but appears in an Education field.',
  },
  {
    id: 'challenge-travel-industry-experience', role: 'Digital Marketing Specialist - Travel PPC', scored: false,
    input: required('Experience in US Travel / Flight Booking / OTA / Travel Sales industry', 'Required Skills: Experience in the US Travel / Flight Booking / OTA / Travel Sales industry.', 'ENABLER'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'PRIOR_RELEVANT_EXPERIENCE' },
    note: 'Challenge: industry background in required-skills section.',
  },
  {
    id: 'challenge-change-dts-experience', role: 'Associate Director, Change Management', scored: false,
    input: required('Proven experience working with DTS, Digital, Data, or Technology teams', 'Skills & Capabilities (Must-Have) — Digital & Technology Orientation: Proven experience working with DTS, Digital, Data, or Technology teams.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'PRIOR_RELEVANT_EXPERIENCE' },
    note: 'Challenge: retrospective experience in a must-have section.',
  },
  {
    id: 'challenge-change-agile-integration', role: 'Associate Director, Change Management', scored: false,
    input: required('Experience integrating change into agile / product-based delivery models', 'Skills & Capabilities (Must-Have): Experience integrating change into agile / product-based delivery models.'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'PRIOR_RELEVANT_EXPERIENCE' },
    note: 'Challenge: clear retrospective experience but could still describe performance capability.',
  },
  {
    id: 'challenge-change-ma-exposure', role: 'Associate Director, Change Management', scored: false,
    input: required('Exposure to Tech-enabled M&A (technology separation, integration, or value creation)', 'Skills & Capabilities (Must-Have): Exposure to Tech-enabled M&A (technology separation, integration, or value creation).', 'ENABLER'),
    expected: { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'PRIOR_RELEVANT_EXPERIENCE' },
    note: 'Challenge: exposure can be prior background but strength as entry criterion is contextual.',
  },
  {
    id: 'challenge-change-ai-adoption', role: 'Associate Director, Change Management', scored: false,
    input: required('Experience supporting adoption of AI, GenAI, or Agentic AI', 'Skills & Capabilities (Must-Have): Experience supporting adoption of AI, GenAI, or Agentic AI.'),
    expected: { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE' },
    note: 'Challenge: experience phrasing for a capability adjacent to the role mandate.',
  },
];
