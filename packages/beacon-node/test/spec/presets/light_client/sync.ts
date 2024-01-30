import {expect} from "vitest";
import {init} from "@chainsafe/bls/switchable";
import {isForkLightClient} from "@lodestar/params";
import {altair, phase0, RootHex, Slot, ssz} from "@lodestar/types";
import {InputType} from "@lodestar/spec-test-util";
import {createBeaconConfig, ChainConfig} from "@lodestar/config";
import {fromHex, toHex} from "@lodestar/utils";
import {LightclientSpec, toLightClientUpdateSummary} from "@lodestar/light-client/spec";
import {computeSyncPeriodAtSlot} from "@lodestar/state-transition";
import {TestRunnerFn} from "../../utils/types.js";
import {testLogger} from "../../../utils/logger.js";

/* eslint-disable @typescript-eslint/naming-convention */

// https://github.com/ethereum/consensus-specs/blob/da3f5af919be4abb5a6db5a80b235deb8b4b5cba/tests/formats/light_client/single_merkle_proof.md
type SyncTestCase = {
  meta: {
    genesis_validators_root: RootHex;
    trusted_block_root: RootHex;
  };
  steps: LightclientSyncSteps[];
  config: Partial<ChainConfig>;
  bootstrap: altair.LightClientBootstrap;

  // leaf: Bytes32            # string, hex encoded, with 0x prefix
  // leaf_index: int          # integer, decimal
  // branch: list of Bytes32  # list, each element is a string, hex encoded, with 0x prefix
  proof: {
    leaf: RootHex;
    leaf_index: bigint;
    branch: RootHex[];
  };

  // Injected after parsing
  // However updates are multifork and need config and step access to deserialize inside test
  updates: Map<string, Uint8Array>;
};

type CheckHeader = {
  slot: bigint;
  beacon_root: RootHex;
};

type Checks = {
  /** store.finalized_header */
  finalized_header: CheckHeader;
  /** store.optimistic_header */
  optimistic_header: CheckHeader;
};

// - process_update:
//     update: update_0x460ec66196a5732b306791e82a0d949b49be812cf09b72667fe90735994c3b68_xx
//     current_slot: 97
//     checks:
//       finalized_header: {slot: 72, beacon_root: '0x36c5a33d8843f26749697a72de42b5bf621c760502847fdb6d50c1e0f1a04ac1'}
//       optimistic_header: {slot: 96, beacon_root: '0x460ec66196a5732b306791e82a0d949b49be812cf09b72667fe90735994c3b68'}

type ProcessUpdateStep = {
  process_update: {
    update: string;
    current_slot: bigint;
    checks: Checks;
  };
};

type ForceUpdateStep = {
  force_update: {
    current_slot: bigint;
    checks: Checks;
  };
};

type LightclientSyncSteps = ProcessUpdateStep | ForceUpdateStep;

const logger = testLogger("spec-test");
const UPDATE_FILE_NAME = "^(update)_([0-9a-zA-Z_]+)$";

