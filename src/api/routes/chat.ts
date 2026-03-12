import type { FastifyInstance } from 'fastify';
import { ChatQuerySchema } from '../../models/schemas.js';
import type { ChatService } from '../../services/ChatService.js';

interface ChatRouteDeps {
  chatService: ChatService;
}

export async function chatRoutes(
  fastify: FastifyInstance,
  deps: ChatRouteDeps
): Promise<void> {
  const { chatService } = deps;

  // ─── POST /chat — Ask a question about your code history ────

  fastify.post('/chat', async (request, reply) => {
    try {
      const { question, repoId, limit } = ChatQuerySchema.parse(request.body);

      const response = await chatService.ask(question, repoId, limit);

      return reply.send(response);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return reply.code(400).send({ error: 'Validation failed', details: error });
      }
      throw error;
    }
  });
}
