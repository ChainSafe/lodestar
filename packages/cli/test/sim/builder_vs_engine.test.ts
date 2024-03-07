/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {bellatrix} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";
import {activePreset} from "@lodestar/params";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {
  AssertionMatch,
  AssertionResult,
  BeaconClient,
  ExecutionClient,
  SimulationAssertion,
  ValidatorClient,
} from "../utils/simulation/interfaces.js";
import {defineSimTestConfig, logFilesDir} from "../utils/simulation/utils/index.js";
import {connectAllNodes, waitForSlot} from "../utils/simulation/utils/network.js";
import {getNodePorts} from "../utils/simulation/utils/ports.js";

const runTillEpoch = 6;
// All assertions are tracked w.r.t. fee recipient by attaching different fee recipient to
// execution and builder
const feeRecipientEngine = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const feeRecipientMevBoost = "0xcccccccccccccccccccccccccccccccccccccccc";

// The builder gets activated post middle of epoch because of circuit breaker
// In a perfect run expected builder = 16, expected engine = 16
//   keeping 4 missed slots margin for both
const expectedBuilderBlocks = 12;
const expectedEngineBlocks = 12;

const {estimatedTimeoutMs, forkConfig} = defineSimTestConfig({
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  // Add some very high number
  CAPELLA_FORK_EPOCH: 100000,
  runTillEpoch,
  additionalSlotsForTTD: 0,
  initialNodes: 2,
});

// const beaconClientOptions: BeaconClientsOptions[BeaconClient.Lodestar] = {
//   builder: true,
//   "builder.url": `http://127.0.0.1:${getNodePorts(1).execution.httpPort}`,
//   "builder.allowedFaults": 16,
//   // "builder.issueLocalFcUWithFeeRecipient": feeRecipientMevBoost,
//   "builder.faultInspectionWindow": 32,
//   suggestedFeeRecipient: feeRecipientLocal,
// };

// const validatorClientOptions: ValidatorClientsOptions[ValidatorClient.Lodestar] = {
//   builder: true,
//   suggestedFeeRecipient: feeRecipientEngine,
//   strictFeeRecipientCheck: true,
//   "builder.selection": "builderalways",
//   defaultGasLimit: 30000000,
// };

const env = await SimulationEnvironment.initWithDefaults(
  {
    id: "builder-vs-engine",
    logsDir: path.join(logFilesDir, "builder-vs-engine"),
    forkConfig,
  },
  [
    {
      id: "engine",
      beacon: {
        type: BeaconClient.Lodestar,
        options: {
          clientOptions: {
            builder: false,
            eth1: true,
            suggestedFeeRecipient: feeRecipientEngine,
            "execution.urls": [`http://127.0.0.1:${getNodePorts(0).execution.enginePort}`],
          },
        },
      },
      validator: {
        type: ValidatorClient.Lodestar,
        options: {
          clientOptions: {
            builder: false,
            useProduceBlockV3: true,
            "builder.selection": "executionalways",
            suggestedFeeRecipient: feeRecipientEngine,
          },
        },
      },
      execution: ExecutionClient.Geth,
      keysCount: activePreset.SLOTS_PER_EPOCH,
      mining: true,
    },
    {
      id: "builder",
      beacon: {
        type: BeaconClient.Lodestar,
        options: {
          clientOptions: {
            builder: true,
            eth1: true,
            suggestedFeeRecipient: feeRecipientMevBoost,
            "builder.allowedFaults": 0,
            "builder.faultInspectionWindow": activePreset.SLOTS_PER_EPOCH,
            "builder.url": "http://127.0.0.1:8888",
          },
        },
      },
      validator: {
        type: ValidatorClient.Lodestar,
        options: {
          clientOptions: {
            builder: true,
            useProduceBlockV3: true,
            suggestedFeeRecipient: feeRecipientMevBoost,
            "builder.selection": "builderalways",
          },
        },
      },
      execution: {
        type: ExecutionClient.Builder,
        options: {
          clientOptions: {
            builder: {
              beaconEndpoints: [`http://host.docker.internal:${getNodePorts(1).beacon.httpPort}`],
              listenAddress: "0.0.0.0:8888",
            },
          },
        },
      },
      keysCount: activePreset.SLOTS_PER_EPOCH,
      mining: false,
    },
  ]
);

env.tracker.register({
  id: "builderVsEngineCount",
  match({slot, clock}) {
    if (slot < clock.getLastSlotOfEpoch(runTillEpoch - 1)) return AssertionMatch.Capture;
    if (slot === clock.getLastSlotOfEpoch(runTillEpoch - 1)) return AssertionMatch.Assert;

    return AssertionMatch.None;
  },
  async capture({block}) {
    const blockFeeRecipient = toHexString(
      (block as bellatrix.SignedBeaconBlock).message.body.executionPayload.feeRecipient
    );
    console.log({blockFeeRecipient});
    return {
      builder: blockFeeRecipient === feeRecipientMevBoost,
      engine: blockFeeRecipient === feeRecipientEngine,
    };
  },
  async assert({store, slot}) {
    let builderBlocks = 0;
    let engineBlocks = 0;

    for (let s = 0; s <= slot; s++) {
      if (!store[s]) continue;

      if (store[s]?.builder) builderBlocks++;
      if (store[s]?.engine) engineBlocks++;
    }

    console.log({builderBlocks, engineBlocks});

    const errors: AssertionResult[] = [];
    if (builderBlocks === expectedBuilderBlocks) {
      errors.push(`Builder blocks count not matching. Expected: ${expectedBuilderBlocks}, got: ${builderBlocks}`);
    }

    if (engineBlocks === expectedEngineBlocks) {
      errors.push(`Engine blocks count not matching. Expected: ${expectedEngineBlocks}, got: ${engineBlocks}`);
    }

    return errors;
  },
} as SimulationAssertion<"builderVsEngineCount", {builder: boolean; engine: boolean} | undefined>);

await env.start({runTimeoutMs: estimatedTimeoutMs});
await connectAllNodes(env.nodes);

await waitForSlot(env.clock.getLastSlotOfEpoch(runTillEpoch), env.nodes, {env});
await env.stop();
