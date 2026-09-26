// Runs the pump against a real native runtime until it escalates the trigger in argv; native `fail` terminates the
// process through fatalError, so reaching the end is a failure. With "close", every exchange after the host closes
// fails and nothing else keeps the process alive: it must settle the close or escalate.
import {generateKeyPair} from "@libp2p/crypto/keys";
import bindings from "@chainsafe/lodestar-z";
import {initializeNativeNetworkRuntime} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {createNativeConfig} from "../../src/network/core/native/config.js";
import {NativeDrain, NativeDrainStages} from "../../src/network/core/native/drain.js";
import {defaultNetworkOptions} from "../../src/network/options.js";

const mode = process.argv[2];
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
    if (mode === "3") throw Error("demand failed");
    // Trigger 1: native refuses a quota past its bound.
    return mode === "1" ? {...demand, messages: 65} : demand;
  },
  deliver: () => false,
};
let closing = false;
const runtime: Pick<typeof native, "exchange" | "fail" | "closed"> = {
  closed: native.closed,
  exchange: (actions, exchangeDemand) => {
    // Without a string code, the pump retries rather than escalating at once.
    if (closing) throw Error("exchange failed");
    return native.exchange(actions, exchangeDemand);
  },
  fail: (trigger, reason) => native.fail(trigger, reason),
};
drain = new NativeDrain(
  runtime,
  {budgetMs: 8, settle: 32},
  () => (closing ? null : stages),
  () => {},
  () => {},
  null
);
if (mode === "close") {
  // A command settles through the pump before the host closes.
  await native.getIdentity();
  closing = true;
  await native.close();
  console.log("closed");
} else {
  // One request: a refused batch escalates at once, and a failing demand retries on the pump's timer until the third.
  drain.request();
  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log("survived");
  await native.close();
}
