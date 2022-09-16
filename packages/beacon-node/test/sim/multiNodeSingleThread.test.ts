import {IChainConfig} from "@lodestar/config";
import {phase0} from "@lodestar/types";
import {Validator} from "@lodestar/validator/lib";
import {ILogger, sleep, TimestampFormatCode} from "@lodestar/utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconNode} from "../../src/index.js";
import {getDevBeaconNode} from "../utils/node/beacon.js";
import {waitForEvent} from "../utils/events/resolver.js";
import {getAndInitDevValidators} from "../utils/node/validator.js";
import {ChainEvent} from "../../src/chain/index.js";
import {testLogger, LogLevel, TestLoggerOpts} from "../utils/logger.js";
import {connect} from "../utils/network.js";
import {simTestInfoTracker} from "../utils/node/simTest.js";
import {logFilesDir} from "./params.js";

/* eslint-disable no-console, @typescript-eslint/naming-convention */

const p2pPortDefault = 9000;
const metricsBeaconPortDefault = 8008;

describe("Run multi node single thread interop validators (no eth1) until checkpoint", function () {
  const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
    SECONDS_PER_SLOT: 3,
  };

  const nodeCount = process.env.TEST_NODE_COUNT ? parseInt(process.env.TEST_NODE_COUNT) : 4;
  if (isNaN(nodeCount)) throw Error("Invalid TEST_NODE_COUNT");

  const testCases: {
    validatorsPerNode: number;
    event: ChainEvent.justified | ChainEvent.finalized;
    altairForkEpoch: number;
  }[] = [
    // Test phase0 to justification
    {validatorsPerNode: 32, event: ChainEvent.justified, altairForkEpoch: Infinity},
    // Test altair only
    {validatorsPerNode: 32, event: ChainEvent.justified, altairForkEpoch: 0},
    // Test phase -> altair fork transition
    {validatorsPerNode: 32, event: ChainEvent.justified, altairForkEpoch: 2},
  ];

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach("Stop nodes and validators", async function () {
    this.timeout("10 min");
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  // TODO test multiNode with remote;

  for (const {validatorsPerNode, event, altairForkEpoch} of testCases) {
    it(`singleThread ${nodeCount} nodes / ${validatorsPerNode} vc / 1 validator > until ${event}, altairForkEpoch ${altairForkEpoch}`, async function () {
      this.timeout("10 min");

      const nodes: BeaconNode[] = [];
      const validators: Validator[] = [];
      const loggers: ILogger[] = [];
      // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
      const genesisSlotsDelay = 30;
      const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;

      for (let i = 0; i < nodeCount; i++) {
        const testLoggerOpts: TestLoggerOpts = {
          logLevel: LogLevel.info,
          logFile: `${logFilesDir}/singlethread_multinode_altair-${altairForkEpoch}.log`,
          timestampFormat: {
            format: TimestampFormatCode.EpochSlot,
            genesisTime,
            slotsPerEpoch: SLOTS_PER_EPOCH,
            secondsPerSlot: testParams.SECONDS_PER_SLOT,
          },
        };
        const logger = testLogger(`Node ${i}`, testLoggerOpts);

        const p2pPort = p2pPortDefault + i;
        const metricsPort = metricsBeaconPortDefault + i;

        const bn = await getDevBeaconNode({
          params: {...testParams, ALTAIR_FORK_EPOCH: altairForkEpoch},
          options: {
            api: {rest: {port: p2pPort}},
            metrics: process.env.TEST_METRICS_ENABLED ? {enabled: true, port: metricsPort} : undefined,
          },
          validatorCount: nodeCount * validatorsPerNode,
          genesisTime,
          logger,
        });

        const {validators: nodeValidators} = await getAndInitDevValidators({
          node: bn,
          validatorsPerClient: validatorsPerNode,
          validatorClientCount: 1,
          startIndex: i * validatorsPerNode,
          testLoggerOpts,
        });
        afterEachCallbacks.push(async () => await Promise.all(validators.map((validator) => validator.close())));

        afterEachCallbacks.push(async () => {
          await Promise.all(validators.map((validator) => validator.close()));
          console.log("--- Stopped all validators ---");
          // wait for 1 slot
          await sleep(1 * testParams.SECONDS_PER_SLOT * 1000);

          stopInfoTracker();
          await Promise.all(nodes.map((node) => node.close()));
          console.log("--- Stopped all nodes ---");
          // Wait a bit for nodes to shutdown
          await sleep(3000);
        });

        loggers.push(logger);
        nodes.push(bn);
        validators.push(...nodeValidators);
      }

      const stopInfoTracker = simTestInfoTracker(nodes[0], loggers[0]);

      afterEachCallbacks.push(async () => {
        stopInfoTracker();
        await Promise.all(nodes.map((node) => node.close()));
        console.log("--- Stopped all nodes ---");
        // Wait a bit for nodes to shutdown
        await sleep(3000);
      });

      // Connect all nodes with each other
      for (let i = 0; i < nodeCount; i++) {
        for (let j = 0; j < nodeCount; j++) {
          if (i !== j) {
            await connect(nodes[i].network, nodes[j].network.peerId, nodes[j].network.localMultiaddrs);
          }
        }
      }

      // Wait for justified checkpoint on all nodes
      await Promise.all(nodes.map((node) => waitForEvent<phase0.Checkpoint>(node.chain.emitter, event, 240000)));
      console.log("--- All nodes reached justified checkpoint ---");

      if (process.env.TEST_RUN_FOREVER) {
        await new Promise((r) => setTimeout(r, 1e6));
      }
    });
  }
});
