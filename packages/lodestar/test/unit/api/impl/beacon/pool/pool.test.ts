import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {expect} from "chai";
import sinon from "sinon";
import {BeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool";
import {Libp2pNetwork} from "../../../../../../src/network/network";
import {BeaconSync} from "../../../../../../src/sync/sync";
import {generateAttestation, generateAttestationData} from "../../../../../utils/attestation";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {SinonStubbedInstance} from "sinon";
import {IBeaconChain} from "../../../../../../src/chain";
import {BeaconChain} from "../../../../../../src/chain/chain";

describe("beacon pool api impl", function () {
  let poolApi: BeaconPoolApi;
  let dbStub: StubbedBeaconDb;
  let chainStub: SinonStubbedInstance<IBeaconChain>;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sinon, config);
    chainStub = sinon.createStubInstance(BeaconChain);
    poolApi = new BeaconPoolApi(
      {},
      {
        config,
        db: dbStub,
        sync: sinon.createStubInstance(BeaconSync),
        network: sinon.createStubInstance(Libp2pNetwork),
        chain: chainStub,
      }
    );
  });

  describe("getAttestations", function () {
    it("no filters", async function () {
      dbStub.attestation.values.resolves([generateAttestation(), generateAttestation()]);
      const attestations = await poolApi.getAttestations();
      expect(attestations.length).to.be.equal(2);
    });

    it("with filters", async function () {
      dbStub.attestation.values.resolves([
        generateAttestation({data: generateAttestationData(0, 1, 0, 1)}),
        generateAttestation({data: generateAttestationData(0, 1, 1, 0)}),
        generateAttestation({data: generateAttestationData(0, 1, 3, 2)}),
      ]);
      const attestations = await poolApi.getAttestations({slot: 1, committeeIndex: 0});
      expect(attestations.length).to.be.equal(1);
    });
  });
});
