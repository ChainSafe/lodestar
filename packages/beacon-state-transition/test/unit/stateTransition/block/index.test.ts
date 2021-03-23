import {generateState} from "../../../utils/state";
import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/lodestar-config/mainnet";
import * as processEth1Data from "../../../../src/phase0/naive/block/eth1Data";
import * as processBlockHeader from "../../../../src/phase0/naive/block/blockHeader";
import * as processRandao from "../../../../src/phase0/naive/block/randao";
import * as processOperations from "../../../../src/phase0/naive/block/operations";
import {processBlock} from "../../../../src/phase0/naive";
import {generateEmptyBlock} from "../../../utils/block";
import {SinonStubFn} from "../../../utils/types";

describe("process block", function () {
  const sandbox = sinon.createSandbox();

  let processEth1Stub: SinonStubFn<typeof processEth1Data["processEth1Data"]>,
    processBlockHeaderStub: SinonStubFn<typeof processBlockHeader["processBlockHeader"]>,
    processRandaoStub: SinonStubFn<typeof processRandao["processRandao"]>,
    processOperationsStub: SinonStubFn<typeof processOperations["processOperations"]>;

  beforeEach(() => {
    processBlockHeaderStub = sandbox.stub(processBlockHeader, "processBlockHeader");
    processRandaoStub = sandbox.stub(processRandao, "processRandao");
    processEth1Stub = sandbox.stub(processEth1Data, "processEth1Data");
    processOperationsStub = sandbox.stub(processOperations, "processOperations");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should process block", function () {
    processEth1Stub.returns();
    processBlockHeaderStub.returns();
    processRandaoStub.returns();
    processOperationsStub.returns();
    processBlock(config, generateState(), generateEmptyBlock(), false);
    expect(processEth1Stub.calledOnce).to.be.true;
    expect(processBlockHeaderStub.calledOnce).to.be.true;
    expect(processRandaoStub.calledOnce).to.be.true;
    expect(processOperationsStub.calledOnce).to.be.true;
  });
});
