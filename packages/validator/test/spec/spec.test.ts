import path from "node:path";
import {expect} from "vitest";
import {rimraf} from "rimraf";
import {fromHexString} from "@chainsafe/ssz";
import {LevelDbController} from "@lodestar/db";
import {ZERO_HASH} from "@lodestar/state-transition";
import {
  SlashingProtection,
  InterchangeError,
  InvalidAttestationError,
  InvalidBlockError,
  SlashingProtectionBlock,
  SlashingProtectionAttestation,
} from "../../src/slashingProtection/index.js";
import {testLogger} from "../utils/logger.js";
import {loadTestCases} from "../utils/spec.js";
import {SPEC_TEST_LOCATION} from "./params.js";

describe("slashing-protection-interchange-tests", () => {
  const testCases = loadTestCases(path.join(SPEC_TEST_LOCATION, "/tests/generated"));
  const dbLocation = "./.__testdb";
  let db: LevelDbController;
  let slashingProtection: SlashingProtection;

  before(async () => {
    db = await LevelDbController.create({name: dbLocation}, {logger: testLogger()});
    slashingProtection = new SlashingProtection(db);
  });

  after(async () => {
    await db.close();
    rimraf.sync(dbLocation);
  });

  for (const testCase of testCases) {
    describe(testCase.name, () => {
      for (const step of testCase.steps) {
        beforeEach(async () => {
          await db.clear();
        });

        // Import
        beforeEach("Import interchange", async () => {
          expect(await db.keys()).lengthOf(0, "DB is not empty");

          const genesisValidatorsRoot = fromHexString(testCase.genesis_validators_root);
          if (step.should_succeed) {
            if (step.contains_slashable_data) {
              await expect(
                slashingProtection.importInterchange(step.interchange, genesisValidatorsRoot)
              ).to.be.rejectedWith(InterchangeError);
            } else {
              await expect(
                slashingProtection.importInterchange(step.interchange, genesisValidatorsRoot)
              ).to.not.be.rejectedWith(InterchangeError);
            }
          } else {
            await expect(
              slashingProtection.importInterchange(step.interchange, genesisValidatorsRoot)
            ).to.not.be.rejectedWith(InterchangeError);
          }
        });

        if (!step.contains_slashable_data) {
          // Add blocks
          for (const [i, blockRaw] of step.blocks.entries()) {
            it(`Add block ${i}`, async () => {
              const pubkey = fromHexString(blockRaw.pubkey);
              const block: SlashingProtectionBlock = {
                slot: parseInt(blockRaw.slot),
                signingRoot: blockRaw.signing_root ? fromHexString(blockRaw.signing_root) : ZERO_HASH,
              };
              if (blockRaw.should_succeed) {
                await slashingProtection.checkAndInsertBlockProposal(pubkey, block);
              } else {
                await expect(slashingProtection.checkAndInsertBlockProposal(pubkey, block)).to.be.rejectedWith(
                  InvalidBlockError
                );
              }
            });
          }

          // Add attestations
          for (const [i, attestationRaw] of step.attestations.entries()) {
            it(`Add attestation ${i}`, async () => {
              const pubkey = fromHexString(attestationRaw.pubkey);
              const attestation: SlashingProtectionAttestation = {
                sourceEpoch: parseInt(attestationRaw.source_epoch),
                targetEpoch: parseInt(attestationRaw.target_epoch),
                signingRoot: attestationRaw.signing_root ? fromHexString(attestationRaw.signing_root) : ZERO_HASH,
              };
              if (attestationRaw.should_succeed) {
                await slashingProtection.checkAndInsertAttestation(pubkey, attestation);
              } else {
                await expect(slashingProtection.checkAndInsertAttestation(pubkey, attestation)).to.be.rejectedWith(
                  InvalidAttestationError
                );
              }
            });
          }
        }
      }
    });
  }
});
