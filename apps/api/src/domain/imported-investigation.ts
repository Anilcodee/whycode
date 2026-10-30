import { z } from 'zod';

const optionalText = z.string().optional();
const evidence = z.object({
  id: z.string(), type: z.string(), title: z.string(), relationToAnswer: z.string(), graphPath: z.array(z.string()),
  excerpt: optionalText, url: optionalText, author: optionalText, date: optionalText, state: optionalText,
  revision: optionalText, current: z.boolean().optional(),
}).passthrough();

/** Old browser data is untrusted and must satisfy the fields used by the result UI. */
export const importedInvestigation = z.object({
  repositoryId: z.string().min(1).max(200), question: z.string().min(1).max(500),
  answer: z.string().nullable(), abstained: z.boolean(), abstentionReason: optionalText,
  evidence: z.array(evidence).max(200), citedEvidenceIds: z.array(z.string()).max(200),
  confidence: z.object({ label: z.string(), reason: z.string() }).passthrough(),
  temporalStatus: z.string(), temporalReason: optionalText, answeredAt: z.iso.datetime(),
  warnings: z.array(z.string()).max(100), language: optionalText, translatedAnswer: optionalText,
  decisionTimeline: z.array(z.object({ evidenceId: z.string(), title: z.string(), date: optionalText, url: optionalText, type: z.string() }).passthrough()).max(200),
  validation: z.object({ status: z.string(), reason: z.string(), claims: z.array(z.object({ text: z.string(), evidenceIds: z.array(z.string()), quotes: z.array(z.object({ evidenceId: z.string(), quote: z.string() }).passthrough()) }).passthrough()) }).passthrough().optional(),
  externalContext: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() }).passthrough()).optional(),
}).passthrough();
