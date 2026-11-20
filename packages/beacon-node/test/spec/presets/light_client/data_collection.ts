import {expect} from "vitest";
import {ChainConfig, createBeaconConfig} from "@lodestar/config";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkPostAltair, ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {InputType} from "@lodestar/spec-test-util";
import {
  BeaconStateAllForks,
  BeaconStateView,
  CachedBeaconStateAllForks,
  CachedBeaconStateGloas,
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  IBeaconStateViewAltair,
  stateTransition,
} from "@lodestar/state-transition";
import {
  BeaconBlock,
  LightClientBootstrap,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  LightClientUpdate,
  RootHex,
  SignedBeaconBlock,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {LightClientServer, blockToLightClientHeader} from "../../../../src/chain/lightClient/index.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";
import {startIsolatedTmpBeaconDb} from "../../../utils/db.js";
import {TestRunnerFn} from "../../utils/types.js";
import {pickConfigForkValues} from "./config.js";

// https://github.com/ethereum/consensus-specs/blob/v1.7.0-beta.4/tests/formats/light_client/data_collection.md
type EncodedObject = {
  fork_digest: string;
  data: string;
};

type Checks = {
  latest_finalized_checkpoint: {epoch: bigint; root: RootHex};
  bootstraps?: {block_root: RootHex; bootstrap?: EncodedObject}[];
  best_updates?: {period: bigint; update?: EncodedObject}[];
  latest_finality_update?: EncodedObject;
  latest_optimistic_update?: EncodedObject;
};

type DataCollectionStep = {new_block: EncodedObject} | {new_head: {head_block_root: RootHex; checks: Checks}};

type DataCollectionTestCase = {
  initial_state: Uint8Array;
  steps: DataCollectionStep[];
  config: Partial<ChainConfig>;
  manifest: {preset: string; fork: string};
  meta?: {bls_setting?: bigint};
  // Injected after parsing
  files: Map<string, Uint8Array>;
};

const BLOCK_FILE_NAME = "^block_";
const BOOTSTRAP_FILE_NAME = "^bootstrap_";
const UPDATE_FILE_NAME = "^update_";
const FINALITY_UPDATE_FILE_NAME = "^finality_update_";
const OPTIMISTIC_UPDATE_FILE_NAME = "^optimistic_update_";
const FILE_NAME_PREFIXES = [
  BLOCK_FILE_NAME,
  BOOTSTRAP_FILE_NAME,
  UPDATE_FILE_NAME,
  FINALITY_UPDATE_FILE_NAME,
  OPTIMISTIC_UPDATE_FILE_NAME,
].map((pattern) => pattern.slice(1));

const logger = testLogger("spec-test");

/**
 * Full node side of the light client protocol: import blocks, move the head, and check that the
 * derived bootstraps and updates match the vectors.
 */
export const dataCollection: TestRunnerFn<DataCollectionTestCase, void> = (fork) => {
  return {
    testFunction: async (testcase) => {
      const state = sszTypesFor(fork).BeaconState.deserializeToViewDU(
        testcase.initial_state
      ) as unknown as BeaconStateAllForks;
      const config = createBeaconConfig(pickConfigForkValues(testcase.config), state.genesisValidatorsRoot);

      const {db, close} = await startIsolatedTmpBeaconDb(config, "lodestar-lc-data-collection-");
      try {
        const server = new LightClientServer(
          {},
          {
            config,
            db,
            // Head selection is driven by the vectors, so updates are never treated as recent
            clock: {currentSlot: Number.MAX_SAFE_INTEGER} as never,
            metrics: null,
            emitter: {emit: () => {}} as never,
            logger,
            signal: new AbortController().signal,
          }
        );

        const genesisState = createCachedBeaconStateTest(state, config);
        const genesisHeader = {
          ...genesisState.latestBlockHeader.toValue(),
          stateRoot: genesisState.hashTreeRoot(),
        };
        const genesisRoot = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(genesisHeader));

        const statesByRoot = new Map<RootHex, CachedBeaconStateAllForks>([[genesisRoot, genesisState]]);

        // Genesis is never imported, but it is a valid bootstrap target and the first block attests to it.
        // Its body is the default one, see `create_signed_genesis_block` in the spec test helpers.
        const genesisFork = fork as ForkPostAltair;
        const genesisBlock = sszTypesFor(genesisFork).BeaconBlock.defaultValue() as BeaconBlock<ForkPostAltair>;
        genesisBlock.slot = genesisHeader.slot;
        genesisBlock.proposerIndex = genesisHeader.proposerIndex;
        genesisBlock.parentRoot = genesisHeader.parentRoot;
        genesisBlock.stateRoot = genesisHeader.stateRoot;
        if (isForkPostGloas(genesisFork)) {
          (genesisBlock as BeaconBlock<ForkPostGloas>).body.signedExecutionPayloadBid.message = (
            genesisState as CachedBeaconStateGloas
          ).latestExecutionPayloadBid.toValue();
        }
        const genesisLightClientHeader = blockToLightClientHeader(genesisFork, genesisBlock);
        expect(toRootHex(genesisLightClientHeader.beacon.bodyRoot)).toEqual(toRootHex(genesisHeader.bodyRoot));
        await server.initAnchor(
          fromHex(genesisRoot),
          genesisLightClientHeader,
          new BeaconStateView(genesisState) as IBeaconStateViewAltair
        );

        const getFile = (name: string): Uint8Array => {
          const bytes = testcase.files.get(name);
          if (!bytes) throw Error(`File ${name} not found`);
          return bytes;
        };

        const forkOfDigest = (digestHex: string): ForkPostAltair =>
          config.forkDigest2ForkBoundary(fromHex(digestHex)).fork as ForkPostAltair;

        for (const [i, step] of testcase.steps.entries()) {
          try {
            if (isNewBlockStep(step)) {
              const blockFork = forkOfDigest(step.new_block.fork_digest);
              const signedBlock = sszTypesFor(blockFork).SignedBeaconBlock.deserialize(
                getFile(step.new_block.data)
              ) as SignedBeaconBlock;
              const parentRootHex = toRootHex(signedBlock.message.parentRoot);
              const preState = statesByRoot.get(parentRootHex);
              if (!preState) {
                throw Error(`No post state for parent ${parentRootHex}`);
              }

              const block = signedBlock.message as BeaconBlock<ForkPostAltair>;
              const postState = stateTransition(preState, signedBlock, {
                executionPayloadStatus: ExecutionPayloadStatus.valid,
                dataAvailabilityStatus: DataAvailabilityStatus.Available,
                verifyProposer: false,
                verifyStateRoot: true,
              });
              const blockRootHex = toRootHex(
                ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockToLightClientHeader(blockFork, block).beacon)
              );

              await server.onImportBlockHead(
                block,
                new BeaconStateView(postState) as IBeaconStateViewAltair,
                preState.slot
              );
              statesByRoot.set(blockRootHex, postState);
            } else {
              const {head_block_root: headRootHex, checks} = step.new_head;
              const headState = statesByRoot.get(headRootHex);
              if (!headState) {
                throw Error(`No post state for head ${headRootHex}`);
              }

              await server.updateHead(fromHex(headRootHex), headState.finalizedCheckpoint);
              await runChecks(server, config, getFile, headState, checks);
            }
          } catch (e) {
            (e as Error).message = `Error on step ${i}: ${(e as Error).message}`;
            throw e;
          }
        }
      } finally {
        await close();
      }
    },
    options: {
      inputTypes: {
        initial_state: InputType.SSZ_SNAPPY,
        steps: InputType.YAML,
        config: InputType.YAML,
        manifest: InputType.YAML,
      },
      sszTypes: {
        initial_state: {
          typeName: "BeaconState",
          deserialize: (bytes: Uint8Array) => bytes,
          deserializeToViewDU: (bytes: Uint8Array) => bytes,
        },
        [BLOCK_FILE_NAME]: {typeName: "SignedBeaconBlock", deserialize: (bytes: Uint8Array) => bytes},
        [BOOTSTRAP_FILE_NAME]: {typeName: "LightClientBootstrap", deserialize: (bytes: Uint8Array) => bytes},
        [UPDATE_FILE_NAME]: {typeName: "LightClientUpdate", deserialize: (bytes: Uint8Array) => bytes},
        [FINALITY_UPDATE_FILE_NAME]: {typeName: "LightClientFinalityUpdate", deserialize: (bytes: Uint8Array) => bytes},
        [OPTIMISTIC_UPDATE_FILE_NAME]: {
          typeName: "LightClientOptimisticUpdate",
          deserialize: (bytes: Uint8Array) => bytes,
        },
      },
      mapToTestCase: (t: Record<string, unknown>) => {
        const files = new Map<string, Uint8Array>();
        for (const [key, value] of Object.entries(t)) {
          if (FILE_NAME_PREFIXES.some((prefix) => key.startsWith(prefix))) {
            files.set(key, value as Uint8Array);
          }
        }
        return {...t, files} as DataCollectionTestCase;
      },
      timeout: 120000,
      expectFunc: () => {},
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/utils/specTestIterator.ts.
    },
  };
};

