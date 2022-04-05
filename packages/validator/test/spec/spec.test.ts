import fs from "node:fs";
import path from "node:path";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import rimraf from "rimraf";
import {fromHexString} from "@chainsafe/ssz";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils";
import {config} from "@chainsafe/lodestar-config/default";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {
  SlashingProtection,
  InterchangeError,
  InvalidAttestationError,
  InvalidBlockError,
  SlashingProtectionBlock,
  SlashingProtectionAttestation,
} from "../../src/slashingProtection";
import {SPEC_TEST_LOCATION} from "./params";

chai.use(chaiAsPromised);

/* eslint-disable @typescript-eslint/naming-convention */
type SlashingProtectionInterchangeTest = {
  name: string;
  genesis_validators_root: string;
  steps: [
    {
      should_succeed: boolean;
      contains_slashable_data: boolean;
      interchange: any;
      blocks: {
        pubkey: string;
        should_succeed: boolean;
        slot: string;
        signing_root?: string;
      }[];
      attestations: {
        pubkey: string;
        should_succeed: boolean;
        source_epoch: string;
        target_epoch: string;
        signing_root?: string;
      }[];
    }
  ];
};

/* eslint-disable no-console */

describe("slashing-protection-interchange-tests", () => {
  const testCases = loadTestCases(path.join(SPEC_TEST_LOCATION, "/tests/generated"));
  const dbLocation = "./.__testdb";
  const controller = new LevelDbController({name: dbLocation}, {logger: new WinstonLogger({level: LogLevel.error})});

  after(() => {
    rimraf.sync(dbLocation);
  });

  for (const testCase of testCases) {
    describe(testCase.name, async () => {
      const slashingProtection = new SlashingProtection({config, controller});

      for (const step of testCase.steps) {
        beforeEach(async () => {
          await controller.start();
          await controller.clear();
        });

        // Import
        beforeEach("Import interchange", async () => {
          expect(await controller.keys()).lengthOf(0, "DB is not empty");

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

        afterEach(async () => {
          await controller.stop();
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

export function loadTestCases(testsPath: string): SlashingProtectionInterchangeTest[] {
  const files = fs.readdirSync(testsPath);
  if (files.length === 0) {
    throw Error(`Not tests found in ${testsPath}`);
  }
  return files.map(
    (file) => JSON.parse(fs.readFileSync(path.join(testsPath, file), "utf8")) as SlashingProtectionInterchangeTest
  );
}
