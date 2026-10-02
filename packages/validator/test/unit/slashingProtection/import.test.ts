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
  InvalidBlockErrorCode,
  SlashingProtection,
} from "../../../src/slashingProtection/index.js";
import {testLogger} from "../../utils/logger.js";

/**
 * Importing interchange data must never replace a recorded message with a different signing root,
 * otherwise a message conflicting with the one that was actually signed would be considered a repeat.
 */
describe("SlashingProtection interchange import of existing records", () => {
  const pubkey = ssz.BLSPubkey.defaultValue();
  const genesisValidatorsRoot = ssz.Root.defaultValue();
  const rootA = Buffer.alloc(32, 0xaa);
  const rootB = Buffer.alloc(32, 0xbb);
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

  function importInterchange(
    blocks: {slot: number; root?: Uint8Array}[],
    attestations: {source: number; target: number; root?: Uint8Array}[]
  ): Promise<void> {
    return slashingProtection.importInterchange(
      {
        metadata: {interchange_format_version: "5", genesis_validators_root: toHex(genesisValidatorsRoot)},
        data: [
          {
            pubkey: toHex(pubkey),
            signed_blocks: blocks.map(({slot, root}) => ({slot: String(slot), signing_root: root && toHex(root)})),
            signed_attestations: attestations.map(({source, target, root}) => ({
              source_epoch: String(source),
              target_epoch: String(target),
              signing_root: root && toHex(root),
            })),
          },
        ],
      },
      genesisValidatorsRoot
    );
  }

  function signBlock(slot: number, signingRoot: Uint8Array): Promise<void> {
    return slashingProtection.checkAndInsertBlockProposal(pubkey, {slot, signingRoot});
  }

  function signAttestation(sourceEpoch: number, targetEpoch: number, signingRoot: Uint8Array): Promise<void> {
    return slashingProtection.checkAndInsertAttestation(pubkey, {sourceEpoch, targetEpoch, signingRoot});
  }

  describe("blocks", () => {
    it("Should refuse a block conflicting with a signed block after importing it", async () => {
      await signBlock(100, rootA);
      await importInterchange([{slot: 100, root: rootB}], []);

      await expect(signBlock(100, rootB)).rejects.toThrow(InvalidBlockErrorCode.DOUBLE_BLOCK_PROPOSAL);
      await expect(signBlock(100, rootA)).rejects.toThrow(InvalidBlockErrorCode.DOUBLE_BLOCK_PROPOSAL);
    });

    it("Should refuse any block at a slot imported without signing root", async () => {
      await signBlock(100, rootA);
      await importInterchange([{slot: 100}], []);

      await expect(signBlock(100, rootA)).rejects.toThrow(InvalidBlockErrorCode.DOUBLE_BLOCK_PROPOSAL);
    });

    it("Should refuse any block at a slot imported twice with different signing roots", async () => {
      await importInterchange(
        [
          {slot: 100, root: rootA},
          {slot: 100, root: rootB},
        ],
        []
      );

      await expect(signBlock(100, rootA)).rejects.toThrow(InvalidBlockErrorCode.DOUBLE_BLOCK_PROPOSAL);
      await expect(signBlock(100, rootB)).rejects.toThrow(InvalidBlockErrorCode.DOUBLE_BLOCK_PROPOSAL);
    });

    it("Should allow re-signing a block after importing it with the same signing root", async () => {
      await signBlock(100, rootA);
      await importInterchange([{slot: 100, root: rootA}], []);

      await expect(signBlock(100, rootA)).resolves.toBeUndefined();
    });
  });

  describe("attestations", () => {
    it("Should refuse an attestation conflicting with a signed attestation after importing it", async () => {
      await signAttestation(10, 11, rootA);
      await importInterchange([], [{source: 10, target: 11, root: rootB}]);

      await expect(signAttestation(10, 11, rootB)).rejects.toThrow(InvalidAttestationErrorCode.DOUBLE_VOTE);
      await expect(signAttestation(10, 11, rootA)).rejects.toThrow(InvalidAttestationErrorCode.DOUBLE_VOTE);
    });

    it("Should refuse any attestation at a target imported with a different source epoch", async () => {
      await signAttestation(10, 11, rootA);
      await signAttestation(12, 13, rootA);
      await importInterchange([], [{source: 9, target: 11, root: rootB}]);

      await expect(signAttestation(9, 11, rootB)).rejects.toThrow(InvalidAttestationErrorCode.DOUBLE_VOTE);
      await expect(signAttestation(10, 11, rootA)).rejects.toThrow(InvalidAttestationErrorCode.DOUBLE_VOTE);
    });

    it("Should allow re-signing an attestation after importing it with the same signing root", async () => {
      await signAttestation(10, 11, rootA);
      await importInterchange([], [{source: 10, target: 11, root: rootA}]);

      await expect(signAttestation(10, 11, rootA)).resolves.toBeUndefined();
    });
  });
});