async function runChecks(
  server: LightClientServer,
  config: ReturnType<typeof createBeaconConfig>,
  getFile: (name: string) => Uint8Array,
  headState: CachedBeaconStateAllForks,
  checks: Checks
): Promise<void> {
  expect(Number(checks.latest_finalized_checkpoint.epoch)).toEqual(headState.finalizedCheckpoint.epoch);
  expect(toRootHex(headState.finalizedCheckpoint.root)).toEqual(checks.latest_finalized_checkpoint.root);

  for (const entry of checks.bootstraps ?? []) {
    const actual = await getBootstrapOrNull(server, fromHex(entry.block_root));
    if (!entry.bootstrap) {
      expect(actual).toBeNull();
      continue;
    }
    const types = sszTypesFor(forkOfDigest(config, entry.bootstrap.fork_digest));
    const expected = types.LightClientBootstrap.deserialize(getFile(entry.bootstrap.data));
    if (!actual) {
      throw Error(`bootstrap ${entry.block_root} should be available`);
    }
    expect(types.LightClientBootstrap.hashTreeRoot(actual)).toEqual(types.LightClientBootstrap.hashTreeRoot(expected));
  }

  for (const entry of checks.best_updates ?? []) {
    const actual = await getUpdateOrNull(server, Number(entry.period));
    if (!entry.update) {
      expect(actual).toBeNull();
      continue;
    }
    const types = sszTypesFor(forkOfDigest(config, entry.update.fork_digest));
    const expected = types.LightClientUpdate.deserialize(getFile(entry.update.data));
    if (!actual) {
      throw Error(`update for period ${entry.period} should be available`);
    }
    expect(types.LightClientUpdate.hashTreeRoot(actual)).toEqual(types.LightClientUpdate.hashTreeRoot(expected));
  }

  expectLatestUpdate(config, getFile, "finality", server.getFinalityUpdate(), checks.latest_finality_update);
  expectLatestUpdate(config, getFile, "optimistic", server.getOptimisticUpdate(), checks.latest_optimistic_update);
}

