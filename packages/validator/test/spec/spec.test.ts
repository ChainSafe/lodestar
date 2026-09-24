import {rimraf} from "rimraf";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {LevelDbController} from "@lodestar/db/controller/level";
import {ZERO_HASH} from "@lodestar/state-transition";
import {
  InterchangeError,
  InvalidAttestationError,
  InvalidBlockError,
  SlashingProtection,
  SlashingProtectionAttestation,
  SlashingProtectionBlock,
} from "../../src/slashingProtection/index.js";
import {testLogger} from "../utils/logger.js";
import {loadTestCases} from "../utils/spec.js";
import {SPEC_TEST_CASES_LOCATION} from "./params.js";

describe("slashing-protection-interchange-tests", () => {
  const testCases = loadTestCases(SPEC_TEST_CASES_LOCATION);
  const dbLocation = "./.__testdb";
  let db: LevelDbController;
  let slashingProtection: SlashingProtection;

  beforeAll(async () => {
    db = await LevelDbController.create({name: dbLocation}, {logger: testLogger()});
    slashingProtection = new SlashingProtection(db);
  });

  afterAll(async () => {
    await db.close();
    rimraf.sync(dbLocation);
  });

  beforeEach(async () => {
    await db.clear();
    expect(await db.keys()).toHaveLength(0);
  });

  // https://github.com/eth-clients/slashing-protection-interchange-tests#how-to-run
  // Each test starts with an empty database, steps are applied in order on top of the previous ones.
  // `should_succeed` is the outcome for a minimal database, `should_succeed_complete` for a complete one. Lodestar
  // stores all signed messages but also enforces the lower bounds of imported data, either outcome is accepted where
  // they differ.
  for (const testCase of testCases) {
    it(testCase.name, async () => {
      const genesisValidatorsRoot = fromHexString(testCase.genesis_validators_root);

      for (const [i, step] of testCase.steps.entries()) {
        const importError = await slashingProtection.importInterchange(step.interchange, genesisValidatorsRoot).then(
          () => null,
          (e: Error) => e
        );
        if (!step.should_succeed) {
          expect(importError, `step ${i} import should fail`).toBeInstanceOf(InterchangeError);
        } else if (importError !== null) {
          // Clients may refuse to import slashable data, the checks of this step assume it was imported
          expect(step.contains_slashable_data, `step ${i} import should succeed: ${importError.message}`).toBe(true);
          expect(importError, `step ${i} import should only be refused as slashable`).toBeInstanceOf(
            InvalidAttestationError
          );
          continue;
        }

        for (const [j, blockRaw] of step.blocks.entries()) {
          const pubkey = fromHexString(blockRaw.pubkey);
          const block: SlashingProtectionBlock = {
            slot: parseInt(blockRaw.slot),
            signingRoot: blockRaw.signing_root ? fromHexString(blockRaw.signing_root) : ZERO_HASH,
          };
          const signed = await slashingProtection.checkAndInsertBlockProposal(pubkey, block).then(
            () => true,
            (e) => {
              expect(e, `step ${i} block ${j} unexpected error`).toBeInstanceOf(InvalidBlockError);
              return false;
            }
          );
          if (blockRaw.should_succeed === blockRaw.should_succeed_complete) {
            expect(signed, `step ${i} block ${j} slot ${blockRaw.slot}`).toBe(blockRaw.should_succeed);
          }
        }

        for (const [j, attestationRaw] of step.attestations.entries()) {
          const pubkey = fromHexString(attestationRaw.pubkey);
          const attestation: SlashingProtectionAttestation = {
            sourceEpoch: parseInt(attestationRaw.source_epoch),
            targetEpoch: parseInt(attestationRaw.target_epoch),
            signingRoot: attestationRaw.signing_root ? fromHexString(attestationRaw.signing_root) : ZERO_HASH,
          };
          const signed = await slashingProtection.checkAndInsertAttestation(pubkey, attestation).then(
            () => true,
            (e) => {
              expect(e, `step ${i} attestation ${j} unexpected error`).toBeInstanceOf(InvalidAttestationError);
              return false;
            }
          );
          if (attestationRaw.should_succeed === attestationRaw.should_succeed_complete) {
            expect(
              signed,
              `step ${i} attestation ${j} source ${attestationRaw.source_epoch} target ${attestationRaw.target_epoch}`
            ).toBe(attestationRaw.should_succeed);
          }
        }
      }
    });
  }
});
