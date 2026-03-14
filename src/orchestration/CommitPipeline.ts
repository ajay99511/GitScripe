import { Annotation, StateGraph, END, START } from '@langchain/langgraph';
import pino from 'pino';
import type { CommitInfo, DiffAnalysis, SummaryDraft } from '../models/types.js';
import type { DiffAnalyzerAgent } from '../agents/DiffAnalyzerAgent.js';
import type { SummaryAgent } from '../agents/SummaryAgent.js';
import type { CriticAgent } from '../agents/CriticAgent.js';

const logger = pino({ name: 'CommitPipeline' });

// ─── State Definition ────────────────────────────────────

const PipelineAnnotation = Annotation.Root({
  commit: Annotation<CommitInfo>,
  diff: Annotation<string>,
  diffAnalysis: Annotation<DiffAnalysis | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  summaryDraft: Annotation<SummaryDraft | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  qualityScore: Annotation<number | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  extractedConcepts: Annotation<string[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  retryCount: Annotation<number>({
    reducer: (curr, next) => curr + next,
    default: () => 0,
  }),
  error: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
});

type PipelineState = typeof PipelineAnnotation.State;

/**
 * LangGraph-based commit processing pipeline.
 * Flow: analyzeDiff → generateSummary → END
 * Phase 2 will add: → criticAgent → (conditional loop back to generateSummary)
 */
export class CommitPipeline {
  private diffAnalyzer: DiffAnalyzerAgent;
  private summaryAgent: SummaryAgent;
  private criticAgent: CriticAgent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private graph: any = null;

  constructor(diffAnalyzer: DiffAnalyzerAgent, summaryAgent: SummaryAgent, criticAgent: CriticAgent) {
    this.diffAnalyzer = diffAnalyzer;
    this.summaryAgent = summaryAgent;
    this.criticAgent = criticAgent;
  }

  /**
   * Build the LangGraph state graph.
   */
  private buildGraph() {
    const diffAnalyzer = this.diffAnalyzer;
    const summaryAgent = this.summaryAgent;

    const graph = new StateGraph(PipelineAnnotation)
      .addNode('analyzeDiff', async (state: PipelineState) => {
        logger.info({ sha: state.commit.sha }, 'Running DiffAnalyzerAgent');

        try {
          const analysis = await diffAnalyzer.analyze(
            state.diff,
            state.commit.message
          );
          return { diffAnalysis: analysis };
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          logger.error({ error, sha: state.commit.sha }, 'Diff analysis failed');
          return { error: `DiffAnalysis failed: ${msg}` };
        }
      })
      .addNode('generateSummary', async (state: PipelineState) => {
        if (!state.diffAnalysis) {
          return { error: 'No diff analysis available for summary generation' };
        }

        logger.info({ sha: state.commit.sha, retry: state.retryCount }, 'Running SummaryAgent');

        try {
          const draft = await summaryAgent.summarize(
            state.commit,
            state.diffAnalysis
          );
          return { summaryDraft: draft, retryCount: 1 };
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          logger.error({ error, sha: state.commit.sha }, 'Summary generation failed');
          return { error: `Summary failed: ${msg}` };
        }
      })
      .addNode('evaluateSummary', async (state: PipelineState) => {
        if (!state.summaryDraft) {
          return { error: 'No summary draft available for evaluation' };
        }

        logger.info({ sha: state.commit.sha }, 'Running CriticAgent');

        try {
          const evaluation = await this.criticAgent.evaluate(
            state.commit,
            state.summaryDraft
          );
          return { 
            qualityScore: evaluation.qualityScore,
            extractedConcepts: evaluation.extractedConcepts 
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          logger.error({ error, sha: state.commit.sha }, 'Critic evaluation failed');
          return { error: `Critic failed: ${msg}` };
        }
      })
      .addEdge(START, 'analyzeDiff')
      .addEdge('analyzeDiff', 'generateSummary')
      .addEdge('generateSummary', 'evaluateSummary')
      .addConditionalEdges('evaluateSummary', (state: PipelineState) => {
        if (state.error) return END; // bail on errors
        
        // If the score is good, or we've retried twice already, finish
        if ((state.qualityScore && state.qualityScore >= 0.8) || state.retryCount >= 2) {
          return END;
        }
        
        // Otherwise, loop back to regenerate
        logger.warn({ sha: state.commit.sha, score: state.qualityScore }, 'Summary quality low, retrying generation');
        return 'generateSummary';
      });

    return graph.compile();
  }

  /**
   * Run the pipeline for a single commit + diff.
   * Returns the summary draft and quality score.
   */
  async run(
    commit: CommitInfo,
    diff: string
  ): Promise<{
    summaryDraft: SummaryDraft | null;
    diffAnalysis: DiffAnalysis | null;
    qualityScore: number | null;
    extractedConcepts: string[];
    error: string | null;
  }> {
    if (!this.graph) {
      this.graph = this.buildGraph();
    }

    const startMs = Date.now();

    const result = await this.graph!.invoke({
      commit,
      diff,
      diffAnalysis: null,
      summaryDraft: null,
      qualityScore: null,
      extractedConcepts: [],
      retryCount: 0,
      error: null,
    });

    const elapsed = Date.now() - startMs;
    logger.info(
      {
        sha: commit.sha,
        elapsed,
        hasError: !!result.error,
        qualityScore: result.qualityScore,
      },
      'Pipeline completed'
    );

    return {
      summaryDraft: result.summaryDraft,
      diffAnalysis: result.diffAnalysis,
      qualityScore: result.qualityScore,
      extractedConcepts: result.extractedConcepts,
      error: result.error,
    };
  }
}
