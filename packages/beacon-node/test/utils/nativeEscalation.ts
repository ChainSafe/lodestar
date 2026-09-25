// Runs the pump against a real native runtime until it escalates the trigger in argv; native `fail` terminates the
// process through fatalError, so reaching the end is a failure.
import {generateKeyPair} from "@libp2p/crypto/keys";
import bindings from "@chainsafe/lodestar-z";
import {
  NativeExchange,
  NativeNetworkApplicationRuntime,
  initializeNativeNetworkRuntime,
} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {createNativeConfig} from "../../src/network/core/native/config.js";
import {NativeDrain, NativeDrainStages} from "../../src/network/core/native/drain.js";
import {defaultNetworkOptions} from "../../src/network/options.js";

const trigger = Number(process.argv[2]);
const config = createBeaconConfig(
  {
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: Infinity,
    BLOB_SCHEDULE: [],
  },
  new Uint8Array(32)
);
bindings.config.set(config, config.genesisValidatorsRoot);
const application = createNativeConfig(
  {...defaultNetworkOptions, tcp: false, localMultiaddrs: ["/ip4/127.0.0.1/udp/0/quic-v1"]},
  config,
  await generateKeyPair("secp256k1"),
  0,
  ssz.fulu.Status.defaultValue(),
  config.CUSTODY_REQUIREMENT,
  16
).application;
let drain: NativeDrain | undefined;
const native = initializeNativeNetworkRuntime(application, () => drain?.request());
const demand = {
  bytes: 1 << 20,
  capacity: {serving: 1, ordinary: true},
  checks: 64,
  claimOrdinary: true,
  messages: 64,
  peers: 32,
  servingStarts: 8,
};
const stages: NativeDrainStages = {
  demand: () => {
    if (trigger === 3) throw Error("demand failed");
    // Trigger 1: native refuses a quota past its bound.
    return trigger === 1 ? {...demand, messages: 65} : demand;
  },
  deliver: () => false,
};
// Trigger 4 needs rollbacks, which a real bridge only produces on allocation failure, so the exchange reports them.
const rolledBack: NativeExchange = {more: true, retired: false, rolledBack: true};
const runtime: Pick<NativeNetworkApplicationRuntime, "exchange" | "fail" | "closed"> =
  trigger === 4 ? {exchange: () => rolledBack, fail: native.fail.bind(native), closed: native.closed} : native;
drain = new NativeDrain(
  runtime,
  {budgetMs: 8, settle: 32, peers: 32, checks: 64, servingStarts: 8, gossipItems: 64, gossipBytes: 1 << 20},
  () => stages,
  () => {},
  null
);
for (let turn = 0; turn < 8; turn++) {
  drain.request();
  await new Promise((resolve) => setTimeout(resolve, 50));
}
console.log("survived");
await native.close();
