import {expect} from "vitest";
import {ChainConfig, createBeaconConfig} from "@lodestar/config";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName, ForkPostAltair, ForkSeq, isForkPostAltair} from "@lodestar/params";
import {InputType} from "@lodestar/spec-test-util";
import {computeSyncPeriodAtSlot} from "@lodestar/state-transition";
import {
  LightclientSpec,
  getLcExecutionRoot,
  toLightClientUpdateSummary,
  upgradeLightClientBootstrap,
  upgradeLightClientStore,
  upgradeLightClientUpdate,
} from "@lodestar/state-transition/light-client";
import {
  LightClientBootstrap,
  LightClientHeader,
  LightClientUpdate,
  RootHex,
  Slot,
  phase0,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {fromHex, intToBytes, toHex} from "@lodestar/utils";
import {TestRunnerFn} from "../../utils/types.js";

// https://github.com/ethereum/consensus-specs/blob/master/tests/formats/light_client/sync.md
type SyncTestCase = {
  meta: {
    genesis_validators_root: RootHex;
    trusted_block_root: RootHex;
    bootstrap_fork_digest: string;
    store_fork_version: string;
  };
  steps: LightclientSyncSteps[];
  config: Partial<ChainConfig>;
  bootstrap: LightClientBootstrap;

  // Injected after parsing
  // However updates are multifork and need config and step access to deserialize inside test
  updates: Map<string, Uint8Array>;
};

type CheckHeader = {
  slot: bigint;
  beacon_root: RootHex;
  execution_root?: RootHex;
};

type Checks = {
  /** store.finalized_header */
  finalized_header: CheckHeader;
  /** store.optimistic_header */
  optimistic_header: CheckHeader;
};

// - process_update:
//     update_fork_digest: "0xfdb20282"
//     update: update_0x460ec66196a5732b306791e82a0d949b49be812cf09b72667fe90735994c3b68_sf
//     current_slot: 97
//     checks:
//       finalized_header: {slot: 72, beacon_root: "0x...", execution_root: "0x..."}
//       optimistic_header: {slot: 96, beacon_root: "0x...", execution_root: "0x..."}
type ProcessUpdateStep = {
  process_update: {
    update_fork_digest: string;
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

type UpgradeStoreStep = {
  upgrade_store: {
    store_fork_version: string;
    checks: Checks;
  };
};

type LightclientSyncSteps = ProcessUpdateStep | ForceUpdateStep | UpgradeStoreStep;

const logger = testLogger("spec-test");
const UPDATE_FILE_NAME = "^(update)_([0-9a-zA-Z_]+)$";

export const sync: TestRunnerFn<SyncTestCase, void> = (fork) => {
  return {
    testFunction: async (testcase) => {
      // Fork digests depend on the vector's fork epochs, versions, and BPO schedule.
      const config = createBeaconConfig(
        pickConfigForkValues(testcase.config),
        fromHex(testcase.meta.genesis_validators_root)
      );
      let storeFork = getForkFromVersion(config, testcase.meta.store_fork_version);
      const bootstrapFork = config.forkDigest2ForkBoundary(fromHex(testcase.meta.bootstrap_fork_digest)).fork;
      const bootstrap = maybeUpgradeBootstrap(config, bootstrapFork, storeFork, testcase.bootstrap);

      const lightClientOpts = {
        allowForcedUpdates: true,
        updateHeadersOnForcedUpdate: true,
      };
      const lightClient = new LightclientSpec(config, lightClientOpts, bootstrap);
      let latestSignatureSlot = bootstrap.header.beacon.slot;

      const stepsLen = testcase.steps.length;

      function toHeaderSummary(header: phase0.BeaconBlockHeader): {root: string; slot: number} {
        return {
          root: toHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(header)),
          slot: header.slot,
        };
      }

      function assertHeader(actualHeader: LightClientHeader, expectedHeader: CheckHeader, msg: string): void {
        expect(toHeaderSummary(actualHeader.beacon)).deep.equals(
          {root: expectedHeader.beacon_root, slot: Number(expectedHeader.slot)},
          msg
        );
        if (expectedHeader.execution_root !== undefined) {
          expect(toHex(getLcExecutionRoot(config, actualHeader))).equals(
            expectedHeader.execution_root,
            `${msg} executionRoot`
          );
        }
      }

      function runChecks(checks: Checks): void {
        assertHeader(lightClient.store.finalizedHeader, checks.finalized_header, "wrong finalizedHeader");
        assertHeader(lightClient.store.optimisticHeader, checks.optimistic_header, "wrong optimisticHeader");
      }

      function renderSlot(currentSlot: Slot): {currentSlot: number; curretPeriod: number} {
        return {currentSlot, curretPeriod: computeSyncPeriodAtSlot(currentSlot)};
      }

      for (const [i, step] of testcase.steps.entries()) {
        try {
          if (isProcessUpdateStep(step)) {
            const {process_update: processUpdate} = step;
            const currentSlot = Number(processUpdate.current_slot);
            logger.debug(`Step ${i}/${stepsLen} process_update`, renderSlot(currentSlot));

            const updateBytes = testcase.updates.get(processUpdate.update);
            if (!updateBytes) {
              throw Error(`update ${processUpdate.update} not found`);
            }

            // Decode the original network object using its context fork before upgrading it to the store's fork.
            const updateFork = onlyPostAltairFork(
              config.forkDigest2ForkBoundary(fromHex(processUpdate.update_fork_digest)).fork
            );
            let update = sszTypesFor(updateFork).LightClientUpdate.deserialize(updateBytes) as LightClientUpdate;
            if (ForkSeq[updateFork] < ForkSeq[storeFork]) {
              update = upgradeLightClientUpdate(config, storeFork, update);
            }

            logger.debug(`LightclientUpdateSummary: ${JSON.stringify(toLightClientUpdateSummary(update))}`);

            lightClient.onUpdate(currentSlot, update);
            latestSignatureSlot = update.signatureSlot;
            runChecks(processUpdate.checks);
          }

          // force_update step
          else if (isForceUpdateStep(step)) {
            const {force_update: forceUpdate} = step;
            const currentSlot = Number(forceUpdate.current_slot);
            logger.debug(`Step ${i}/${stepsLen} force_update`, renderSlot(currentSlot));

            // Simulate force_update()
            lightClient.forceUpdate(currentSlot);
            runChecks(forceUpdate.checks);
          }

          // upgrade_store step
          else if (isUpgradeStoreStep(step)) {
            const {upgrade_store: upgradeStore} = step;
            const targetFork = getForkFromVersion(config, upgradeStore.store_fork_version);
            logger.debug(`Step ${i}/${stepsLen} upgrade_store`, {storeFork, targetFork});

            upgradeLightClientStore(config, targetFork, lightClient.store, latestSignatureSlot);
            storeFork = targetFork;
            runChecks(upgradeStore.checks);
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
        bootstrap: isForkPostAltair(fork) ? sszTypesFor(fork).LightClientBootstrap : ssz.altair.LightClientBootstrap,
        // Updates are multifork and need their step's fork digest to select the SSZ type inside the test.
        [UPDATE_FILE_NAME]: {typeName: "LightClientUpdate", deserialize: (bytes: Uint8Array) => bytes},
      },
      mapToTestCase: (t: Record<string, unknown>) => {
        // t has input file name as key
        // Collect dynamically named update files for fork-aware deserialization in each process_update step.
        const updates = new Map<string, Uint8Array>();
        for (const [key, value] of Object.entries(t)) {
          if (key.match(UPDATE_FILE_NAME)) {
            updates.set(key, value as Uint8Array);
          }
        }
        return {...t, updates} as SyncTestCase;
      },
      timeout: 10000,
      expectFunc: () => {},
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/utils/specTestIterator.ts.
    },
  };
};

function onlyPostAltairFork(fork: ForkName): ForkPostAltair {
  if (!isForkPostAltair(fork)) {
    throw Error(`Invalid light client fork ${fork}`);
  }
  return fork;
}

function maybeUpgradeBootstrap(
  config: ReturnType<typeof createBeaconConfig>,
  bootstrapFork: ForkName,
  storeFork: ForkName,
  bootstrap: LightClientBootstrap
): LightClientBootstrap {
  if (ForkSeq[bootstrapFork] < ForkSeq[storeFork]) {
    return upgradeLightClientBootstrap(config, storeFork, bootstrap);
  }
  return bootstrap;
}

function getForkFromVersion(config: ReturnType<typeof createBeaconConfig>, versionHex: string): ForkName {
  const version = fromHex(versionHex);
  for (const fork of config.forksAscendingEpochOrder) {
    if (ssz.Version.equals(fork.version, version)) {
      return fork.name;
    }
  }
  throw Error(`Unknown fork version ${versionHex}`);
}

function pickConfigForkValues(config: Partial<ChainConfig>): Partial<ChainConfig> {
  const forkConfig: Partial<ChainConfig> = {};
  for (const key of Object.keys(config) as (keyof ChainConfig)[]) {
    const value = config[key];
    if (key.endsWith("_FORK_EPOCH") && typeof value === "bigint") {
      // Overwrite 2^64 to Infinity for an unscheduled fork.
      forkConfig[key] = (value > BigInt(Number.MAX_SAFE_INTEGER) ? Infinity : Number(value)) as never;
    } else if (key.endsWith("_FORK_VERSION") && typeof value === "bigint") {
      forkConfig[key] = intToBytes(value, 4, "be") as never;
    } else if (key === "BLOB_SCHEDULE" && Array.isArray(value)) {
      forkConfig[key] = value.map((entry) => ({
        EPOCH: Number(entry.EPOCH),
        MAX_BLOBS_PER_BLOCK: Number(entry.MAX_BLOBS_PER_BLOCK),
      }));
    }
  }
  return forkConfig;
}

function isProcessUpdateStep(step: LightclientSyncSteps): step is ProcessUpdateStep {
  return "process_update" in step;
}

function isForceUpdateStep(step: LightclientSyncSteps): step is ForceUpdateStep {
  return "force_update" in step;
}

function isUpgradeStoreStep(step: LightclientSyncSteps): step is UpgradeStoreStep {
  return "upgrade_store" in step;
}
