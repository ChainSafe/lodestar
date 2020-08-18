import {BeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon from "sinon";
import {generateAttestation, generateAttestationData} from "../../../../../utils/attestation";
import {expect} from "chai";

describe("beacon pool api impl", function () {

  let poolApi: BeaconPoolApi;
  let dbStub: StubbedBeaconDb;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sinon, config);
    poolApi = new BeaconPoolApi({}, {
      config,
      db: dbStub
    });
  });

  describe("getAttestations", function () {

    it("no filters", async function () {
      dbStub.attestation.values.resolves([
        generateAttestation(),
        generateAttestation()
      ]);
      const attestations = await poolApi.getAttestations();
      expect(attestations.length).to.be.equal(2);
    });

    it("with filters", async function () {
      dbStub.attestation.values.resolves([
        generateAttestation({data: generateAttestationData(0, 1, 0, 1)}),
        generateAttestation({data: generateAttestationData(0, 1, 1, 0)}),
        generateAttestation({data: generateAttestationData(0, 1, 3, 2)})
      ]);
      const attestations = await poolApi.getAttestations({slot: 1, committeeIndex: 0});
      expect(attestations.length).to.be.equal(1);
    });

  });

});