export const sync: TestRunnerFn<SyncTestCase, void> = (fork) => {
  return {
    testFunction: async (testcase) => {
      await init("blst-native");

      // Grab only the ALTAIR_FORK_EPOCH, since the domains are the same as minimal
      const config = createBeaconConfig(
        pickConfigForkEpochs(testcase.config),
        fromHex(testcase.meta.genesis_validators_root)
      );

      const lightClientOpts = {
        allowForcedUpdates: true,
        updateHeadersOnForcedUpdate: true,
      };
      const lightClient = new LightclientSpec(config, lightClientOpts, testcase.bootstrap);

      const stepsLen = testcase.steps.length;

      function toHeaderSummary(header: phase0.BeaconBlockHeader): {root: string; slot: number} {
        return {
          root: toHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(header)),
          slot: header.slot,
        };
      }

      function assertHeader(actualHeader: phase0.BeaconBlockHeader, expectedHeader: CheckHeader, msg: string): void {
        expect(toHeaderSummary(actualHeader)).deep.equals(
          {root: expectedHeader.beacon_root, slot: Number(expectedHeader.slot as bigint)},
          msg
        );
      }

      function runChecks(update: {checks: Checks}): void {
        assertHeader(lightClient.store.finalizedHeader.beacon, update.checks.finalized_header, "wrong finalizedHeader");
        assertHeader(
          lightClient.store.optimisticHeader.beacon,
          update.checks.optimistic_header,
          "wrong optimisticHeader"
        );
      }

      function renderSlot(currentSlot: Slot): {currentSlot: number; curretPeriod: number} {
        return {currentSlot, curretPeriod: computeSyncPeriodAtSlot(currentSlot)};
      }

      for (const [i, step] of testcase.steps.entries()) {
        try {
          if (isProcessUpdateStep(step)) {
            const currentSlot = Number(step.process_update.current_slot as bigint);
            logger.debug(`Step ${i}/${stepsLen} process_update`, renderSlot(currentSlot));

            const updateBytes = testcase.updates.get(step.process_update.update);
            if (!updateBytes) {
              throw Error(`update ${step.process_update.update} not found`);
            }

            const headerSlot = Number(step.process_update.checks.optimistic_header.slot);
            const update = config.getLightClientForkTypes(headerSlot)["LightClientUpdate"].deserialize(updateBytes);

            logger.debug(`LightclientUpdateSummary: ${JSON.stringify(toLightClientUpdateSummary(update))}`);

            lightClient.onUpdate(currentSlot, update);
            runChecks(step.process_update);
          }

          // force_update step
          else if (isForceUpdateStep(step)) {
            const currentSlot = Number(step.force_update.current_slot as bigint);
            logger.debug(`Step ${i}/${stepsLen} force_update`, renderSlot(currentSlot));

            // Simulate force_update()
            lightClient.forceUpdate(currentSlot);

            // lightClient.forceUpdate();
            runChecks(step.force_update);
          }

          logger.debug(
            `finalizedHeader = ${JSON.stringify(toHeaderSummary(lightClient.store.finalizedHeader.beacon))}` +
              ` optimisticHeader = ${JSON.stringify(toHeaderSummary(lightClient.store.optimisticHeader.beacon))}`
          );
        } catch (e) {
          (e as Error).message = `Error on step ${i}/${stepsLen}: ${(e as Error).message}`;
          throw e;
        }
      }
    },
    options: {
      inputTypes: {
        meta: InputType.YAML,
        steps: InputType.YAML,
        config: InputType.YAML,
      },
      sszTypes: {
        bootstrap: isForkLightClient(fork)
          ? ssz.allForksLightClient[fork].LightClientBootstrap
          : ssz.altair.LightClientBootstrap,
        // The updates are multifork and need config and step info to be deserialized within the test
        [UPDATE_FILE_NAME]: {typeName: "LightClientUpdate", deserialize: (bytes: Uint8Array) => bytes},
      },
      mapToTestCase: (t: Record<string, any>) => {
        // t has input file name as key
        const updates = new Map<string, Uint8Array>();
        for (const key in t) {
          const updateMatch = key.match(UPDATE_FILE_NAME);
          if (updateMatch) {
            updates.set(key, t[key]);
          }
        }
        return {
          ...t,
          updates,
        } as SyncTestCase;
      },
      timeout: 10000,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      expectFunc: () => {},
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

function pickConfigForkEpochs(config: Partial<ChainConfig>): Partial<ChainConfig> {
  const configOnlyFork: Record<string, number> = {};
  for (const key of Object.keys(config) as (keyof ChainConfig)[]) {
    if (key.endsWith("_FORK_EPOCH")) {
      configOnlyFork[key] = config[key] as number;
    }
  }
  return configOnlyFork;
}

function isProcessUpdateStep(step: unknown): step is ProcessUpdateStep {
  return (step as ProcessUpdateStep).process_update !== undefined;
}

function isForceUpdateStep(step: unknown): step is ForceUpdateStep {
  return (step as ForceUpdateStep).force_update !== undefined;
}
