import sinon, {SinonStub, SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain, ILMDGHOST, StatefulDagLMDGHOST} from "../../../../src/chain";
import {INetwork, Libp2pNetwork} from "../../../../src/network";
import {ReputationStore} from "../../../../src/sync/IReputation";
import * as syncUtils from "../../../../src/sync/utils";
import {NaiveRegularSync} from "../../../../src/sync/regular/naive";
import {config} from "@chainsafe/lodestar-config/src/presets/minimal";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";

describe("fast regular sync", function () {
  const sandbox = sinon.createSandbox();

  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let repsStub: SinonStubbedInstance<ReputationStore>;
  let getTargetStub: SinonStub;

  beforeEach(function () {
    forkChoiceStub  = sinon.createStubInstance(StatefulDagLMDGHOST);
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.forkChoice = forkChoiceStub;
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    repsStub = sinon.createStubInstance(ReputationStore);
    getTargetStub = sandbox.stub(syncUtils, "getHighestCommonSlot");
    networkStub.getPeers.returns([]);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("already synced", async function() {
    const sync = new NaiveRegularSync(
      {blockPerChunk: 10},
      {
        chain: chainStub,
        config,
        logger: sinon.createStubInstance(WinstonLogger),
        network: networkStub,
        reputationStore: repsStub
      }
    );
    forkChoiceStub.headBlockSlot.returns(0);
    getTargetStub.returns(0);
    await sync.start();
  });
});
