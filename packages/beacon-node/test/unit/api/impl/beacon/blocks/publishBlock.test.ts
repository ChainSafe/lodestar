import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance} from "sinon";
import {allForks} from "@lodestar/types";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {Eth2Gossipsub} from "../../../../../../src/network/gossip/index.js";
import {generateEmptySignedBlock} from "../../../../../utils/block.js";
import {BeaconSync} from "../../../../../../src/sync/index.js";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test.js";

use(chaiAsPromised);

describe("api - beacon - publishBlock", function () {
  let gossipStub: SinonStubbedInstance<Eth2Gossipsub>;
  let block: allForks.SignedBeaconBlock;
  let chainStub: ApiImplTestModules["chainStub"];
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
    expect(chainStub.processBlock).to.be.calledOnceWith(block);
    expect(gossipStub.publishBeaconBlock).to.be.calledOnceWith(block);
  });
});
