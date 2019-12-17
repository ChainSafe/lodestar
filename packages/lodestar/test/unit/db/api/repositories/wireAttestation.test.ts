import sinon from "sinon";
import {WireAttestationRepository} from "../../../../../src/db/api/beacon/repositories";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {LevelDbController} from "../../../../../src/db/controller";
// @ts-ignore
import level from "level";
// @ts-ignore
import leveldown from "leveldown";
// @ts-ignore
import promisify from "promisify-es6";
import {generateAttestation, generateAttestationData} from "../../../../utils/attestation";
import {expect} from "chai";
import {WinstonLogger} from "../../../../../src/logger";

describe("wire attestation database", function () {
  const sandbox = sinon.createSandbox();
    
  let repository: WireAttestationRepository;

  const dbLocation = "./.__testdb";
  const testDb = level(
    dbLocation, {
      keyEncoding: "binary",
      valueEncoding: "binary",
    });
  const db = new LevelDbController(
    {db: testDb, name: dbLocation},
    {logger: sandbox.createStubInstance(WinstonLogger)}
  );
    
  beforeEach(async function () {
    await db.start();
    repository = new WireAttestationRepository(
      config,
      db
    );
  });
  
  afterEach(async function () {
    await db.stop();
    await promisify(leveldown.destroy)(dbLocation, function () {
    });
  });
    
  it("fetch wire attestations by epoch and index", async function () {
    await Promise.all([
      repository.setUnderRoot(
        generateAttestation({
          data: generateAttestationData(1, 1, 1, 1)
        })
      ),
      repository.setUnderRoot(
        generateAttestation({
          data: generateAttestationData(1, 1, 2, 1)
        })
      ),
      repository.setUnderRoot(
        generateAttestation({
          data: generateAttestationData(1, 1, 1, config.params.SLOTS_PER_EPOCH + 1)
        })
      )
    ]);
    const result = await repository.getCommiteeAttestations(0, 1);
    expect(result.length).to.be.equal(1);
  });
    
});