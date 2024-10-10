import {itBench} from "@dapplion/benchmark";
import {
  MAX_ATTESTER_SLASHINGS,
  MAX_BLS_TO_EXECUTION_CHANGES,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
} from "@lodestar/params";
import {CachedBeaconStateAltair} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {generatePerfTestCachedStateAltair} from "../../../../../state-transition/test/perf/util.js";
import {OpPool} from "../../../../src/chain/opPools/opPool.js";
import {generateBlsToExecutionChanges} from "../../../fixtures/capella.js";
import {
  generateIndexedAttestations,
  generateSignedBeaconBlockHeader,
  generateVoluntaryExits,
} from "../../../fixtures/phase0.js";
import {BlockType} from "../../../../src/chain/interface.js";

describe("opPool", () => {
  let originalState: CachedBeaconStateAltair;

  before(function () {
    this.timeout(2 * 60 * 1000); // Generating the states for the first time is very slow

    originalState = generatePerfTestCachedStateAltair({goBackOneSlot: true});
  });

  itBench({
    id: "getSlashingsAndExits - default max",
    beforeEach: () => {
      const pool = new OpPool();
      fillAttesterSlashing(pool, originalState, MAX_ATTESTER_SLASHINGS);
      fillProposerSlashing(pool, originalState, MAX_PROPOSER_SLASHINGS);
      fillVoluntaryExits(pool, originalState, MAX_VOLUNTARY_EXITS);
      fillBlsToExecutionChanges(pool, originalState, MAX_BLS_TO_EXECUTION_CHANGES);

      return pool;
    },
    fn: (pool) => {
      pool.getSlashingsAndExits(originalState, BlockType.Full, null);
    },
  });

  itBench({
    id: "getSlashingsAndExits - 2k",
    beforeEach: () => {
      const pool = new OpPool();
      const maxItemsInPool = 2_000;

      fillAttesterSlashing(pool, originalState, maxItemsInPool);
      fillProposerSlashing(pool, originalState, maxItemsInPool);
      fillVoluntaryExits(pool, originalState, maxItemsInPool);
      fillBlsToExecutionChanges(pool, originalState, maxItemsInPool);

      return pool;
    },
    fn: (pool) => {
      pool.getSlashingsAndExits(originalState, BlockType.Full, null);
    },
  });
});

function fillAttesterSlashing(pool: OpPool, state: CachedBeaconStateAltair, count: number): OpPool {
  for (const attestation of generateIndexedAttestations(state, count)) {
    pool.insertAttesterSlashing({
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
function fillBlsToExecutionChanges(pool: OpPool, state: CachedBeaconStateAltair, count: number): OpPool {
  for (const blsToExecution of generateBlsToExecutionChanges(state, count)) {
    pool.insertBlsToExecutionChange(blsToExecution);
  }

  return pool;
}
