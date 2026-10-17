import type { NextFunction, Request, Response } from "express";

/** Matches the versioned prefix: /api/v1, /api/v1/..., /api/v1?... */
const VERSIONED_PATH = /^\/api\/v1(?:[/?]|$)/;

/**
 * Marks requests to the legacy unversioned /api/* paths as deprecated (#697).
 *
 * Every router is mounted at both /api/v1/* and /api/*; the legacy mount keeps
 * existing clients working while the `Deprecation` header tells them to move.
 */
export function legacyApiDeprecation(req: Request, res: Response, next: NextFunction): void {
  if (!VERSIONED_PATH.test(req.originalUrl)) {
    res.setHeader("Deprecation", "true");
  }
  next();
}
