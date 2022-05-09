import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance} from "sinon";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks";
import {BeaconChain} from "../../../../../../src/chain";
import {Eth2Gossipsub} from "../../../../../../src/network/gossip";
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {allForks} from "@chainsafe/lodestar-types";
import {BeaconSync} from "../../../../../../src/sync";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test";

use(chaiAsPromised);

describe("api - beacon - publishBlock", function () {
  let gossipStub: SinonStubbedInstance<Eth2Gossipsub>;
  let block: allForks.SignedBeaconBlock;
  let chainStub: SinonStubbedInstance<BeaconChain>;
  let syncStub: SinonStubbedInstance<BeaconSync>;
  let server: ApiImplTestModules;

  before(function () {
    block = generateEmptySignedBlock();
  });

  beforeEach(function () {
    server = setupApiImplTestServer();
    gossipStub = sinon.createStubInstance(Eth2Gossipsub);
    gossipStub.publishBeaconBlock = sinon.stub();
    server.networkStub.gossip = (gossipStub as unknown) as Eth2Gossipsub;
    chainStub = server.chainStub;
    syncStub = server.syncStub;
    chainStub.processBlock.resolves();
  });

  it("successful publish", async function () {
    const blockApi = getBeaconBlockApi({
      chain: chainStub,
      config: server.config,
      db: server.dbStub,
      network: server.networkStub,
      metrics: null,
    });

    syncStub.isSynced.returns(true);
    await expect(blockApi.publishBlock(block)).to.be.fulfilled;
    expect(chainStub.processBlock.calledOnceWith(block)).to.be.true;
    expect(gossipStub.publishBeaconBlock.calledOnceWith(block)).to.be.true;
  });
});
