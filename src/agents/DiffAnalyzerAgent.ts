import pino from 'pino';
import { BaseAgent } from './BaseAgent.js';
import { DiffAnalysisOutputSchema } from '../models/schemas.js';
import type { DiffAnalysis } from '../models/types.js';

const logger = pino({ name: 'DiffAnalyzerAgent' });

const SYSTEM_PROMPT = `You are a senior code reviewer. Your job is to analyze a git diff and produce a structured JSON analysis.

You MUST respond with valid JSON matching this exact schema:
{
  "filesChanged": [
    {
      "path": "string - file path",
      "changeType": "added | modified | deleted | renamed",
      "additions": "number - lines added",
      "deletions": "number - lines removed",
      "summary": "string - 1-2 sentence description of what changed in this file"
    }
  ],
  "functionsModified": ["string - function/method names that were changed"],
  "linesAdded": "number - total lines added",
  "linesRemoved": "number - total lines removed",
  "rawSummary": "string - 2-3 sentence high-level overview of the entire diff"
}

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
    const chunks = this.chunkText(diff);
    logger.info({ chunks: chunks.length }, 'Analyzing diff');

    if (chunks.length === 1) {
      return this.analyzeSingle(chunks[0], commitMessage);
    }

    // For multi-chunk diffs, analyze each chunk and merge
    const results = await Promise.all(
      chunks.map((chunk, i) =>
        this.analyzeSingle(
          chunk,
          `${commitMessage} (part ${i + 1} of ${chunks.length})`
        )
      )
    );

    return this.mergeAnalyses(results);
  }

  private async analyzeSingle(
    diff: string,
    commitMessage: string
  ): Promise<DiffAnalysis> {
    const prompt = this.buildPrompt(USER_PROMPT_TEMPLATE, {
      commitMessage,
      diff,
    });

    const raw = await this.callLLM(SYSTEM_PROMPT, prompt, 2000);

    try {
      const parsed = JSON.parse(raw);
      const validated = DiffAnalysisOutputSchema.parse(parsed);
      return validated;
    } catch (error) {
      logger.error({ error, raw: raw.slice(0, 200) }, 'Failed to parse LLM output');
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
