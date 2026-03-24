import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config/index.js';

interface ConfigRouteDeps {
  config: AppConfig;
}

// Static model lists per provider — includes the most common models.
// The currently configured model is always included even if not in this list.
const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
  ollama: ['llama3.2', 'mistral', 'codellama', 'deepseek-coder'],
  deepseek: ['deepseek-chat', 'deepseek-coder'],
};

export async function configRoutes(
  fastify: FastifyInstance,
  deps: ConfigRouteDeps
): Promise<void> {
  const { config } = deps;

  // ─── GET /config/models — Available LLM models for the current provider ───

  fastify.get('/config/models', async (_request, reply) => {
    const provider = config.llmProvider;
    const knownModels = PROVIDER_MODELS[provider] ?? [];

    // Always include the currently configured model (user may have set a custom one)
    const models = knownModels.includes(config.llmModel)
      ? knownModels
      : [config.llmModel, ...knownModels];

    return reply.send({
      provider,
      models,
      default: config.llmModel,
    });
  });
}
