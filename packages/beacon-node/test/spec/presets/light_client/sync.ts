import {expect} from "chai";
import {altair, phase0, RootHex, ssz} from "@lodestar/types";
import {init} from "@chainsafe/bls/switchable";
import {InputType} from "@lodestar/spec-test-util";
import {createIBeaconConfig, IChainConfig} from "@lodestar/config";
import {fromHex, toHex} from "@lodestar/utils";
import {LightclientSpec} from "@lodestar/light-client/spec";
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
  config: Partial<IChainConfig>;
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
  updates: Map<string, altair.LightClientUpdate>;
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

export const sync: TestRunnerFn<SyncTestCase, void> = () => {
  return {
    testFunction: async (testcase) => {
      await init("blst-native");

      // Grab only the ALTAIR_FORK_EPOCH, since the domains are the same as minimal
      const config = createIBeaconConfig(
        pickConfigForkEpochs(testcase.config),
        fromHex(testcase.meta.genesis_validators_root)
      );

      const lightClient = new LightclientSpec(config, testcase.bootstrap, fromHex(testcase.meta.trusted_block_root));

      const stepsLen = testcase.steps.length;

      function updateClock(update: {current_slot: bigint}): void {
        lightClient.currentSlot = Number(update.current_slot as bigint);
      }

      function assertHeader(checkHeader: CheckHeader, storeHeader: phase0.BeaconBlockHeader, msg: string): void {
        expect({root: checkHeader.beacon_root, slot: Number(checkHeader.slot as bigint)}).deep.equals(
          {root: toHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(storeHeader)), slot: storeHeader.slot},
          msg
        );
      }

      function runChecks(update: {checks: Checks}): void {
        assertHeader(update.checks.finalized_header, lightClient.store.finalizedHeader, "wrong finalizedHeader");
        assertHeader(update.checks.optimistic_header, lightClient.store.optimisticHeader, "wrong optimisticHeader");
      }

      for (const [i, step] of testcase.steps.entries()) {
        try {
          if (isProcessUpdateStep(step)) {
            logger.debug(`Step ${i}/${stepsLen} process_update`, {currentSlot: step.process_update.current_slot});
            updateClock(step.process_update);

            const update = testcase.updates.get(step.process_update.update);
            if (!update) {
              throw Error(`update ${step.process_update.update} not found`);
            }

            lightClient.onUpdate(update);
            runChecks(step.process_update);
          }

          // force_update step
          else if (isForceUpdateStep(step)) {
            logger.debug(`Step ${i}/${stepsLen} force_update`, {currentSlot: step.force_update.current_slot});
            updateClock(step.force_update);

            lightClient.forceUpdate();
            runChecks(step.force_update);
          }
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
        bootstrap: ssz.altair.LightClientBootstrap,
        [UPDATE_FILE_NAME]: ssz.altair.LightClientUpdate,
      },
      mapToTestCase: (t: Record<string, any>) => {
        // t has input file name as key
        const updates = new Map<string, altair.LightClientUpdate>();
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

function pickConfigForkEpochs(config: Partial<IChainConfig>): Partial<IChainConfig> {
  const configOnlyFork: Record<string, number> = {};
  for (const key of Object.keys(config) as (keyof IChainConfig)[]) {
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
