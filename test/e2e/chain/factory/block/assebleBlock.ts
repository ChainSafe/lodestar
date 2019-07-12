import {BeaconDB, ValidatorDB} from "../../../../../src/db";
import sinon from "sinon";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateState} from "../../../../utils/state";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import {assembleBlock} from "../../../../../src/chain/factory/block";
import {OpPool} from "../../../../../src/opPool";
import {EthersEth1Notifier} from "../../../../../src/eth1";
import {
  DEPOSIT_CONTRACT_TREE_DEPTH,
  ETH1_FOLLOW_DISTANCE,
  FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE,
  ZERO_HASH
} from "../../../../../src/constants";
import {getBeaconProposerIndex} from "../../../../../src/chain/stateTransition/util";
import {hashTreeRoot} from "@chainsafe/ssz";
import {BeaconBlockBody, BeaconBlockHeader, DepositData, ValidatorIndex} from "../../../../../src/types";
import {stateTransition} from "../../../../../src/chain/stateTransition";
import {expect} from "chai";
import BN from "bn.js";
import {generateValidator} from "../../../../utils/validator";
import {ProgressiveMerkleTree} from "../../../../../src/util/merkleTree";
import BlockProposingService from "../../../../../src/validator/services/block";
import {RpcClientOverInstance} from "../../../../../src/validator/rpc";
import {ValidatorApi} from "../../../../../src/rpc";
import {WinstonLogger} from "../../../../../src/logger";
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import {generateDeposit} from "../../../../utils/deposit";
import {BeaconChain} from "../../../../../src/chain";

describe('produce block', function () {
  this.timeout(0);

  const dbStub = sinon.createStubInstance(BeaconDB);
  const opPoolStub = new OpPool({}, {db: dbStub, chain: sinon.createStubInstance(BeaconChain)});
  const eth1Stub = sinon.createStubInstance(EthersEth1Notifier);

  it('should produce valid block - state without valid eth1 votes', async function () {

    const keypairs: Keypair[] = Array.from({length: 64},  () => Keypair.generate());
    const validators = keypairs.map((keypair) => {
      const validator = generateValidator(0, FAR_FUTURE_EPOCH);
      validator.pubkey = keypair.publicKey.toBytesCompressed();
      validator.effectiveBalance = MAX_EFFECTIVE_BALANCE;
      return validator;
    });
    const balances = Array.from({length: validators.length}, () => new BN("10000000"));
    const parentBlock = generateEmptyBlock();
    //if zero hash it get changed
    parentBlock.stateRoot = Buffer.alloc(32, 1);
    const parentHeader: BeaconBlockHeader = {
      stateRoot: parentBlock.stateRoot,
      signature: parentBlock.signature,
      slot: parentBlock.slot,
      parentRoot: parentBlock.parentRoot,
      bodyRoot: hashTreeRoot(parentBlock.body, BeaconBlockBody),
    };
    const state = generateState({
      validatorRegistry: validators,
      balances,
      latestBlockHeader: parentHeader
    });
    const tree = ProgressiveMerkleTree.empty(DEPOSIT_CONTRACT_TREE_DEPTH);
    tree.add(0, hashTreeRoot(generateDeposit().data, DepositData));
    dbStub.getChainHead.resolves(parentBlock);
    dbStub.getLatestState.resolves(state);
    dbStub.getMerkleTree.resolves(tree);
    dbStub.getProposerSlashings.resolves([]);
    dbStub.getAttestations.resolves([]);
    dbStub.getAttesterSlashings.resolves([]);
    dbStub.getVoluntaryExits.resolves([]);
    dbStub.getDeposits.resolves([]);
    eth1Stub.depositCount.resolves(1);
    eth1Stub.depositRoot.resolves(tree.root());
    // @ts-ignore
    eth1Stub.getHead.resolves({
      hash: '0x' + ZERO_HASH.toString('hex'),
      number: ETH1_FOLLOW_DISTANCE + 1
    });
    // @ts-ignore
    eth1Stub.getBlock.resolves({
      hash: '0x' + ZERO_HASH.toString('hex'),
      number: 1
    });
    const validatorIndex = getBeaconProposerIndex({...state, slot: 1});

    const blockProposingService = getBlockProposingService(
      validatorIndex,
      keypairs[validatorIndex].privateKey
    );
    // @ts-ignore
    blockProposingService.getRpcClient().validator.produceBlock.callsFake(async(slot, randao) => {
      // @ts-ignore
      return await assembleBlock(dbStub, opPoolStub, eth1Stub, slot, randao);
    });
    const block = await blockProposingService.createAndPublishBlock(1, state.fork);

    expect(() => stateTransition(state, block, false)).to.not.throw();
  });

  function getBlockProposingService(validatorIndex: ValidatorIndex, privateKey: PrivateKey): BlockProposingService {
    const rpcClientStub = sinon.createStubInstance(RpcClientOverInstance);
    rpcClientStub.validator = sinon.createStubInstance(ValidatorApi);
    const validatorDbStub = sinon.createStubInstance(ValidatorDB);
    return new BlockProposingService(
      validatorIndex,
      rpcClientStub,
      privateKey,
      validatorDbStub,
      sinon.createStubInstance(WinstonLogger)
    );
  }

});
