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
  logs: () => {},
};

export function createSettlingNetwork(application: Omit<NativeApplicationConfig, "logLevel">): NativeNetwork {
  return createNativeNetwork({...application, logLevel: "off"}, settlingHost);
}
