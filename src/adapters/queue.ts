// src/adapters/queue.ts

import { JobRequest } from "../models/confidential-job";


export interface QueueAdapter {
  addJob(jobName: string, request: JobRequest, priority?: number): Promise<void>;
}