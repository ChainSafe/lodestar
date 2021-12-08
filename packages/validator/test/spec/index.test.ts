import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import rimraf from "rimraf";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils";
import {config} from "@chainsafe/lodestar-config/default";
import {
  SlashingProtection,
  SlashingProtectionBlock,
  SlashingProtectionAttestation,
  InvalidBlockError,
  InvalidAttestationError,
} from "../../src/slashingProtection";

chai.use(chaiAsPromised);

/* eslint-disable no-console */

describe("slashing-protection custom tests", () => {
  const dbLocation = "./.__testdb_2";
  const controller = new LevelDbController({name: dbLocation}, {logger: new WinstonLogger({level: LogLevel.error})});
  const pubkey = Buffer.alloc(96, 1);

  before(async () => {
    await controller.start();
  });

  after(async () => {
    await controller.clear();
    await controller.stop();
    rimraf.sync(dbLocation);
  });

  it("Should reject same block", async () => {
    const slashingProtection = new SlashingProtection({config, controller});
    const block1: SlashingProtectionBlock = {slot: 10001, signingRoot: Buffer.alloc(32, 1)};
    const block2: SlashingProtectionBlock = {slot: block1.slot, signingRoot: Buffer.alloc(32, 2)};

    await slashingProtection.checkAndInsertBlockProposal(pubkey, block1);
    await expect(slashingProtection.checkAndInsertBlockProposal(pubkey, block2)).to.be.rejectedWith(InvalidBlockError);
  });

  it("Should reject same attestation", async () => {
    const slashingProtection = new SlashingProtection({config, controller});
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
