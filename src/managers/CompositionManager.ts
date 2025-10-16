// src/managers/CompositionManager.ts
import { JobRequest } from '../models/request';
import { IPayloadResponse } from '../models/response';
import { IJobProcessor } from './registry';

export class CompositionManager implements IJobProcessor {
  public async process(job: JobRequest): Promise<IPayloadResponse> {
    // TDD: This method is not yet implemented.
    throw new Error('CompositionManager.process() is not implemented.');
  }
}
