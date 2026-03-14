import pino from 'pino';
import { BaseAgent } from './BaseAgent.js';
import { DiffAnalysisOutputSchema } from '../models/schemas.js';
import type { DiffAnalysis } from '../models/types.js';
import { preprocessDiff } from '../utils/diffPreprocessor.js';

const logger = pino({ name: 'DiffAnalyzerAgent' });

const SYSTEM_PROMPT = `You are a senior code reviewer. Your job is to analyze a git diff and produce a structured JSON analysis.

Be precise about file paths. For functionsModified, list function/method names that were added, modified, or deleted.
If the diff is for non-code files (configs, docs, etc.), still describe the changes accurately.`;

const USER_PROMPT_TEMPLATE = `Analyze this git diff and produce a structured JSON analysis:

Commit Message: {{commitMessage}}

Diff:
\`\`\`
{{diff}}
\`\`\``;

/**
 * Agent that parses a raw git diff into structured analysis:
 * files changed, functions modified, line counts, and a summary.
 */
export class DiffAnalyzerAgent extends BaseAgent {
  /**
   * Analyze a git diff, returning structured analysis.
   * For large diffs, chunks the text and merges results.
   */
  async analyze(diff: string, commitMessage: string): Promise<DiffAnalysis> {
    // Preprocess: strip noise, skip lock files, collapse context lines
    const { diff: cleanDiff, skippedFiles, originalBytes, processedBytes } = preprocessDiff(diff);

    if (skippedFiles.length > 0) {
      logger.debug({ skippedFiles, originalBytes, processedBytes }, 'Preprocessed diff — skipped noise files');
    }

    // If preprocessing removed everything meaningful, return a minimal analysis
    if (!cleanDiff.trim()) {
      logger.info({ skippedFiles }, 'Diff contained only noise files — skipping LLM analysis');
      return {
        filesChanged: skippedFiles.map((path) => ({
          path,
          changeType: 'modified' as const,
          additions: 0,
          deletions: 0,
          summary: 'Dependency/lock file update (skipped)',
        })),
        functionsModified: [],
        linesAdded: 0,
        linesRemoved: 0,
        rawSummary: `Dependency or generated file update: ${skippedFiles.join(', ')}`,
      };
    }

    const chunks = this.chunkText(cleanDiff);
    logger.info({ chunks: chunks.length, originalBytes, processedBytes }, 'Analyzing diff');

    if (chunks.length === 1) {
      return this.analyzeSingle(chunks[0], commitMessage);
    }

    // Process chunks sequentially to avoid firing N parallel LLM calls for large diffs.
    // The merge cost is negligible; the token/RPM savings are significant.
    const results: DiffAnalysis[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const result = await this.analyzeSingle(
        chunks[i]!,
        `${commitMessage} (part ${i + 1} of ${chunks.length})`
      );
      results.push(result);
    }

    return this.mergeAnalyses(results);
  }

  private async analyzeSingle(
    diff: string,
    commitMessage: string
  ): Promise<DiffAnalysis> {
    try {
      const prompt = this.buildPrompt(USER_PROMPT_TEMPLATE, {
        commitMessage,
        diff,
      });

      const structuredModel = this.chatModel.withStructuredOutput(DiffAnalysisOutputSchema, { name: 'diff_analysis' });
      
      const response = await structuredModel.invoke([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ]);
      
      return response as DiffAnalysis;
    } catch (error) {
      logger.error({ error }, 'Failed to parse LLM structured output');
      // Return a minimal fallback analysis
      return {
        filesChanged: [],
        functionsModified: [],
        linesAdded: 0,
        linesRemoved: 0,
        rawSummary: 'Analysis failed — unable to parse LLM response.',
      };
    }
  }

  private mergeAnalyses(analyses: DiffAnalysis[]): DiffAnalysis {
    const merged: DiffAnalysis = {
      filesChanged: [],
      functionsModified: [],
      linesAdded: 0,
      linesRemoved: 0,
      rawSummary: '',
    };

    const seenFiles = new Set<string>();
    const seenFunctions = new Set<string>();

    for (const analysis of analyses) {
      for (const file of analysis.filesChanged) {
        if (!seenFiles.has(file.path)) {
          seenFiles.add(file.path);
          merged.filesChanged.push(file);
        }
      }

      for (const fn of analysis.functionsModified) {
        if (!seenFunctions.has(fn)) {
          seenFunctions.add(fn);
          merged.functionsModified.push(fn);
        }
      }

      merged.linesAdded += analysis.linesAdded;
      merged.linesRemoved += analysis.linesRemoved;
    }

    merged.rawSummary = analyses.map((a) => a.rawSummary).join(' ');
    return merged;
  }
}
