// src/managers/CompositionManager.ts
import { JobRequest } from '../models/confidential-job';
import { IDecodedDidcommPayload } from '../models/confidential-message';
import { IJobProcessor } from './registry';

export class CompositionManager implements IJobProcessor {
  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    // TDD: This method is not yet implemented.
    throw new Error('CompositionManager.process() is not implemented.');
  }
}
