import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {rimraf} from "rimraf";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {LevelDbController} from "@lodestar/db/controller/level";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {InterchangeErrorErrorCode, SlashingProtection} from "../../../../src/slashingProtection/index.js";
import {testLogger} from "../../../utils/logger.js";

describe("SlashingProtection interchange import of attestations after the current epoch", () => {
  const pubkey = ssz.BLSPubkey.defaultValue();
  const genesisValidatorsRoot = ssz.Root.defaultValue();
  const currentEpoch = 100;
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

  function importAttestation(sourceEpoch: number, targetEpoch: number, epoch = currentEpoch): Promise<void> {
    return slashingProtection.importInterchange(
      {
        metadata: {interchange_format_version: "5", genesis_validators_root: toHex(genesisValidatorsRoot)},
        data: [
          {
            pubkey: toHex(pubkey),
            signed_blocks: [],
            signed_attestations: [{source_epoch: String(sourceEpoch), target_epoch: String(targetEpoch)}],
          },
        ],
      },
      genesisValidatorsRoot,
      undefined,
      epoch
    );
  }

  it("Should accept a target epoch up to one epoch after the current epoch", async () => {
    await expect(importAttestation(0, currentEpoch + 1)).resolves.toBeUndefined();
  });

  it("Should reject a target epoch more than one epoch after the current epoch", async () => {
    await expect(importAttestation(0, currentEpoch + 2)).rejects.toThrow(InterchangeErrorErrorCode.FUTURE_TARGET_EPOCH);
  });

  it("Should accept a target epoch up to epoch 1 before genesis", async () => {
    await expect(importAttestation(0, 0, -10)).resolves.toBeUndefined();
    await expect(importAttestation(0, 1, -10)).resolves.toBeUndefined();
    await expect(importAttestation(0, 2, -10)).rejects.toThrow(InterchangeErrorErrorCode.FUTURE_TARGET_EPOCH);
  });

  // Updating the min-max spans of this attestation would take one database read per epoch between source and target
  it("Should reject a target epoch far in the future without updating min-max spans", async () => {
    await expect(importAttestation(0, Number.MAX_SAFE_INTEGER - 1)).rejects.toThrow(
      InterchangeErrorErrorCode.FUTURE_TARGET_EPOCH
    );
    expect(await slashingProtection.listPubkeys()).toHaveLength(0);
  });
});
