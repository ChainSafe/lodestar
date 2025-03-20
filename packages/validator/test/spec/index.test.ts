import {LevelDbController} from "@lodestar/db";
import {rimraf} from "rimraf";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {
  InvalidAttestationError,
  InvalidBlockError,
  SlashingProtection,
  SlashingProtectionAttestation,
  SlashingProtectionBlock,
} from "../../src/slashingProtection/index.js";
import {testLogger} from "../utils/logger.js";

describe("slashing-protection custom tests", () => {
  const dbLocation = "./.__testdb_2";
  const pubkey = Buffer.alloc(48, 1);
  let db: LevelDbController;
  let slashingProtection: SlashingProtection;

  beforeAll(async () => {
    db = await LevelDbController.create({name: dbLocation}, {logger: testLogger()});
    slashingProtection = new SlashingProtection(db);
  });

  afterAll(async () => {
    await db.clear();
    await db.close();
    rimraf.sync(dbLocation);
  });

  it("Should reject same block", async () => {
    const block1: SlashingProtectionBlock = {slot: 10001, signingRoot: Buffer.alloc(32, 1)};
    const block2: SlashingProtectionBlock = {slot: block1.slot, signingRoot: Buffer.alloc(32, 2)};

    await slashingProtection.checkAndInsertBlockProposal(pubkey, block1);
    await expect(slashingProtection.checkAndInsertBlockProposal(pubkey, block2)).rejects.toThrow(InvalidBlockError);
  });

  it("Should reject same attestation", async () => {
    const attestation1: SlashingProtectionAttestation = {
      targetEpoch: 1001,
      sourceEpoch: 999,
      signingRoot: Buffer.alloc(32, 1),
    };
    const attestation2: SlashingProtectionAttestation = {
      targetEpoch: attestation1.targetEpoch,
      sourceEpoch: 999,
      signingRoot: Buffer.alloc(32, 2),
    };

    await slashingProtection.checkAndInsertAttestation(pubkey, attestation1);
    await expect(slashingProtection.checkAndInsertAttestation(pubkey, attestation2)).rejects.toThrow(
      InvalidAttestationError
    );
  });

  it("Should detect surrounding votes (slashable)", async () => {
    const pubkey2 = Buffer.alloc(48, 2); // Using a new pubkey to avoid interference
    
    // First attestation with source 2 -> target 4
    const attestation1: SlashingProtectionAttestation = {
      sourceEpoch: 2,
      targetEpoch: 4,
      signingRoot: Buffer.alloc(32, 3),
    };
    
    // Second attestation with source 1 -> target 5 (surrounds the first one)
    const attestation2: SlashingProtectionAttestation = {
      sourceEpoch: 1,
      targetEpoch: 5,
      signingRoot: Buffer.alloc(32, 4),
    };

    await slashingProtection.checkAndInsertAttestation(pubkey2, attestation1);
    await expect(slashingProtection.checkAndInsertAttestation(pubkey2, attestation2)).rejects.toThrow(
      InvalidAttestationError
    );
  });

  it("Should detect surrounded votes (slashable)", async () => {
    const pubkey3 = Buffer.alloc(48, 3); // Using a new pubkey to avoid interference
    
    // First attestation with source 1 -> target 5
    const attestation1: SlashingProtectionAttestation = {
      sourceEpoch: 1,
      targetEpoch: 5,
      signingRoot: Buffer.alloc(32, 5),
    };
    
    // Second attestation with source 2 -> target 4 (surrounded by the first one)
    const attestation2: SlashingProtectionAttestation = {
      sourceEpoch: 2,
      targetEpoch: 4,
      signingRoot: Buffer.alloc(32, 6),
    };

    await slashingProtection.checkAndInsertAttestation(pubkey3, attestation1);
    await expect(slashingProtection.checkAndInsertAttestation(pubkey3, attestation2)).rejects.toThrow(
      InvalidAttestationError
    );
  });

  it("Should correctly check hasAttestedInEpoch", async () => {
    const pubkey4 = Buffer.alloc(48, 4); // Using a new pubkey to avoid interference
    const targetEpoch = 2000;
    
    // Check before inserting attestation - should return false
    expect(await slashingProtection.hasAttestedInEpoch(pubkey4, targetEpoch)).toBe(false);
    
    // Insert an attestation
    const attestation: SlashingProtectionAttestation = {
      sourceEpoch: targetEpoch - 1,
      targetEpoch,
      signingRoot: Buffer.alloc(32, 7),
    };
    await slashingProtection.checkAndInsertAttestation(pubkey4, attestation);
    
    // Check after inserting attestation - should return true
    expect(await slashingProtection.hasAttestedInEpoch(pubkey4, targetEpoch)).toBe(true);
    
    // Check different epoch - should return false
    expect(await slashingProtection.hasAttestedInEpoch(pubkey4, targetEpoch + 1)).toBe(false);
  });

  it("Should correctly list pubkeys", async () => {
    const uniquePubkey = Buffer.alloc(48, 5); // Using a new pubkey
    
    // Insert attestation with unique pubkey
    const attestation: SlashingProtectionAttestation = {
      sourceEpoch: 500,
      targetEpoch: 501,
      signingRoot: Buffer.alloc(32, 8),
    };
    await slashingProtection.checkAndInsertAttestation(uniquePubkey, attestation);
    
    // Get list of pubkeys
    const pubkeys = await slashingProtection.listPubkeys();
    
    // Should include our unique pubkey
    expect(pubkeys.some((key) => Buffer.compare(key, uniquePubkey) === 0)).toBe(true);
  });
});
