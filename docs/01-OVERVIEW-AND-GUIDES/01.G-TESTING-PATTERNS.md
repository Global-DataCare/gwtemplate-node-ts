# Testing Patterns and Best Practices

This guide provides detailed instructions on the specific, mandatory patterns to be used when writing tests for this project. Adhering to these patterns is crucial for creating a robust, reliable, and maintainable test suite.

## 1. The "Live Instance" Mocking Pattern for Integration Tests

This is the most critical pattern for ensuring the correctness of integration tests that involve dependency injection.

### The Problem: Stale Mock Instances

When writing an integration test where one module (e.g., an API router) instantiates and uses another (e.g., a `TenantMemManager`), it's easy to create a "stale" mock. This happens when the test file creates its own mock instance, but the system-under-test creates a *different* instance internally. The test then configures a mock that the system never actually uses, leading to confusing failures like `... is not a function`.

### The Mandatory Solution: Retrieve the Live Instance

The correct pattern is to **never assume your mock instance is the one being used**. You must let the system create its instance and then **retrieve that live instance** from Jest's mock registry.

#### Step-by-Step Implementation:

1.  **Mock the Module:** At the top level of the test file, use `jest.mock('@/path/to/YourClass')`. Jest will automatically hoist this.

2.  **Instantiate the System:** In a `beforeEach` block, create the primary component being tested (e.g., the Express app and router). This action will trigger the constructor of the mocked class internally.

3.  **Retrieve the Live Instance:** Get a reference to the mocked class constructor. Its static `.mock.instances` property will be an array containing every instance created during the test. The one you need is almost always the first one (`[0]`).

4.  **Configure and Assert:** Use this retrieved live instance for all your test configurations (`.mockResolvedValue`, etc.) and assertions.

#### Example:

```typescript
// src/__tests__/integration/api.test.ts
import { TenantMemManager } from '@/managers/TenantMemManager';
import { createApiRouter } from '@/routes/api';

// 1. Mock the module at the top level.
jest.mock('@/managers/TenantMemManager');

describe('API Integration Test', () => {
  let app: express.Express;
  let mockTenantManager: jest.Mocked<TenantMemManager>; // This will hold the LIVE instance

  beforeEach(() => {
    // This is a reference to the mocked CLASS constructor, not an instance.
    const MockedTenantManager = TenantMemManager as jest.mock.MockedClass<typeof TenantMemManager>;
    
    // 2. Instantiate the system. This creates an internal instance of the mocked manager.
    app = express();
    const router = createApiRouter(..., new MockedTenantManager(), ...); // Pass a dummy instance
    app.use(router);

    // 3. Retrieve the LIVE instance that the router is actually using.
    mockTenantManager = MockedTenantManager.mock.instances[0];

    // 4. Now, you can reliably configure the live instance.
    mockTenantManager.getConfigByAlternateName.mockResolvedValue({ ... });
  });

  it('should work correctly', async () => {
    // ... Act and Assert ...
    expect(mockTenantManager.getConfigByAlternateName).toHaveBeenCalledTimes(1);
  });
});
```
