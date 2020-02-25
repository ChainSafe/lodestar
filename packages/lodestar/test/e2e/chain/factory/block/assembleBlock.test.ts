import {expect} from "chai";
import sinon from "sinon";
import {Keypair} from "@chainsafe/bls/lib/keypair";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {FAR_FUTURE_EPOCH, ZERO_HASH} from "../../../../../src/constants";
import {IValidatorDB, ValidatorDB} from "../../../../../src/db";
import {generateEmptySignedBlock} from "../../../../utils/block";
import {generateState} from "../../../../utils/state";
import {assembleBlock} from "../../../../../src/chain/factory/block";
import {OpPool} from "../../../../../src/opPool";
import {EthersEth1Notifier} from "../../../../../src/eth1";
import {getBeaconProposerIndex, stateTransition, signedBlockToSignedHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {generateValidator} from "../../../../utils/validator";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {generateDeposit} from "../../../../utils/deposit";
import {BeaconChain} from "../../../../../src/chain";
import {StatefulDagLMDGHOST} from "../../../../../src/chain/forkChoice";

import {
  AggregateAndProofRepository,
  AttesterSlashingRepository,
  BlockRepository,
  ChainRepository,
  DepositDataRepository,
  DepositDataRootListRepository,
  ProposerSlashingRepository,
  StateRepository,
  VoluntaryExitRepository
} from "../../../../../src/db/api/beacon/repositories";
import BlockProposingService from "@chainsafe/lodestar-validator/lib/services/block";
import {describe, it} from "mocha";
import {ApiClientOverInstance} from "@chainsafe/lodestar-validator/lib";
import * as stateTransitionUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/block";
import {ValidatorApi} from "../../../../../src/api/rpc/api/validator";

describe("produce block", function () {
  this.timeout(0);
  const dbStub = {
    chain: sinon.createStubInstance(ChainRepository),
    block: sinon.createStubInstance(BlockRepository),
    state: sinon.createStubInstance(StateRepository),
    depositDataRootList: sinon.createStubInstance(DepositDataRootListRepository),
    proposerSlashing: sinon.createStubInstance(ProposerSlashingRepository),
    attesterSlashing: sinon.createStubInstance(AttesterSlashingRepository),
    aggregateAndProof: sinon.createStubInstance(AggregateAndProofRepository),
    voluntaryExit: sinon.createStubInstance(VoluntaryExitRepository),
    depositData: sinon.createStubInstance(DepositDataRepository),
  }; // missing transfer
  // @ts-ignore
  const opPoolStub = new OpPool({}, {config: config, db: dbStub, eth1: sinon.createStubInstance(EthersEth1Notifier)});
  const eth1Stub = sinon.createStubInstance(EthersEth1Notifier);
  const isValidProposerStub = sinon.stub(stateTransitionUtils, "isValidProposer");
  eth1Stub.getEth1Vote = sinon.stub();
  const chainStub = sinon.createStubInstance(BeaconChain);
  chainStub.forkChoice = sinon.createStubInstance(StatefulDagLMDGHOST);

  it("should produce valid block - state without valid eth1 votes", async function () {
    const keypairs: Keypair[] = Array.from({length: 64}, () => Keypair.generate());
    const validators = keypairs.map((keypair) => {
      const validator = generateValidator({activation: 0, exit: FAR_FUTURE_EPOCH});
      validator.pubkey = keypair.publicKey.toBytesCompressed();
      validator.effectiveBalance = config.params.MAX_EFFECTIVE_BALANCE;
      return validator;
    });
    const balances = Array.from({length: validators.length}, () => BigInt("10000000"));
    const parentBlock = generateEmptySignedBlock();
    //if zero hash it get changed
    parentBlock.message.stateRoot = Buffer.alloc(32, 1);
    const parentHeader = signedBlockToSignedHeader(config, parentBlock);
    const state = generateState({
      validators: validators,
      balances,
      latestBlockHeader: parentHeader.message,
    });
    const depositDataRootList = config.types.DepositDataRootList.tree.defaultValue();
    const tree = depositDataRootList.tree();
    depositDataRootList.push(config.types.DepositData.hashTreeRoot(generateDeposit().data));
    dbStub.block.getChainHead.resolves(parentBlock);
    dbStub.state.get.resolves(config.types.BeaconState.clone(state));
    dbStub.block.get.withArgs(chainStub.forkChoice.head()).resolves(parentBlock);
    dbStub.depositDataRootList.get.resolves(depositDataRootList);
    dbStub.proposerSlashing.getAll.resolves([]);
    dbStub.aggregateAndProof.getAll.resolves([]);
    dbStub.attesterSlashing.getAll.resolves([]);
    dbStub.voluntaryExit.getAll.resolves([]);
    dbStub.depositData.getAllBetween.resolves([]);
    eth1Stub.depositCount.resolves(1);
    eth1Stub.depositRoot.resolves(tree.root);
    eth1Stub.getEth1Vote.resolves({depositCount: 1, depositRoot: tree.root, blockHash: Buffer.alloc(32)});
    // @ts-ignore
    eth1Stub.getHead.resolves({
      hash: "0x" + ZERO_HASH.toString("hex"),
      number: config.params.ETH1_FOLLOW_DISTANCE + 1
    });
    // @ts-ignore
    eth1Stub.getBlock.resolves({
      hash: "0x" + ZERO_HASH.toString("hex"),
      number: 1
    });
    isValidProposerStub.returns(true);
    const validatorIndex = getBeaconProposerIndex(config, {...state, slot: 1});

    const blockProposingService = getBlockProposingService(
      keypairs[validatorIndex]
    );
    // @ts-ignore
    blockProposingService.getRpcClient().validator.produceBlock.callsFake(async (slot, randao) => {
      // @ts-ignore
      return await assembleBlock(config, chainStub, dbStub, opPoolStub, eth1Stub, slot, randao);
    });
    const block = await blockProposingService.createAndPublishBlock(1, state.fork);
    expect(() => stateTransition(config, state, block, false)).to.not.throw();
  });

  function getBlockProposingService(keypair: Keypair): BlockProposingService {
    const rpcClientStub = sinon.createStubInstance(ApiClientOverInstance);
    rpcClientStub.validator = sinon.createStubInstance(ValidatorApi);
    const validatorDbStub = sinon.createStubInstance(ValidatorDB);
    return new BlockProposingService(
      config,
      keypair,
      rpcClientStub,
      validatorDbStub as unknown as IValidatorDB,
      sinon.createStubInstance(WinstonLogger)
    );
  }

});
