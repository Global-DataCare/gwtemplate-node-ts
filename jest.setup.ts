// jest.setup.ts

/* eslint-disable no-undef */

import * as globals from '@jest/globals';

// Re-expose Jest APIs as globals so old tests keep working
Object.assign(globalThis, globals);

jest.setTimeout(65000); // in milliseconds