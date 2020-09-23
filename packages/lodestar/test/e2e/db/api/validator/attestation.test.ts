import {ValidatorDB} from "../../../../../src/db/api";
import {after, before} from "mocha";
import {IDatabaseController, LevelDbController} from "../../../../../src/db/controller";
import tmp from "tmp";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {PrivateKey, PublicKey} from "@chainsafe/bls";
import {generateAttestation} from "../../../../utils/attestation";
import {expect} from "chai";

describe("validator attestation database", function () {
  let db: ValidatorDB;
  let controller: IDatabaseController<Buffer, Buffer>;

  before(async function () {
    controller = new LevelDbController(
      {
        name: tmp.dirSync({unsafeCleanup: true, keep: false}).name,
      },
      {logger: sinon.createStubInstance(WinstonLogger)}
    );
    db = new ValidatorDB({
      config,
      controller,
    });
    await controller.start();
  });

  after(async function () {
    await controller.stop();
  });

  it("should store, find and delete validator attestation", async function () {
    const attestation = generateAttestation({data: {target: {epoch: 0}}});
    const pubkey = PublicKey.fromPrivateKey(PrivateKey.fromInt(1)).toBytesCompressed();
    const pubkey2 = PublicKey.fromPrivateKey(PrivateKey.fromInt(2)).toBytesCompressed();
    await db.setAttestation(pubkey, attestation);
    await db.setAttestation(pubkey2, attestation);
    await db.setAttestation(pubkey, generateAttestation({data: {target: {epoch: 1}}}));
    const result = await db.getAttestations(pubkey, {
      gte: attestation.data.target.epoch,
      lt: attestation.data.target.epoch + 1,
    });
    expect(result.length).to.be.equal(1);
    expect(config.types.Attestation.hashTreeRoot(result[0])).to.be.deep.equal(
      config.types.Attestation.hashTreeRoot(attestation)
    );
    await db.deleteAttestations(pubkey, [attestation]);
    const result2 = await db.getAttestations(pubkey, {
      gte: attestation.data.target.epoch,
      lt: attestation.data.target.epoch + 1,
    });
    expect(result2.length).to.be.equal(0);
  });
});
