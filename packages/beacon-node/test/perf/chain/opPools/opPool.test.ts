import {deepStrictEqual} from "node:assert";
import {beforeAll, bench, describe} from "@chainsafe/benchmark";
import {aggregateSignatures} from "@chainsafe/lodestar-z/blst";
import {type PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {
  ForkName,
  MAX_ATTESTER_SLASHINGS,
  MAX_BLS_TO_EXECUTION_CHANGES,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
} from "@lodestar/params";
import {
  BeaconStateView,
  CachedBeaconStateAltair,
  getAttesterSlashingSignatureSets,
  getProposerSlashingSignatureSets,
} from "@lodestar/state-transition";
import {generatePerfTestCachedStateAltair, getSecretKeyFromIndexCached} from "@lodestar/state-transition/test-utils";
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
  let originalState: BeaconStateView;
  let defaultPool: OpPool;
  let largePool: OpPool;

  beforeAll(
    () => {
      originalState = new BeaconStateView(generatePerfTestCachedStateAltair({goBackOneSlot: true}));
      const beaconState = originalState.cachedState as CachedBeaconStateAltair;
      defaultPool = createPool(beaconState);
      largePool = createPool(beaconState, 2_000);
      for (const [name, pool] of [
        ["default", defaultPool],
        ["2k", largePool],
      ] as const) {
        const [attesterSlashings, proposerSlashings] = pool.getSlashingsAndExits(originalState, BlockType.Full, null);
        deepStrictEqual(
          [attesterSlashings.length, proposerSlashings.length],
          [MAX_ATTESTER_SLASHINGS, MAX_PROPOSER_SLASHINGS],
          `Invalid slashing fixtures in ${name} pool`
        );
      }
    },
    10 * 60 * 1000 // Generate the state and sign all evidence outside the timed benchmark.
  );

  bench({
    id: "getSlashingsAndExits - default max",
    beforeEach: () => defaultPool,
    fn: (pool) => {
      pool.getSlashingsAndExits(originalState, BlockType.Full, null);
    },
  });

  bench({
    id: "getSlashingsAndExits - 2k",
    beforeEach: () => largePool,
    fn: (pool) => {
      pool.getSlashingsAndExits(originalState, BlockType.Full, null);
    },
  });
});

function createPool(state: CachedBeaconStateAltair, count?: number): OpPool {
  const pool = new OpPool(state.config);
  fillAttesterSlashing(pool, state, count ?? MAX_ATTESTER_SLASHINGS);
  fillProposerSlashing(pool, state, count ?? MAX_PROPOSER_SLASHINGS);
  fillVoluntaryExits(pool, state, count ?? MAX_VOLUNTARY_EXITS);
  fillBlsToExecutionChanges(state.epochCtx.pubkeyCache, pool, state, count ?? MAX_BLS_TO_EXECUTION_CHANGES);
  return pool;
}

function fillAttesterSlashing(pool: OpPool, state: CachedBeaconStateAltair, count: number): OpPool {
  for (const attestation of generateIndexedAttestations(state, count)) {
    attestation.attestingIndices.sort((a, b) => a - b);
    const slashing = {
      attestation1: ssz.phase0.IndexedAttestationBigint.fromJson(ssz.phase0.IndexedAttestation.toJson(attestation)),
      attestation2: ssz.phase0.IndexedAttestationBigint.fromJson(ssz.phase0.IndexedAttestation.toJson(attestation)),
    };
    slashing.attestation2.data.beaconBlockRoot[0] ^= 1;
    const sets = getAttesterSlashingSignatureSets(state.config, state.slot, slashing);
    for (const [i, indexedAttestation] of [slashing.attestation1, slashing.attestation2].entries()) {
      indexedAttestation.signature = aggregateSignatures(
        indexedAttestation.attestingIndices.map((index) => getSecretKeyFromIndexCached(index).sign(sets[i].signingRoot))
      ).toBytes();
    }
    pool.insertAttesterSlashing(ForkName.phase0, slashing);
  }

  return pool;
}

function fillProposerSlashing(pool: OpPool, state: CachedBeaconStateAltair, count: number): OpPool {
  for (const blockHeader of generateSignedBeaconBlockHeader(state, count)) {
    const slashing = {
      signedHeader1: ssz.phase0.SignedBeaconBlockHeaderBigint.fromJson(
        ssz.phase0.SignedBeaconBlockHeader.toJson(blockHeader)
      ),
      signedHeader2: ssz.phase0.SignedBeaconBlockHeaderBigint.fromJson(
        ssz.phase0.SignedBeaconBlockHeader.toJson(blockHeader)
      ),
    };
    slashing.signedHeader2.message.bodyRoot[0] ^= 1;
    const sets = getProposerSlashingSignatureSets(state.config, state.slot, slashing);
    const secretKey = getSecretKeyFromIndexCached(blockHeader.message.proposerIndex);
    slashing.signedHeader1.signature = secretKey.sign(sets[0].signingRoot).toBytes();
    slashing.signedHeader2.signature = secretKey.sign(sets[1].signingRoot).toBytes();
    pool.insertProposerSlashing(slashing);
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
