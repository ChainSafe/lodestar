import {expect} from "chai";
import sinon from "sinon";
import {Keypair} from "@chainsafe/bls/lib/keypair";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {FAR_FUTURE_EPOCH, ZERO_HASH} from "../../../../../src/constants";
import {IValidatorDB, ValidatorDB} from "../../../../../src/db";
import {generateEmptySignedBlock} from "../../../../utils/block";
import {generateState} from "../../../../utils/state";
import {assembleBlock} from "../../../../../src/chain/factory/block";
import {
  getBeaconProposerIndex,
  signedBlockToSignedHeader,
  stateTransition
} from "@chainsafe/lodestar-beacon-state-transition";
import {generateValidator} from "../../../../utils/validator";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {generateDeposit} from "../../../../utils/deposit";
import {BeaconChain} from "../../../../../src/chain";
import {StatefulDagLMDGHOST} from "../../../../../src/chain/forkChoice";

import BlockProposingService from "@chainsafe/lodestar-validator/lib/services/block";
import {describe, it} from "mocha";
import {ApiClientOverInstance} from "@chainsafe/lodestar-validator/lib";
import {ValidatorApi} from "../../../../../src/api/impl/validator";
import {StubbedBeaconDb} from "../../../../utils/stub";

describe("produce block", function () {
  this.timeout(0);
  const dbStub = new StubbedBeaconDb(sinon);
  const chainStub = sinon.createStubInstance(BeaconChain);
  chainStub.forkChoice = sinon.createStubInstance(StatefulDagLMDGHOST);

  it("should produce valid block - state without valid eth1 votes", async function () {
    const keypairs: Keypair[] = Array.from({length: 64}, () => Keypair.generate());
    const validators = keypairs.map((keypair) => {
      const validator = generateValidator({activationEpoch: 0, exitEpoch: FAR_FUTURE_EPOCH});
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
    chainStub.getHeadState.resolves(config.types.BeaconState.clone(state));
    chainStub.getHeadBlock.resolves(parentBlock);
    dbStub.depositDataRoot.getTreeBacked.resolves(depositDataRootList);
    dbStub.proposerSlashing.values.resolves([]);
    dbStub.aggregateAndProof.getBlockAttestations.resolves([]);
    dbStub.attesterSlashing.values.resolves([]);
    dbStub.voluntaryExit.values.resolves([]);
    dbStub.depositData.values.resolves([]);
    dbStub.eth1Data.values.resolves([{depositCount: 1, depositRoot: tree.root, blockHash: Buffer.alloc(32)}]);
    const validatorIndex = getBeaconProposerIndex(config, {...state, slot: 1});

    const blockProposingService = getBlockProposingService(
      keypairs[validatorIndex]
    );
    // @ts-ignore
    blockProposingService.getRpcClient().validator.produceBlock.callsFake(async (slot, validatorPubkey, randao) => {
      // @ts-ignore
      return await assembleBlock(config, chainStub, dbStub, slot, validatorIndex, randao);
    });
    const block = await blockProposingService.createAndPublishBlock(1, state.fork, ZERO_HASH);
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
