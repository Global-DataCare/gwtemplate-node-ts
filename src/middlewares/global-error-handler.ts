// src/middlewares/global-error-handler.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import * as express from 'express';
import { ILogger } from '../loggers/ILogger';
import { createOperationOutcome } from '../utils/outcome';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';

export function createGlobalErrorHandler(logger: ILogger): express.ErrorRequestHandler {
  return (err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Check if the error is a SyntaxError from body-parser
    if (err instanceof SyntaxError && 'body' in err) {
      logger.error('Malformed JSON received', err, { path: req.path, method: req.method });
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Invalid, `Malformed JSON in request body: ${err.message}`);
      return res.status(400).json(outcome);
    }

    // Handle other unexpected errors
    logger.error('An unexpected error occurred in the global error handler', err, { path: req.path, method: req.method });
    const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Exception, 'An unexpected internal server error occurred.');
    return res.status(500).json(outcome);
  };
}

