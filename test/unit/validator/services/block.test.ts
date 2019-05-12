import BlockProposingService from "../../../../src/validator/services/block";
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import {RpcClient, RpcClientOverInstance} from "../../../../src/validator/rpc";
import sinon from "sinon";
import {generateFork} from "../../../utils/fork";
import {expect} from "chai";
import {ValidatorApi} from "../../../../src/rpc/api/validator";
import {bytes32} from "@chainsafe/bls-js/lib/types";
import {bytes} from "../../../../src/types";
import {generateEmptyBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";
import {BeaconApi} from "../../../../src/rpc/api/beacon";
import {SLOTS_PER_EPOCH} from "../../../../src/constants";

describe('block proposing service', function () {

  const sandbox = sinon.createSandbox();

  let rpcClientStub;

  beforeEach(() => {
    rpcClientStub = sandbox.createStubInstance(RpcClientOverInstance);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should not produce block in same epoch', async function () {
    const hasProposedStub = sandbox.stub(BlockProposingService.prototype, "hasProposedAlready" as any);
    hasProposedStub.withArgs(1).returns(true);
    const service = new BlockProposingService(
      0, rpcClientStub, PrivateKey.random()
    );
    const result = await service.createAndPublishBlock(1, generateFork());
    expect(result).to.be.null;
  });

  it('should produce correct block', async function () {
    const slot = 2;
    rpcClientStub.validator = sandbox.createStubInstance(ValidatorApi);
    rpcClientStub.beacon = sandbox.createStubInstance(BeaconApi);
    rpcClientStub.validator.produceBlock.withArgs(slot, sinon.match.any).resolves(generateEmptyBlock());
    rpcClientStub.beacon.getBeaconState.resolves(generateState({slot: SLOTS_PER_EPOCH * 2}));
    const service = new BlockProposingService(
      0, rpcClientStub, PrivateKey.random()
    );
    const result = await service.createAndPublishBlock(slot, generateFork());
    expect(result).to.not.be.null;
    expect(rpcClientStub.validator.publishBlock.calledOnce).to.be.true;
  });

});
