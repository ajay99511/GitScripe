import { Annotation, StateGraph, END, START } from '@langchain/langgraph';
import pino from 'pino';
import type { CommitInfo, DiffAnalysis, SummaryDraft } from '../models/types.js';
import type { DiffAnalyzerAgent } from '../agents/DiffAnalyzerAgent.js';
import type { SummaryAgent } from '../agents/SummaryAgent.js';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private graph: any = null;

  constructor(diffAnalyzer: DiffAnalyzerAgent, summaryAgent: SummaryAgent) {
    this.diffAnalyzer = diffAnalyzer;
    this.summaryAgent = summaryAgent;
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

        logger.info({ sha: state.commit.sha }, 'Running SummaryAgent');

        try {
          const draft = await summaryAgent.summarize(
            state.commit,
            state.diffAnalysis
          );
          return { summaryDraft: draft, qualityScore: 1.0 };
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          logger.error({ error, sha: state.commit.sha }, 'Summary generation failed');
          return { error: `Summary failed: ${msg}` };
        }
      })
      // Phase 2: Add CriticAgent node here with conditional edge
      // .addNode('criticAgent', async (state) => { ... })
      .addEdge(START, 'analyzeDiff')
      .addEdge('analyzeDiff', 'generateSummary')
      .addEdge('generateSummary', END);

    // Phase 2: Replace the direct edge with a conditional edge:
    // .addConditionalEdges('generateSummary', (state) => {
    //   if (state.qualityScore && state.qualityScore >= 0.8) return END;
    //   return 'criticAgent';
    // })

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
      error: result.error,
    };
  }
}
