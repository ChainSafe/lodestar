import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {rimraf} from "rimraf";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {LevelDbController} from "@lodestar/db/controller/level";
import {ssz} from "@lodestar/types";
import {defer, sleep, toHex} from "@lodestar/utils";
import {AttestationByTargetRepository} from "../../../src/slashingProtection/attestation/index.js";
import {
  InvalidAttestationErrorCode,
  SlashingProtection,
  SlashingProtectionAttestation,
} from "../../../src/slashingProtection/index.js";
import {testLogger} from "../../utils/logger.js";

/**
 * Min-span entries only exist within `DEFAULT_MAX_EPOCH_LOOKBACK` (4096) epochs below each recorded source epoch.
 * A surround vote with an older source epoch, as a malicious or buggy beacon node could serve, is undetectable
 * by min-max surround and must be rejected by the lookback window of the latest recorded attestation.
 */
describe("SlashingProtection attestation min-span lookback", () => {
  const pubkey = ssz.BLSPubkey.defaultValue();
  let dbLocation: string;
  let db: LevelDbController;
  let slashingProtection: SlashingProtection;

  beforeEach(async () => {
    dbLocation = fs.mkdtempSync(path.join(os.tmpdir(), "lodestar-slashing-protection-"));
    db = await LevelDbController.create({name: dbLocation}, {logger: testLogger()});
    slashingProtection = new SlashingProtection(db);
  });

  afterEach(async () => {
    await db.close();
    rimraf.sync(dbLocation);
  });

  async function sign(sourceEpoch: number, targetEpoch: number, root = 1): Promise<void> {
    const attestation: SlashingProtectionAttestation = {sourceEpoch, targetEpoch, signingRoot: Buffer.alloc(32, root)};
    await slashingProtection.checkAndInsertAttestation(pubkey, attestation);
  }

  function importInterchange(attestations: [source: number, target: number][]): Promise<void> {
    return slashingProtection.importInterchange(
      {
        metadata: {interchange_format_version: "5", genesis_validators_root: toHex(ssz.Root.defaultValue())},
        data: [
          {
            pubkey: toHex(pubkey),
            signed_blocks: [],
            signed_attestations: attestations.map(([source, target]) => ({
              source_epoch: String(source),
              target_epoch: String(target),
            })),
          },
        ],
      },
      ssz.Root.defaultValue()
    );
  }

  function rejectsWith(promise: Promise<void>, code: InvalidAttestationErrorCode): Promise<void> {
    return expect(promise).rejects.toThrow(expect.objectContaining({type: expect.objectContaining({code})}));
  }

  it("accepts the next attestation of an honest chain", async () => {
    await sign(299_999, 300_000);
    await expect(sign(300_000, 300_001)).resolves.toBeUndefined();
  });

  it("rejects a surrounding attestation whose source is older than the min-max span lookback", async () => {
    await sign(299_999, 300_000);
    await sign(300_000, 300_001);

    // Source 0 surrounds every attestation above but has no minSpan entry (300_000 - 4097 > 0)
    await rejectsWith(sign(0, 300_002), InvalidAttestationErrorCode.SOURCE_BELOW_MIN_SPAN_LOOKBACK);
  });

  it("rejects a surrounding attestation inside the min-max span lookback via min-max spans", async () => {
    await sign(10_000, 10_001);
    await rejectsWith(sign(9_000, 10_002), InvalidAttestationErrorCode.NEW_SURROUNDS_PREV);
  });

  it("rejects a surrounding attestation inside an offline gap larger than the lookback", async () => {
    await sign(99_999, 100_000);
    // Validator offline for ~10_000 epochs, then resumes
    await sign(109_999, 110_000);

    // Surrounds (109_999, 110_000); minSpan has no entry for 100_500 (below 109_999 - 4097)
    await rejectsWith(sign(100_500, 110_001), InvalidAttestationErrorCode.SOURCE_BELOW_MIN_SPAN_LOOKBACK);
  });

  it("accounts for attestations added by an interchange import", async () => {
    await sign(10, 11);
    // (0, 1) keeps the interchange lower bound loose so only the lookback window can reject below
    await importInterchange([
      [0, 1],
      [20_000, 20_001],
    ]);

    // Surrounds the imported (20000, 20001); no minSpan entry for 5000 (below 20000 - 4097)
    await rejectsWith(sign(5_000, 20_002), InvalidAttestationErrorCode.SOURCE_BELOW_MIN_SPAN_LOOKBACK);
  });

  it("rejects an interchange import whose highest target attestation surrounds one beyond the lookback", async () => {
    // (0, 20000) surrounds (10000, 10001) but 0 is below its min-span coverage
    await rejectsWith(
      importInterchange([
        [10_000, 10_001],
        [0, 20_000],
      ]),
      InvalidAttestationErrorCode.NEW_SURROUNDS_PREV
    );
  });

  it("rejects a double vote for a target recorded by an interchange import", async () => {
    await sign(10, 11);
    await sign(11, 12);
    await importInterchange([[12, 13]]);

    await rejectsWith(sign(12, 13, 2), InvalidAttestationErrorCode.DOUBLE_VOTE);
  });

  // The oldest epoch with a min-span entry for a recorded source `s` is `s - 1 - DEFAULT_MAX_EPOCH_LOOKBACK` (4096)
  it("accepts a non-slashable source epoch at the edge of the min-max span lookback window", async () => {
    await sign(10_000, 10_001);
    await expect(sign(5_903, 10_000)).resolves.toBeUndefined();
  });

  it("rejects a source epoch just outside the min-max span lookback window", async () => {
    await sign(10_000, 10_001);
    await rejectsWith(sign(5_902, 10_000), InvalidAttestationErrorCode.SOURCE_BELOW_MIN_SPAN_LOOKBACK);
  });
});

