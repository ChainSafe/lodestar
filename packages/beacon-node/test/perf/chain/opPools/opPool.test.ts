import {afterAll, beforeAll, bench, describe} from "@chainsafe/benchmark";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {
  ForkName,
  MAX_ATTESTER_SLASHINGS,
  MAX_BLS_TO_EXECUTION_CHANGES,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
} from "@lodestar/params";
import {BeaconStateView, CachedBeaconStateAltair, PubkeyCache} from "@lodestar/state-transition";
import {clearPerfStateCache, generatePerfTestCachedStateAltair} from "@lodestar/state-transition/test-utils";
import {ssz} from "@lodestar/types";
import {BlockType} from "../../../../src/chain/interface.js";
import {OpPool} from "../../../../src/chain/opPools/opPool.js";
import {generateBlsToExecutionChanges} from "../../../fixtures/capella.js";
import {
  generateIndexedAttestations,
  generateSignedBeaconBlockHeader,
  generateVoluntaryExits,
} from "../../../fixtures/phase0.js";

describe("opPool", () => {
  let originalState: BeaconStateView | undefined;
  const config = createBeaconConfig(chainConfigDef, Buffer.alloc(32, 0xaa));

  const requireOriginalState = (): BeaconStateView => {
    if (!originalState) throw Error("originalState not initialized");
    return originalState;
  };

  beforeAll(
    () => {
      originalState = new BeaconStateView(generatePerfTestCachedStateAltair({goBackOneSlot: true}));
    },
    2 * 60 * 1000 // Generating the states for the first time is very slow
  );

  afterAll(() => {
    originalState = undefined;
    clearPerfStateCache();
  });

  bench({
    id: "getSlashingsAndExits - default max",
    beforeEach: () => {
      const pool = new OpPool(config);
      const beaconState = requireOriginalState().cachedState as CachedBeaconStateAltair;
      fillAttesterSlashing(pool, beaconState, MAX_ATTESTER_SLASHINGS);
      fillProposerSlashing(pool, beaconState, MAX_PROPOSER_SLASHINGS);
      fillVoluntaryExits(pool, beaconState, MAX_VOLUNTARY_EXITS);
      // TODO: feed pubkeyCache separately instead of getting from originalState
      fillBlsToExecutionChanges(beaconState.epochCtx.pubkeyCache, pool, beaconState, MAX_BLS_TO_EXECUTION_CHANGES);

      return pool;
    },
    fn: (pool) => {
      pool.getSlashingsAndExits(requireOriginalState(), BlockType.Full, null);
    },
  });

  bench({
    id: "getSlashingsAndExits - 2k",
    beforeEach: () => {
      const pool = new OpPool(config);
      const maxItemsInPool = 2_000;
      const beaconState = requireOriginalState().cachedState as CachedBeaconStateAltair;
      fillAttesterSlashing(pool, beaconState, maxItemsInPool);
      fillProposerSlashing(pool, beaconState, maxItemsInPool);
      fillVoluntaryExits(pool, beaconState, maxItemsInPool);
      // TODO: feed pubkeyCache separately instead of getting from originalState
      fillBlsToExecutionChanges(beaconState.epochCtx.pubkeyCache, pool, beaconState, maxItemsInPool);

      return pool;
    },
    fn: (pool) => {
      pool.getSlashingsAndExits(requireOriginalState(), BlockType.Full, null);
    },
  });
});

function fillAttesterSlashing(pool: OpPool, state: CachedBeaconStateAltair, count: number): OpPool {
  for (const attestation of generateIndexedAttestations(state, count)) {
    pool.insertAttesterSlashing(ForkName.phase0, {
      attestation1: ssz.phase0.IndexedAttestationBigint.fromJson(ssz.phase0.IndexedAttestation.toJson(attestation)),
      attestation2: ssz.phase0.IndexedAttestationBigint.fromJson(ssz.phase0.IndexedAttestation.toJson(attestation)),
    });
  }

  return pool;
}

function fillProposerSlashing(pool: OpPool, state: CachedBeaconStateAltair, count: number): OpPool {
  for (const blockHeader of generateSignedBeaconBlockHeader(state, count)) {
    pool.insertProposerSlashing({
      signedHeader1: ssz.phase0.SignedBeaconBlockHeaderBigint.fromJson(
        ssz.phase0.SignedBeaconBlockHeader.toJson(blockHeader)
      ),
      signedHeader2: ssz.phase0.SignedBeaconBlockHeaderBigint.fromJson(
        ssz.phase0.SignedBeaconBlockHeader.toJson(blockHeader)
      ),
    });
  }

  return pool;
}

function fillVoluntaryExits(pool: OpPool, state: CachedBeaconStateAltair, count: number): OpPool {
  for (const exit of generateVoluntaryExits(state, count)) {
    pool.insertVoluntaryExit(exit);
  }

  return pool;
}

// This does not set the `withdrawalCredentials` for the validator
// So it will be in the pool but not returned from `getSlashingsAndExits`
function fillBlsToExecutionChanges(
  pubkeyCache: PubkeyCache,
  pool: OpPool,
  state: CachedBeaconStateAltair,
  count: number
): OpPool {
  for (const blsToExecution of generateBlsToExecutionChanges(pubkeyCache, state, count)) {
    pool.insertBlsToExecutionChange(blsToExecution);
  }

  return pool;
}
