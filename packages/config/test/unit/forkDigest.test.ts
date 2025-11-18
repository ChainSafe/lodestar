import {describe, expect, it} from "vitest";
import {fromHex as b, toHex} from "@lodestar/utils";
import {computeForkDigest, createCachedGenesis, createChainForkConfig} from "../../src/index.js";

// Test cases copied from https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.2/tests/core/pyspec/eth2spec/test/fulu/validator/test_compute_fork_digest.py
// TODO FULU: Add Electra scenarios to test cases when they are available in the spec repo
describe("fork digest", () => {
  const genesisValidatorRoot = Buffer.alloc(32, 0);
  const config = createChainForkConfig({
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 9,
    FULU_FORK_EPOCH: 100,
    BLOB_SCHEDULE: [
      {EPOCH: 9, MAX_BLOBS_PER_BLOCK: 9},
      {EPOCH: 100, MAX_BLOBS_PER_BLOCK: 100},
      {EPOCH: 150, MAX_BLOBS_PER_BLOCK: 175},
      {EPOCH: 200, MAX_BLOBS_PER_BLOCK: 200},
      {EPOCH: 250, MAX_BLOBS_PER_BLOCK: 275},
      {EPOCH: 300, MAX_BLOBS_PER_BLOCK: 300},
    ],
    FULU_FORK_VERSION: b("0x06000000"),
  });

  describe("computeForkDigest", () => {
    const testCases = [
      {
        epoch: 100,
        expectedForkDigest: "df67557b",
      },
      {
        epoch: 101,
        expectedForkDigest: "df67557b",
      },
      {
        epoch: 150,
        expectedForkDigest: "8ab38b59",
      },
      {
        epoch: 199,
        expectedForkDigest: "8ab38b59",
      },
      {
        epoch: 200,
        expectedForkDigest: "d9b81438",
      },
      {
        epoch: 201,
        expectedForkDigest: "d9b81438",
      },
      {
        epoch: 250,
        expectedForkDigest: "4ef32a62",
      },
      {
        epoch: 299,
        expectedForkDigest: "4ef32a62",
      },
      {
        epoch: 300,
        expectedForkDigest: "ca100d64",
      },
      {
        epoch: 301,
        expectedForkDigest: "ca100d64",
      },
    ];

    for (const testCase of testCases) {
      const {epoch, expectedForkDigest} = testCase;
      it(`should match fork digest at epoch ${epoch}`, () => {
        const forkDigest = toHex(computeForkDigest(config, genesisValidatorRoot, epoch));

        expect(forkDigest.slice(2)).toBe(expectedForkDigest);
      });
    }
  });

  describe("createCachedGenesis", () => {
    const cachedGenesis = createCachedGenesis(config, genesisValidatorRoot);

    const testCases = [
      {epoch: 100, expectedForkDigest: "df67557b"},
      {epoch: 101, expectedForkDigest: "df67557b"},
      {epoch: 150, expectedForkDigest: "8ab38b59"},
      {epoch: 199, expectedForkDigest: "8ab38b59"},
      {epoch: 200, expectedForkDigest: "d9b81438"},
      {epoch: 201, expectedForkDigest: "d9b81438"},
      {epoch: 250, expectedForkDigest: "4ef32a62"},
      {epoch: 299, expectedForkDigest: "4ef32a62"},
      {epoch: 300, expectedForkDigest: "ca100d64"},
      {epoch: 301, expectedForkDigest: "ca100d64"},
    ];

    for (const testCase of testCases) {
      const {epoch, expectedForkDigest} = testCase;
      it(`should match fork digest at epoch ${epoch}`, () => {
        const boundary = config.getForkBoundaryAtEpoch(epoch);
        const forkDigestHex = cachedGenesis.forkBoundary2ForkDigestHex(boundary);

        expect(forkDigestHex).toBe(expectedForkDigest);
        expect(boundary).toBe(cachedGenesis.forkDigest2ForkBoundary(expectedForkDigest));
      });
    }
  });
});