describe("SlashingProtection overlapping attestation checks", () => {
  const pubkey = ssz.BLSPubkey.defaultValue();
  const attestation = {sourceEpoch: 9, targetEpoch: 10, signingRoot: Buffer.alloc(32, 1)};
  const conflict = {sourceEpoch: 9, targetEpoch: 10, signingRoot: Buffer.alloc(32, 2)};
  let dbLocation: string;
  let db: LevelDbController;
  let slashingProtection: SlashingProtection;
  let attestations: AttestationByTargetRepository;

  beforeEach(async () => {
    dbLocation = fs.mkdtempSync(path.join(os.tmpdir(), "lodestar-attestation-slashing-protection-"));
    db = await LevelDbController.create({name: dbLocation}, {logger: testLogger()});
    slashingProtection = new SlashingProtection(db);
    attestations = new AttestationByTargetRepository(db);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
    rimraf.sync(dbLocation);
  });

  it("rejects a double vote when checks for the same public key bytes overlap", async () => {
    const results = await Promise.allSettled([
      slashingProtection.checkAndInsertAttestation(pubkey, attestation),
      slashingProtection.checkAndInsertAttestation(Uint8Array.from(pubkey), conflict),
    ]);

    expect(results).toMatchObject([
      {status: "fulfilled"},
      {status: "rejected", reason: {type: {code: InvalidAttestationErrorCode.DOUBLE_VOTE}}},
    ]);
    expect(await attestations.getAll(pubkey)).toEqual([attestation]);
  });

  it("accepts overlapping checks for the same attestation", async () => {
    await Promise.all([
      slashingProtection.checkAndInsertAttestation(pubkey, attestation),
      slashingProtection.checkAndInsertAttestation(pubkey, attestation),
    ]);

    expect(await attestations.getAll(pubkey)).toEqual([attestation]);
  });

  it("rejects a surround vote when checks for different targets overlap", async () => {
    const surrounding = {sourceEpoch: 8, targetEpoch: 11, signingRoot: Buffer.alloc(32, 3)};
    const results = await Promise.allSettled([
      slashingProtection.checkAndInsertAttestation(pubkey, attestation),
      slashingProtection.checkAndInsertAttestation(pubkey, surrounding),
    ]);

    expect(results).toMatchObject([
      {status: "fulfilled"},
      {status: "rejected", reason: {type: {code: InvalidAttestationErrorCode.NEW_SURROUNDS_PREV}}},
    ]);
    expect(await attestations.getAll(pubkey)).toEqual([attestation]);
  });

  it("continues queued checks after a double vote is rejected", async () => {
    await slashingProtection.checkAndInsertAttestation(pubkey, attestation);
    const next = {sourceEpoch: 10, targetEpoch: 11, signingRoot: Buffer.alloc(32, 1)};
    const results = await Promise.allSettled([
      slashingProtection.checkAndInsertAttestation(pubkey, conflict),
      slashingProtection.checkAndInsertAttestation(pubkey, next),
    ]);

    expect(results).toMatchObject([
      {status: "rejected", reason: {type: {code: InvalidAttestationErrorCode.DOUBLE_VOTE}}},
      {status: "fulfilled"},
    ]);
    expect(await attestations.getAll(pubkey)).toEqual([attestation, next]);
  });

  it("continues queued checks after a database write fails", async () => {
    const writeError = new Error("database write failed");
    vi.spyOn(db, "batchPut").mockRejectedValueOnce(writeError);
    const results = await Promise.allSettled([
      slashingProtection.checkAndInsertAttestation(pubkey, attestation),
      slashingProtection.checkAndInsertAttestation(pubkey, conflict),
    ]);

    expect(results).toEqual([
      {status: "rejected", reason: writeError},
      {status: "fulfilled", value: undefined},
    ]);
    expect(await attestations.getAll(pubkey)).toEqual([conflict]);
  });

  it("does not lose an imported attestation when an import overlaps a check for the same target", async () => {
    const started = defer<void>();
    const release = defer<void>();
    const batchPut = db.batchPut.bind(db);
    vi.spyOn(db, "batchPut").mockImplementationOnce(async (...args) => {
      started.resolve();
      await release.promise;
      await batchPut(...args);
    });
    const pending = slashingProtection.checkAndInsertAttestation(pubkey, attestation);
    await started.promise;

    const genesisValidatorsRoot = ssz.Root.defaultValue();
    const imported = slashingProtection.importInterchange(
      {
        metadata: {interchange_format_version: "5", genesis_validators_root: toHex(genesisValidatorsRoot)},
        data: [
          {
            pubkey: toHex(pubkey),
            signed_blocks: [],
            signed_attestations: [
              {
                source_epoch: String(conflict.sourceEpoch),
                target_epoch: String(conflict.targetEpoch),
                signing_root: toHex(conflict.signingRoot),
              },
            ],
          },
        ],
      },
      genesisValidatorsRoot
    );
    // An import that does not wait for the pending check writes its attestation before the check does
    await Promise.race([imported, sleep(10)]);
    release.resolve();
    await Promise.all([pending, imported]);

    expect(await attestations.getAll(pubkey)).toEqual([{...attestation, signingRoot: Buffer.alloc(32)}]);
    await expect(slashingProtection.checkAndInsertAttestation(pubkey, conflict)).rejects.toMatchObject({
      type: {code: InvalidAttestationErrorCode.DOUBLE_VOTE},
    });
  });

  it("defers checks until a running import has recorded every key", async () => {
    const started = defer<void>();
    const release = defer<void>();
    const batchPut = db.batchPut.bind(db);
    vi.spyOn(db, "batchPut").mockImplementationOnce(async (...args) => {
      started.resolve();
      await release.promise;
      await batchPut(...args);
    });

    const genesisValidatorsRoot = ssz.Root.defaultValue();
    const imported = slashingProtection.importInterchange(
      {
        metadata: {interchange_format_version: "5", genesis_validators_root: toHex(genesisValidatorsRoot)},
        data: [
          {
            pubkey: toHex(Buffer.alloc(48, 1)),
            signed_blocks: [{slot: "1", signing_root: toHex(Buffer.alloc(32, 1))}],
            signed_attestations: [],
          },
          {
            pubkey: toHex(pubkey),
            signed_blocks: [],
            signed_attestations: [
              {
                source_epoch: String(conflict.sourceEpoch),
                target_epoch: String(conflict.targetEpoch),
                signing_root: toHex(conflict.signingRoot),
              },
            ],
          },
        ],
      },
      genesisValidatorsRoot
    );
    await started.promise;

    // A check that does not wait for the import is approved before the conflicting attestation is recorded
    const pending = slashingProtection.checkAndInsertAttestation(pubkey, attestation);
    await Promise.race([pending, sleep(10)]);
    release.resolve();
    await imported;

    await expect(pending).rejects.toMatchObject({type: {code: InvalidAttestationErrorCode.DOUBLE_VOTE}});
    expect(await attestations.getAll(pubkey)).toEqual([conflict]);
  });

  it("does not defer checks for keys outside a running import", async () => {
    const started = defer<void>();
    const release = defer<void>();
    const batchPut = db.batchPut.bind(db);
    vi.spyOn(db, "batchPut").mockImplementationOnce(async (...args) => {
      started.resolve();
      await release.promise;
      await batchPut(...args);
    });

    const genesisValidatorsRoot = ssz.Root.defaultValue();
    const imported = slashingProtection.importInterchange(
      {
        metadata: {interchange_format_version: "5", genesis_validators_root: toHex(genesisValidatorsRoot)},
        data: [
          {
            pubkey: toHex(pubkey),
            signed_blocks: [],
            signed_attestations: [
              {
                source_epoch: String(conflict.sourceEpoch),
                target_epoch: String(conflict.targetEpoch),
                signing_root: toHex(conflict.signingRoot),
              },
            ],
          },
        ],
      },
      genesisValidatorsRoot
    );

    try {
      await started.promise;
      const otherPubkey = Buffer.alloc(48, 1);
      await slashingProtection.checkAndInsertAttestation(otherPubkey, attestation);
      expect(await attestations.getAll(otherPubkey)).toEqual([attestation]);
    } finally {
      release.resolve();
      await imported;
    }
  });

  it("does not block other validators while a write is pending", async () => {
    const started = defer<void>();
    const release = defer<void>();
    const batchPut = db.batchPut.bind(db);
    vi.spyOn(db, "batchPut").mockImplementationOnce(async (...args) => {
      started.resolve();
      await release.promise;
      await batchPut(...args);
    });
    const pending = slashingProtection.checkAndInsertAttestation(pubkey, attestation);

    try {
      await started.promise;
      const otherPubkey = Buffer.alloc(48, 1);
      await slashingProtection.checkAndInsertAttestation(otherPubkey, conflict);
      expect(await attestations.getAll(otherPubkey)).toEqual([conflict]);
    } finally {
      release.resolve();
      await pending;
    }
  });
});
