// src/adapters/queue-mem.ts
import { QueueAdapter } from './queue';
import { Worker } from '../worker';
import { JobRequest } from '../models/request';
/**
 * An in-memory implementation of the QueueAdapter.
 * It follows the Adapter pattern: its only job is to manage a queue of jobs in memory.
 * It is "dumb" and knows nothing about how to process the jobs. It delegates that
 * responsibility to an injected Worker instance.
 *
 * This design allows for easily swapping this implementation with a more robust one
 * like RabbitMQ or Redis (e.g., BullMQ) without changing any other part of the system.
 */
export class QueueAdapterMem implements QueueAdapter {
  private queue: { name: string; request: JobRequest; priority: number }[] = [];
  private responseStore: Map<string, { status: string; result?: string; }>;
  private worker: Worker;

  constructor(responseStore: Map<string, any>, worker: Worker) {
    this.responseStore = responseStore;
    this.worker = worker;
    this.startWorker();
  }

  /**
   * Adds a job to the in-memory queue.
   */
  async addJob(jobName: string, request: JobRequest, priority = 10): Promise<void> {
    this.queue.push({ name: jobName, request, priority });
    // Sort by priority (lower value = higher priority)
    this.queue.sort((a, b) => a.priority - b.priority);
  }

  /**
   * The core processing loop. It pulls a job from the queue and passes it to the Worker.
   */
  private async processQueue(): Promise<void> {
    if (this.queue.length > 0) {
      const job = this.queue.shift();
      if (job) {
        const thid = job.request.input.id;
        try {
          // Delegate the entire processing logic to the injected worker.
          const finalBundle = await this.worker.process(job.name, job.request);
          this.responseStore.set(thid, { status: 'COMPLETED', result: JSON.stringify(finalBundle) });
        } catch (error) {
          // This catch is for catastrophic errors where the worker itself fails.
          const errorMessage = `Catastrophic failure in worker while processing job ${job.name}: ${(error as Error).message}`;
          console.error(errorMessage);
          this.responseStore.set(thid, { status: 'FAILED', result: JSON.stringify({ error: errorMessage }) });
        }
      }
    }
  }

  /**
   * Starts a simple interval to process the queue periodically.
   * In a real system, this would be a more robust consumer process.
   */
  private startWorker(): void {
    setInterval(() => { this.processQueue(); }, 50);
  }
}
