import {expect} from "chai";
import sinon from "sinon";
import bls, {SecretKey} from "@chainsafe/bls";
import {List} from "@chainsafe/ssz";
import {Validator} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/minimal";
import {SlashingProtection} from "@chainsafe/lodestar-validator";
import {FAR_FUTURE_EPOCH, ZERO_HASH} from "../../../../../src/constants";
import {generateBlockSummary, generateEmptySignedBlock} from "../../../../utils/block";
import {generateCachedState} from "../../../../utils/state";
import {assembleBlock} from "../../../../../src/chain/factory/block";
import {
  getBeaconProposerIndex,
  signedBlockToSignedHeader,
  fastStateTransition,
} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {generateValidator} from "../../../../utils/validator";
import {generateDeposit} from "../../../../utils/deposit";
import {BeaconChain} from "../../../../../src/chain";
import {Eth1ForBlockProduction} from "../../../../../src/eth1";

import BlockProposingService from "@chainsafe/lodestar-validator/lib/services/block";
import {ApiClientOverInstance} from "@chainsafe/lodestar-validator/lib";
import {ValidatorApi} from "../../../../../src/api/impl/validator";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {silentLogger} from "../../../../utils/logger";
import {StateRegenerator} from "../../../../../src/chain/regen";

describe("produce block", function () {
  this.timeout("10 min");

  const dbStub = new StubbedBeaconDb(sinon);
  const chainStub = sinon.createStubInstance(BeaconChain);
  chainStub.forkChoice = sinon.createStubInstance(ForkChoice);
  const regenStub = (chainStub.regen = sinon.createStubInstance(StateRegenerator));
  const forkChoiceStub = (chainStub.forkChoice = sinon.createStubInstance(ForkChoice));
  const eth1 = sinon.createStubInstance(Eth1ForBlockProduction);

  it("should produce valid block - state without valid eth1 votes", async function () {
    const secretKeys = Array.from({length: 64}, () => bls.SecretKey.fromKeygen());

    const validators = secretKeys.map((secretKey) => {
      const validator = generateValidator({activationEpoch: 0, exitEpoch: FAR_FUTURE_EPOCH});
      validator.pubkey = secretKey.toPublicKey().toBytes();
      validator.effectiveBalance = config.params.MAX_EFFECTIVE_BALANCE;
      return validator;
    });
    const balances = Array.from({length: validators.length}, () => BigInt("10000000"));
    const parentBlock = generateEmptySignedBlock();
    //if zero hash it get changed
    parentBlock.message.stateRoot = Buffer.alloc(32, 1);
    const parentHeader = signedBlockToSignedHeader(config, parentBlock);
    const parentBlockSummary = generateBlockSummary({
      slot: parentBlock.message.slot,
      blockRoot: config.types.BeaconBlockHeader.hashTreeRoot(parentHeader.message),
      parentRoot: parentBlock.message.parentRoot.valueOf() as Uint8Array,
      stateRoot: parentBlock.message.stateRoot.valueOf() as Uint8Array,
    });
    const depositDataRootList = config.types.DepositDataRootList.tree.defaultValue();
    const tree = depositDataRootList.tree();
    depositDataRootList.push(config.types.DepositData.hashTreeRoot(generateDeposit().data));
    const cachedState = generateCachedState({
      validators: validators as List<Validator>,
      balances: balances as List<bigint>,
      latestBlockHeader: parentHeader.message,
      loadState: true,
    });
    const slotState = cachedState.clone();
    slotState.slot = 1;
    sinon.stub(slotState, "getBeaconProposer").returns(20);
    regenStub.getBlockSlotState.withArgs(sinon.match.any, 1).resolves(slotState);
    forkChoiceStub.getHead.returns(parentBlockSummary);
    dbStub.depositDataRoot.getTreeBacked.resolves(depositDataRootList);
    dbStub.proposerSlashing.values.resolves([]);
    dbStub.aggregateAndProof.getBlockAttestations.resolves([]);
    dbStub.attesterSlashing.values.resolves([]);
    dbStub.voluntaryExit.values.resolves([]);
    eth1.getEth1DataAndDeposits.resolves({
      eth1Data: {depositCount: 1, depositRoot: tree.root, blockHash: Buffer.alloc(32)},
      deposits: [],
    });
    const validatorIndex = getBeaconProposerIndex(config, {...cachedState.getOriginalState(), slot: 1});

    const blockProposingService = getBlockProposingService(secretKeys[validatorIndex]);
    // @ts-ignore
    blockProposingService.getRpcClient().validator.produceBlock.callsFake(async (slot, randao) => {
      return await assembleBlock(config, chainStub, dbStub, eth1, slot, randao);
    });
    const block = await blockProposingService.createAndPublishBlock(0, 1, cachedState.fork, ZERO_HASH);
    expect(() => fastStateTransition(cachedState, block!, {verifyStateRoot: false})).to.not.throw();
  });

  function getBlockProposingService(secretKey: SecretKey): BlockProposingService {
    const rpcClientStub = sinon.createStubInstance(ApiClientOverInstance);
    rpcClientStub.validator = sinon.createStubInstance(ValidatorApi);
    const slashingProtection = sinon.createStubInstance(SlashingProtection);
    return new BlockProposingService(config, [secretKey], rpcClientStub, slashingProtection, silentLogger);
  }
});
