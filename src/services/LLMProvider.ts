import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Embeddings } from '@langchain/core/embeddings';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { ChatOllama, OllamaEmbeddings } from '@langchain/ollama';

import type { AppConfig } from '../config/index.js';

/**
 * Creates a configured LangChain BaseChatModel instance for the selected provider.
 */
export function createChatModel(config: AppConfig): BaseChatModel {
  switch (config.llmProvider) {
    case 'openai':
      return new ChatOpenAI({
        modelName: config.llmModel,
        apiKey: config.openaiApiKey,
        configuration: config.llmBaseUrl ? { baseURL: config.llmBaseUrl } : undefined,
        temperature: 0.3,
      });

    case 'anthropic':
      return new ChatAnthropic({
        modelName: config.llmModel,
        apiKey: config.anthropicApiKey,
        temperature: 0.3,
      });

    case 'gemini':
      return new ChatGoogleGenerativeAI({
        model: config.llmModel,
        apiKey: config.geminiApiKey,
        temperature: 0.3,
      });

    case 'ollama':
      return new ChatOllama({
        model: config.llmModel,
        baseUrl: config.ollamaBaseUrl,
        temperature: 0.3,
      });

    case 'deepseek':
      // DeepSeek uses an OpenAI-compatible API — no extra package needed
      return new ChatOpenAI({
        modelName: config.llmModel,
        apiKey: config.deepseekApiKey,
        configuration: {
          baseURL: 'https://api.deepseek.com',
        },
        temperature: 0.3,
      });

    default:
      throw new Error(`Unsupported LLM provider: ${config.llmProvider}`);
  }
}

/**
 * Creates a configured LangChain Embeddings instance for the selected provider.
 */
export function createEmbeddingModel(config: AppConfig): Embeddings {
  switch (config.embeddingProvider) {
    case 'openai':
      return new OpenAIEmbeddings({
        modelName: config.llmEmbeddingModel,
        apiKey: config.openaiApiKey,
        configuration: config.llmBaseUrl ? { baseURL: config.llmBaseUrl } : undefined,
      });

    case 'gemini':
      return new GoogleGenerativeAIEmbeddings({
        model: config.llmEmbeddingModel,
        apiKey: config.geminiApiKey,
      });

    case 'ollama':
      return new OllamaEmbeddings({
        model: config.llmEmbeddingModel,
        baseUrl: config.ollamaBaseUrl,
      });

    default:
      if ((config.embeddingProvider as string) === 'anthropic') {
        throw new Error(
          'Anthropic does not offer an embedding API. Please set EMBEDDING_PROVIDER=openai or EMBEDDING_PROVIDER=ollama.'
        );
      }
      throw new Error(`Unsupported Embedding provider: ${config.embeddingProvider}`);
  }
}
