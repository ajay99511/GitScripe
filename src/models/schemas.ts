import { z } from 'zod';

// ─── API Request Schemas ─────────────────────────────────

export const RegisterRepoSchema = z.object({
  githubUrl: z
    .string()
    .url()
    .regex(/github\.com\/[\w.-]+\/[\w.-]+/, 'Must be a valid GitHub repository URL'),
  branch: z.string().min(1).default('main'),
});

export const TriggerSyncSchema = z.object({
  repoId: z.string().uuid(),
});

export const ChatQuerySchema = z.object({
  question: z.string().min(1).max(2000),
  repoId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── LLM Output Schemas ─────────────────────────────────

export const DiffAnalysisOutputSchema = z.object({
  filesChanged: z.array(
    z.object({
      path: z.string(),
      changeType: z.enum(['added', 'modified', 'deleted', 'renamed']),
      additions: z.number().int().default(0),
      deletions: z.number().int().default(0),
      summary: z.string(),
    })
  ),
  functionsModified: z.array(z.string()),
  linesAdded: z.number().int(),
  linesRemoved: z.number().int(),
  rawSummary: z.string(),
});

export const SummaryDraftOutputSchema = z.object({
  shortSummary: z.string(),
  detailedSummary: z.string(),
  inferredIntent: z.string(),
  fileSummaries: z.record(z.string(), z.string()),
  moduleSummaries: z.record(z.string(), z.string()),
  tags: z.array(z.string()),
  riskLevel: z.enum(['low', 'medium', 'high']),
});

// ─── Type exports from schemas ───────────────────────────

export type RegisterRepoInput = z.infer<typeof RegisterRepoSchema>;
export type ChatQueryInput = z.infer<typeof ChatQuerySchema>;
export type PaginationInput = z.infer<typeof PaginationSchema>;
export type DiffAnalysisOutput = z.infer<typeof DiffAnalysisOutputSchema>;
export type SummaryDraftOutput = z.infer<typeof SummaryDraftOutputSchema>;
