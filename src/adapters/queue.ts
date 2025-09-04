// src/adapters/queue.ts

import { DataInRequest, JobRequest } from "../models/request";


export interface QueueAdapter {
  addJob(jobName: string, request: JobRequest, priority?: number): Promise<void>;
}