import {expect, describe, it, beforeAll, afterAll} from "vitest";
import {rimraf} from "rimraf";
import {LevelDbController} from "@lodestar/db";
import {
  SlashingProtection,
  SlashingProtectionBlock,
  SlashingProtectionAttestation,
  InvalidBlockError,
  InvalidAttestationError,
} from "../../src/slashingProtection/index.js";
import {testLogger} from "../utils/logger.js";

describe("slashing-protection custom tests", () => {
  const dbLocation = "./.__testdb_2";
  const pubkey = Buffer.alloc(96, 1);
  let db: LevelDbController;

  beforeAll(async () => {
    db = await LevelDbController.create({name: dbLocation}, {logger: testLogger()});
  });

  afterAll(async () => {
    await db.clear();
    await db.close();
    rimraf.sync(dbLocation);
  });

  it("Should reject same block", async () => {
    const slashingProtection = new SlashingProtection(db);
    const block1: SlashingProtectionBlock = {slot: 10001, signingRoot: Buffer.alloc(32, 1)};
    const block2: SlashingProtectionBlock = {slot: block1.slot, signingRoot: Buffer.alloc(32, 2)};

    await slashingProtection.checkAndInsertBlockProposal(pubkey, block1);
    await expect(slashingProtection.checkAndInsertBlockProposal(pubkey, block2)).to.be.rejectedWith(InvalidBlockError);
  });

  it("Should reject same attestation", async () => {
    const slashingProtection = new SlashingProtection(db);
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
    await expect(slashingProtection.checkAndInsertAttestation(pubkey, attestation2)).to.be.rejectedWith(
      InvalidAttestationError
    );
  });
});
