import {expect} from "chai";
import BN from "bn.js";
import {hashTreeRoot} from "@chainsafe/ssz";
import sinon from "sinon";
import {Keypair} from "@chainsafe/bls/lib/keypair";
import {BeaconBlockHeader, ValidatorIndex} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {PrivateKey} from "@chainsafe/bls/lib/privateKey";
import {
  DEPOSIT_CONTRACT_TREE_DEPTH,
  FAR_FUTURE_EPOCH,
  ZERO_HASH
} from "../../../../../src/constants";
import {ValidatorDB, LevelDbController} from "../../../../../src/db";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateState} from "../../../../utils/state";
import {assembleBlock} from "../../../../../src/chain/factory/block";
import {OpPool} from "../../../../../src/opPool";
import {EthersEth1Notifier} from "../../../../../src/eth1";
import {getBeaconProposerIndex} from "../../../../../src/chain/stateTransition/util";
import {stateTransition} from "../../../../../src/chain/stateTransition";
import {generateValidator} from "../../../../utils/validator";
import {ProgressiveMerkleTree} from "../../../../../src/util/merkleTree";
import BlockProposingService from "../../../../../src/validator/services/block";
import {RpcClientOverInstance} from "../../../../../src/validator/rpc";
import {ValidatorApi} from "../../../../../src/rpc";
import {WinstonLogger, ILogger} from "../../../../../src/logger";
import {generateDeposit} from "../../../../utils/deposit";
import {
  AttestationRepository,
  AttesterSlashingRepository,
  BlockRepository,
  ChainRepository,
  DepositRepository,
  MerkleTreeRepository,
  ProposerSlashingRepository,
  StateRepository,
  VoluntaryExitRepository
} from "../../../../../src/db/api/beacon/repositories";
import promisify from "promisify-es6";
import leveldown from "leveldown";
import level from "level";

describe('produce block with deposits', function () {
  this.timeout(0);

  const dbLocation = "./.__testdb_deposits";
  const testDb = level(
    dbLocation, {
      keyEncoding: 'binary',
      valueEncoding: 'binary',
    });

  let logger: ILogger = new WinstonLogger();
  const depositDBController = new LevelDbController({db: testDb, name: dbLocation}, {logger});
  const dbStub = {
    chain: sinon.createStubInstance(ChainRepository),
    block: sinon.createStubInstance(BlockRepository),
    state: sinon.createStubInstance(StateRepository),
    merkleTree: sinon.createStubInstance(MerkleTreeRepository),
    proposerSlashing: sinon.createStubInstance(ProposerSlashingRepository),
    attesterSlashing: sinon.createStubInstance(AttesterSlashingRepository),
    attestation: sinon.createStubInstance(AttestationRepository),
    voluntaryExit: sinon.createStubInstance(VoluntaryExitRepository),
    deposit: new DepositRepository(config, depositDBController),
  };

  const opPoolStub = new OpPool({},
    {db: dbStub, eth1: sinon.createStubInstance(EthersEth1Notifier)});
  const eth1Stub = sinon.createStubInstance(EthersEth1Notifier);

  before(async () => {
    logger.silent = true;
    await depositDBController.start();
  });

  after(async () => {
    await depositDBController.stop();
    await promisify(leveldown.destroy)(dbLocation, function () {});
    logger.silent = false;
  });

  it('Should retrieve all necessary deposits', async function () {
    const keypairs: Keypair[] = Array.from({length: 64},  () => Keypair.generate());
    const validators = keypairs.map((keypair) => {
      const validator = generateValidator(0, FAR_FUTURE_EPOCH);
      validator.pubkey = keypair.publicKey.toBytesCompressed();
      validator.effectiveBalance = config.params.MAX_EFFECTIVE_BALANCE;
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
      bodyRoot: hashTreeRoot(parentBlock.body, config.types.BeaconBlockBody),
    };
    const state = generateState({
      validators: validators,
      balances,
      latestBlockHeader: parentHeader
    });
    const tree = ProgressiveMerkleTree.empty(DEPOSIT_CONTRACT_TREE_DEPTH);

    // Add deposits to be included in block
    for (let i = 0; i < 5; i++) {
      const deposit = generateDeposit();
      tree.add(i, hashTreeRoot(deposit.data, config.types.DepositData));
      await opPoolStub.deposits.receive(i, deposit);
    }
    
    let deposits = await opPoolStub.deposits.getAllBetween(0, 5);
    expect(deposits.length).equals(5);
    

    dbStub.block.getChainHead.resolves(parentBlock);
    dbStub.state.getLatest.resolves(state);
    dbStub.merkleTree.getProgressiveMerkleTree.resolves(tree);
    dbStub.proposerSlashing.getAll.resolves([]);
    dbStub.attestation.getAll.resolves([]);
    dbStub.attesterSlashing.getAll.resolves([]);
    dbStub.voluntaryExit.getAll.resolves([]);
    eth1Stub.depositCount.resolves(5);
    eth1Stub.depositRoot.resolves(tree.root());
    // @ts-ignore
    eth1Stub.getHead.resolves({
      hash: '0x' + ZERO_HASH.toString('hex'),
      number: config.params.ETH1_FOLLOW_DISTANCE + 1
    });
    // @ts-ignore
    eth1Stub.getBlock.resolves({
      hash: '0x' + ZERO_HASH.toString('hex'),
      number: 1
    });
    const validatorIndex = getBeaconProposerIndex(config, {...state, slot: 1});
    
    const blockProposingService = getBlockProposingService(
      validatorIndex,
      keypairs[validatorIndex].privateKey
    );
      // @ts-ignore
    blockProposingService.getRpcClient().validator.produceBlock.callsFake(async(slot, randao) => {
    // @ts-ignore
      return await assembleBlock(config, dbStub, opPoolStub, eth1Stub, slot, randao);
    });

    // For assertion check in processOperations
    state.eth1Data.depositCount = 5;

    // const block = await blockProposingService.createAndPublishBlock(1, state.fork);
    // Add additional deposits that won't be included in state transition
    // for (let i = 5; i < 7; i++) {
    //   tree.add(i, hashTreeRoot(generateDeposit().data, config.types.DepositData));
    // }

    
    // deposits = await dbStub.deposit.getAll();
    // expect(deposits.length).equals(7);
    
    // expect(() => stateTransition(config, state, block, false)).to.not.throw();
    // deposits = await dbStub.deposit.getAll();
    // expect(deposits.length).equals(2);
  });

  function getBlockProposingService(validatorIndex: ValidatorIndex, privateKey: PrivateKey): BlockProposingService {
    const rpcClientStub = sinon.createStubInstance(RpcClientOverInstance);
    rpcClientStub.validator = sinon.createStubInstance(ValidatorApi);
    const validatorDbStub = sinon.createStubInstance(ValidatorDB);
    return new BlockProposingService(
      config,
      validatorIndex,
      rpcClientStub,
      privateKey,
      validatorDbStub,
      sinon.createStubInstance(WinstonLogger)
    );
  }

});
