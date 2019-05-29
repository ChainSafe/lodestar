import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import sinon from "sinon";
import {Domain, LATEST_RANDAO_MIXES_LENGTH} from "../../../../../src/constants";
import {generateValidator} from "../../../../utils/validator";
import * as utils from "../../../../../src/chain/stateTransition/util";
import {getCurrentEpoch, getDomain} from "../../../../../src/chain/stateTransition/util";
import bls from "@chainsafe/bls-js";
import {hashTreeRoot} from "@chainsafe/ssz";
import {Epoch} from "../../../../../src/types";
import {generateEmptyBlock} from "../../../../utils/block";
import processRandao from "../../../../../src/chain/stateTransition/block/randao";

describe('process block - randao', function () {

  const sandbox = sinon.createSandbox();

  let getBeeaconProposerStub;

  beforeEach(() => {
    getBeeaconProposerStub = sandbox.stub(utils, "getBeaconProposerIndex");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail to process - invalid randao signature', function () {
    const state = generateState();
    const block = generateEmptyBlock();
    getBeeaconProposerStub.returns(0);
    try {
      processRandao(state, block);
      expect.fail();
    } catch (e) {
      expect(getBeeaconProposerStub.calledOnce).to.be.true;
    }
  });

  it('should process randao', function () {
    const wallet = bls.generateKeyPair();
    const validator = generateValidator();
    validator.pubkey = wallet.publicKey.toBytesCompressed();
    const state = generateState({validatorRegistry: [validator]});
    const block = generateEmptyBlock();
    getBeeaconProposerStub.returns(0);
    block.body.randaoReveal = wallet.privateKey.signMessage(
      hashTreeRoot(getCurrentEpoch(state), Epoch),
      getDomain(state, Domain.RANDAO)
    ).toBytesCompressed();
    try {
      processRandao(state, block);
      expect(getBeeaconProposerStub.calledOnce).to.be.true;
      expect(state.latestRandaoMixes[getCurrentEpoch(state) % LATEST_RANDAO_MIXES_LENGTH]).to.not.be.null;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
