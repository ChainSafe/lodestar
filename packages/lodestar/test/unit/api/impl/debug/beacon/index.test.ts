import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import sinon from "sinon";
import {SinonStubbedInstance} from "sinon";
import {DebugBeaconApi} from "../../../../../../src/api/impl/debug/beacon";
import {BeaconChain, IBeaconChain, LodestarForkChoice} from "../../../../../../src/chain";
import {generateBlockSummary} from "../../../../../utils/block";

describe("api - debug - beacon - getHeads", function () {
  let debugApi: DebugBeaconApi;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let forkchoiceStub: SinonStubbedInstance<IForkChoice>;
  const logger = new WinstonLogger();

  beforeEach(() => {
    chainStub = sinon.createStubInstance(BeaconChain);
    forkchoiceStub = sinon.createStubInstance(LodestarForkChoice);
    chainStub.forkChoice = forkchoiceStub;
    debugApi = new DebugBeaconApi(
      {},
      {
        logger,
        chain: chainStub,
      }
    );
  });

  it("should return head", async () => {
    forkchoiceStub.getHeads.returns([generateBlockSummary({slot: 1000})]);
    const heads = await debugApi.getHeads();
    expect(heads).to.be.deep.equal([{slot: 1000, root: ZERO_HASH}]);
  });
});
