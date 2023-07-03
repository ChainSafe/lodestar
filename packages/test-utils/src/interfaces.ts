export interface TestContext {
  afterEach: (cb: () => Promise<void> | void) => void;
  beforeEach: (cb: () => Promise<void> | void) => void;
  afterAll: (cb: () => Promise<void> | void) => void;
}
