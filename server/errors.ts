import type { NextFunction, Request, Response } from "express";

// Error con código HTTP explícito. Su mensaje sí puede mostrarse al usuario.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

// Envuelve un manejador (síncrono o asíncrono) para que sus errores lleguen al
// middleware de errores de Express.
export function route(handler: (req: Request, res: Response) => unknown) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
  };
}