function forkOfDigest(config: ReturnType<typeof createBeaconConfig>, digestHex: string): ForkPostAltair {
  return config.forkDigest2ForkBoundary(fromHex(digestHex)).fork as ForkPostAltair;
}

async function getBootstrapOrNull(
  server: LightClientServer,
  blockRoot: Uint8Array
): Promise<LightClientBootstrap | null> {
  try {
    return await server.getBootstrap(blockRoot);
  } catch {
    return null;
  }
}

async function getUpdateOrNull(server: LightClientServer, period: number): Promise<LightClientUpdate | null> {
  try {
    return await server.getUpdate(period);
  } catch {
    return null;
  }
}

type LatestUpdateKind = "finality" | "optimistic";

function expectLatestUpdate(
  config: ReturnType<typeof createBeaconConfig>,
  getFile: (name: string) => Uint8Array,
  kind: LatestUpdateKind,
  actual: LightClientFinalityUpdate | LightClientOptimisticUpdate | null,
  encoded: EncodedObject | undefined
): void {
  const label = `latest_${kind}_update`;
  if (!encoded) {
    expect(actual).toBeNull();
    return;
  }
  const types = sszTypesFor(forkOfDigest(config, encoded.fork_digest));
  if (!actual) {
    throw Error(`${label} should be available`);
  }
  if (kind === "finality") {
    expect(types.LightClientFinalityUpdate.hashTreeRoot(actual as LightClientFinalityUpdate)).toEqual(
      types.LightClientFinalityUpdate.hashTreeRoot(types.LightClientFinalityUpdate.deserialize(getFile(encoded.data)))
    );
  } else {
    expect(types.LightClientOptimisticUpdate.hashTreeRoot(actual as LightClientOptimisticUpdate)).toEqual(
      types.LightClientOptimisticUpdate.hashTreeRoot(
        types.LightClientOptimisticUpdate.deserialize(getFile(encoded.data))
      )
    );
  }
}

function isNewBlockStep(step: DataCollectionStep): step is {new_block: EncodedObject} {
  return "new_block" in step;
}
