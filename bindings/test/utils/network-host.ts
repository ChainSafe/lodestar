import type {NativeHost} from "../../src/network.js";

/** A host that takes nothing but what a test overrides. */
export function host(overrides: Partial<NativeHost> = {}): NativeHost {
  return {
    capacity: () => ({gossipValidation: "ready"}),
    checkDependencies: (checks) => checks.map(() => false),
    failed: () => undefined,
    logs: () => undefined,
    peers: () => undefined,
    serve: (request) => request.cancel(),
    subscribeCapacity: () => () => undefined,
    validate: (job) => Promise.resolve(job.messages.map(() => "ignore" as const)),
    ...overrides,
  };
}
