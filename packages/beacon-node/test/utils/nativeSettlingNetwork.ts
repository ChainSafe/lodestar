import {NativeApplicationConfig, NativeHost, NativeNetwork, createNativeNetwork} from "@chainsafe/lodestar-z/network";

/** A host that takes no work, so the binding only settles results, as after the adapter closes. */
const settlingHost: NativeHost = {
  capacity: () => null,
  validate: async (job) => job.messages.map(() => "ignore"),
  checkDependencies: (checks) => checks.map(() => false),
  serve: (request) => request.cancel(),
  peers: () => {},
  failed: (error) => {
    throw error;
  },
};

export function createSettlingNetwork(application: NativeApplicationConfig): NativeNetwork {
  return createNativeNetwork(application, settlingHost);
}
