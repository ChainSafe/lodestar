import {FastifyError} from "fastify";

/**
 * The error handler will decide status code 400
 */
export function toRestValidationError(field: string, message: string): FastifyError {
  return {
    message,
    validation: [
      {
        dataPath: field,
        message,
      },
    ],
  } as FastifyError;
}
