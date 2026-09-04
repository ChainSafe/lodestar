import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {rimraf} from "rimraf";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {LevelDbController} from "@lodestar/db/controller/level";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
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
