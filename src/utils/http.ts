import type { FastifyReply } from 'fastify';
import type { ApiErrorBody } from '../types';

/**
 * Sends a structured, machine-readable error payload and returns the reply so
 * handlers can short-circuit with `return errorReply(...)`.
 */
export function errorReply(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): FastifyReply {
  const body: ApiErrorBody = { statusCode, code, message, details };
  return reply.code(statusCode).send(body);
}