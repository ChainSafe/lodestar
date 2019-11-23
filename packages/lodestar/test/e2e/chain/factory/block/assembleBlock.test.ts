import { expect } from "chai";
import { clone, hashTreeRoot } from "@chainsafe/ssz";
import sinon from "sinon";
import { Keypair } from "@chainsafe/bls/lib/keypair";
import { BeaconBlockHeader } from "@chainsafe/eth2.0-types";
import { config } from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import { DEPOSIT_CONTRACT_TREE_DEPTH, FAR_FUTURE_EPOCH, ZERO_HASH } from "../../../../../src/constants";
import { IValidatorDB, ValidatorDB } from "../../../../../src/db";
import { generateEmptyBlock } from "../../../../utils/block";
import { generateState } from "../../../../utils/state";
import { assembleBlock } from "../../../../../src/chain/factory/block";
import { OpPool } from "../../../../../src/opPool";
import { EthersEth1Notifier } from "../../../../../src/eth1";
import { blockToHeader, getBeaconProposerIndex } from "@chainsafe/eth2.0-state-transition";
import { stateTransition } from "@chainsafe/eth2.0-state-transition";
import { generateValidator } from "../../../../utils/validator";
import { WinstonLogger } from "../../../../../src/logger";
import { generateDeposit } from "../../../../utils/deposit";
import { BeaconChain } from "../../../../../src/chain";
import { StatefulDagLMDGHOST } from "../../../../../src/chain/forkChoice";

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
import { ValidatorApi } from "../../../../../src/api/rpc/api/validator";
import { ProgressiveMerkleTree } from "@chainsafe/eth2.0-utils";
import { MerkleTreeSerialization } from "../../../../../src/util/serialization";
import BlockProposingService from "@chainsafe/lodestar-validator/lib/services/block";
import { describe, it } from "mocha";
import { ApiClientOverInstance } from "@chainsafe/lodestar-validator/lib";

describe("produce block", function () {
  this.timeout(0);
  const dbStub = {
    chain: sinon.createStubInstance(ChainRepository),
    block: sinon.createStubInstance(BlockRepository),
    state: sinon.createStubInstance(StateRepository),
    merkleTree: sinon.createStubInstance(MerkleTreeRepository),
    proposerSlashing: sinon.createStubInstance(ProposerSlashingRepository),
    attesterSlashing: sinon.createStubInstance(AttesterSlashingRepository),
    attestation: sinon.createStubInstance(AttestationRepository),
    voluntaryExit: sinon.createStubInstance(VoluntaryExitRepository),
    deposit: sinon.createStubInstance(DepositRepository),
  }; // missing transfer
  // @ts-ignore
  const opPoolStub = new OpPool({}, { config: config, db: dbStub, eth1: sinon.createStubInstance(EthersEth1Notifier) });
  const eth1Stub = sinon.createStubInstance(EthersEth1Notifier);
  const chainStub = sinon.createStubInstance(BeaconChain);
  chainStub.forkChoice = sinon.createStubInstance(StatefulDagLMDGHOST);

  it("should produce valid block - state without valid eth1 votes", async function () {
    const keypairs: Keypair[] = Array.from({ length: 64 }, () => Keypair.generate());
    const validators = keypairs.map((keypair) => {
      const validator = generateValidator({ activation: 0, exit: FAR_FUTURE_EPOCH });
      validator.pubkey = keypair.publicKey.toBytesCompressed();
      validator.effectiveBalance = config.params.MAX_EFFECTIVE_BALANCE;
      return validator;
    });
    const balances = Array.from({length: validators.length}, () => BigInt("10000000"));
    const parentBlock = generateEmptyBlock();
    //if zero hash it get changed
    parentBlock.stateRoot = Buffer.alloc(32, 1);
    const parentHeader: BeaconBlockHeader = blockToHeader(config, parentBlock);
    const state = generateState({
      validators: validators,
      balances,
      latestBlockHeader: parentHeader
    });
    const tree = ProgressiveMerkleTree.empty(DEPOSIT_CONTRACT_TREE_DEPTH, new MerkleTreeSerialization(config));
    tree.add(0, hashTreeRoot(generateDeposit().data, config.types.DepositData));
    dbStub.block.getChainHead.resolves(parentBlock);
    dbStub.state.get.resolves(clone(state, config.types.BeaconState));
    dbStub.block.get.withArgs(chainStub.forkChoice.head()).resolves(parentBlock);
    dbStub.merkleTree.getProgressiveMerkleTree.resolves(tree);
    dbStub.proposerSlashing.getAll.resolves([]);
    dbStub.attestation.getAll.resolves([]);
    dbStub.attesterSlashing.getAll.resolves([]);
    dbStub.voluntaryExit.getAll.resolves([]);
    dbStub.deposit.getAllBetween.resolves([]);
    eth1Stub.depositCount.resolves(1);
    eth1Stub.depositRoot.resolves(tree.root());
    // @ts-ignore
    eth1Stub.getEth1Data.resolves({ depositCount: 1, depositRoot: tree.root(), blockHash: Buffer.alloc(32) });
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
    const validatorIndex = getBeaconProposerIndex(config, { ...state, slot: 1 });

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
