import request from 'supertest';
import { startServer, resetServerConfig } from '../../server';
import { QueueAdapterMem } from '../../adapters/queue-mem';

describe('tasks-core-node-ts feature flags', () => {
  const previousEnv = process.env;
  const queueAdapters: QueueAdapterMem[] = [];

  afterEach(async () => {
    for (const queueAdapter of queueAdapters.splice(0)) {
      queueAdapter.stop();
    }
    process.env = previousEnv;
    resetServerConfig();
  });

  it('does not mount the tasks-core endpoint when CARE_REMINDERS_ENABLED=false', async () => {
    process.env = {
      ...previousEnv,
      CARE_REMINDERS_ENABLED: 'false',
      CARE_REMINDERS_API_ENABLED: 'true',
    };
    resetServerConfig();

    const { app, queueAdapter } = await startServer({ listen: false });
    if (queueAdapter instanceof QueueAdapterMem) {
      queueAdapters.push(queueAdapter);
    }
    const response = await request(app).get('/tasks-core/_status');

    expect(response.status).toBe(404);
  });

  it('mounts the tasks-core endpoint when CARE_REMINDERS_ENABLED=true and API is enabled', async () => {
    process.env = {
      ...previousEnv,
      CARE_REMINDERS_ENABLED: 'true',
      CARE_REMINDERS_API_ENABLED: 'true',
      CARE_REMINDERS_WORKER_ENABLED: 'false',
      CARE_REMINDERS_FHIR_ENABLED: 'true',
      CARE_REMINDERS_CSV_ENABLED: 'false',
      CARE_REMINDERS_DEFAULT_CHANNELS: 'chatbot,push',
      CARE_REMINDERS_AUTO_CLOSE_MINUTES: '90',
      CARE_REMINDERS_CONFIRMATION_REQUIRED_DEFAULT: 'true',
    };
    resetServerConfig();

    const { app, queueAdapter } = await startServer({ listen: false });
    if (queueAdapter instanceof QueueAdapterMem) {
      queueAdapters.push(queueAdapter);
    }
    const response = await request(app).get('/tasks-core/_status');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      module: 'tasks-core-node-ts',
      enabled: true,
      apiEnabled: true,
      workerEnabled: false,
      fhirEnabled: true,
      csvEnabled: false,
      defaultChannels: ['chatbot', 'push'],
      autoCloseMinutes: 90,
      confirmationRequiredDefault: true,
    });
  });

  it('does not mount the tasks-core endpoint when API flag is disabled', async () => {
    process.env = {
      ...previousEnv,
      CARE_REMINDERS_ENABLED: 'true',
      CARE_REMINDERS_API_ENABLED: 'false',
    };
    resetServerConfig();

    const { app, queueAdapter } = await startServer({ listen: false });
    if (queueAdapter instanceof QueueAdapterMem) {
      queueAdapters.push(queueAdapter);
    }
    const response = await request(app).get('/tasks-core/_status');

    expect(response.status).toBe(404);
  });
});