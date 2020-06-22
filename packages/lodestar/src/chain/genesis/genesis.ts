/**
 * @module chain/genesis
 */

import {TreeBacked, List, fromHexString} from "@chainsafe/ssz";
import {
  BeaconBlock,
  BeaconBlockBody,
  BeaconBlockHeader,
  BeaconState,
  Deposit,
  Eth1Data,
  Number64,
  Bytes32,
  Fork,
  SignedBeaconBlock,
  Root,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {
  EMPTY_SIGNATURE,
  GENESIS_SLOT,
  ZERO_HASH,
} from "../../constants";
import {
  computeEpochAtSlot,
  getActiveValidatorIndices,
  getTemporaryBlockHeader,
  processDeposit,
} from "@chainsafe/lodestar-beacon-state-transition";
import {bigIntMin, ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconDb} from "../../db";
import {IEth1Notifier, IDepositEvent} from "../../eth1";
import pipe from "it-pipe";
import {ethers} from "ethers";
import {IGenesisBuilder, IGenesisBuilderModules} from "./interface";

export class GenesisBuilder implements IGenesisBuilder {
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly eth1: IEth1Notifier;
  private readonly logger: ILogger;
  private state: TreeBacked<BeaconState>;
  private depositTree: TreeBacked<List<Root>>;
  private deposits: Deposit[];

  constructor(config: IBeaconConfig, {eth1, db, logger}: IGenesisBuilderModules) {
    this.state = getGenesisBeaconState(
      config,
      config.types.Eth1Data.defaultValue(),
      getTemporaryBlockHeader(
        config,
        getEmptyBlock()
      )
    );
    this.depositTree = config.types.DepositDataRootList.tree.defaultValue();
    this.config = config;
    this.eth1 = eth1;
    this.db = db;
    this.logger = logger;
    this.deposits = [];
  }

  /**
   * Get eth1 deposit events and blocks and apply to this.state until we found genesis.
   */
  public waitForGenesis = async (): Promise<TreeBacked<BeaconState>> => {
    await this.initialize();
    const eth1DataStream = await this.eth1.startProcessEth1Blocks(true);
    return await pipe(eth1DataStream,
      async (source: AsyncIterable<[IDepositEvent[], ethers.providers.Block]>) => {
        for await (const data of source) {
          const depositEvents = data[0];
          const deposits = depositEvents.map((depositEvent) => {
            this.depositTree.push(this.config.types.DepositData.hashTreeRoot(depositEvent));
            return {
              proof: this.depositTree.tree().getSingleProof(this.depositTree.gindexOfProperty(depositEvent.index)),
              data: depositEvent,
            };
          });
          this.deposits.push(...deposits);
          applyDeposits(this.config, this.state, this.deposits, this.depositTree);
          const block = data[1];
          if (!block) {
            continue;
          }
          applyTimestamp(this.config, this.state, block.timestamp);
          applyEth1BlockHash(this.config, this.state, fromHexString(block.hash));
          const isValid = isValidGenesisState(this.config, this.state);
          if (isValid) {
            this.logger.info(`Found genesis state at eth1 block ${block.number}`);
            this.eth1.unsubscribeEth1Blocks();
            return this.state;
          }
        }
      }
    );
  };

  private async initialize(): Promise<void> {
    const depositDatas = await this.db.depositData.values() || [];
    const depositDataRoots = await this.db.depositDataRoot.values() || [];
    const deposits = depositDatas.map((event, index) => {
      this.depositTree.push(depositDataRoots[index]);
      return {
        proof: this.depositTree.tree().getSingleProof(this.depositTree.gindexOfProperty(index)),
        data: event,
      };
    });
    this.deposits.push(...deposits);
  }

}

/**
 * Mainly used for spec test.
 * @param config
 * @param eth1BlockHash
 * @param eth1Timestamp
 * @param deposits
 */
export function initializeBeaconStateFromEth1(
  config: IBeaconConfig,
  eth1BlockHash: Bytes32,
  eth1Timestamp: Number64,
  deposits: Deposit[]): TreeBacked<BeaconState> {
  const state = getGenesisBeaconState(
    config,
    {
      depositCount: deposits.length,
      depositRoot: new Uint8Array(32),
      blockHash: eth1BlockHash
    },
    getTemporaryBlockHeader(
      config,
      getEmptyBlock()
    )
  );

  applyTimestamp(config, state, eth1Timestamp);

  // Process deposits
  applyDeposits(config, state, deposits);

  return state as TreeBacked<BeaconState>;
}

/**
 * Apply eth1 block hash to state.
 * @param config IBeaconConfig
 * @param state BeaconState
 * @param eth1BlockHash eth1 block hash
 */
function applyEth1BlockHash(config: IBeaconConfig, state: BeaconState, eth1BlockHash: Bytes32): void {
  state.eth1Data.blockHash = eth1BlockHash;
  state.randaoMixes = Array<Bytes32>(config.params.EPOCHS_PER_HISTORICAL_VECTOR).fill(eth1BlockHash);
}

/**
 * Apply eth1 block timestamp to state.
 * @param config IBeaconState
 * @param state BeaconState
 * @param eth1Timestamp eth1 block timestamp
 */
function applyTimestamp(config: IBeaconConfig, state: BeaconState, eth1Timestamp: number): void {
  state.genesisTime =
    eth1Timestamp - eth1Timestamp % config.params.MIN_GENESIS_DELAY + 2 * config.params.MIN_GENESIS_DELAY;
}

/**
 * Apply deposits to state.
 * @param config IBeaconConfig
 * @param state BeaconState
 * @param deposits full list of deposits
 */
function applyDeposits(
  config: IBeaconConfig,
  state: BeaconState,
  deposits: Deposit[],
  fullDepositDataRootList?: TreeBacked<List<Root>>
): void {
  state.eth1Data.depositCount = deposits.length;
  const leaves = deposits.map((deposit) => deposit.data);
  const depositDataRootList: Root[] = [];
  deposits.forEach((deposit, index) => {
    if (fullDepositDataRootList) {
      depositDataRootList.push(fullDepositDataRootList[index]);
    }
    if (index >= state.eth1DepositIndex) {
      if (fullDepositDataRootList) {
        state.eth1Data.depositRoot = config.types.DepositDataRootList.hashTreeRoot(depositDataRootList);
      } else {
        const depositDataList = leaves.slice(0, index + 1);
        state.eth1Data.depositRoot = config.types.DepositDataRootList.hashTreeRoot(
          depositDataList.map((d) => config.types.DepositData.hashTreeRoot(d))
        );
      }
      processDeposit(config, state, deposit);
    }
  });

  // Process activations
  state.validators.forEach((validator, index) => {
    const balance = state.balances[index];
    validator.effectiveBalance = bigIntMin(
      balance - (balance % config.params.EFFECTIVE_BALANCE_INCREMENT),
      config.params.MAX_EFFECTIVE_BALANCE
    );
    if(validator.effectiveBalance === config.params.MAX_EFFECTIVE_BALANCE) {
      validator.activationEligibilityEpoch = computeEpochAtSlot(config, GENESIS_SLOT);
      validator.activationEpoch = computeEpochAtSlot(config, GENESIS_SLOT);
    }
  });

  // Set genesis validators root for domain separation and chain versioning
  state.genesisValidatorsRoot = config.types.BeaconState.fields.validators.hashTreeRoot(state.validators);

}

export function isValidGenesisState(config: IBeaconConfig, state: BeaconState): boolean {
  if(state.genesisTime < config.params.MIN_GENESIS_TIME) {
    return false;
  }
  return getActiveValidatorIndices(state, computeEpochAtSlot(config, GENESIS_SLOT)).length
      >=
      config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT;

}

/**
 * Generate the initial beacon chain state.
 */
function getGenesisBeaconState(
  config: IBeaconConfig,
  genesisEth1Data: Eth1Data,
  latestBlockHeader: BeaconBlockHeader
): TreeBacked<BeaconState> {
  // Seed RANDAO with Eth1 entropy
  const randaoMixes = Array<Bytes32>(config.params.EPOCHS_PER_HISTORICAL_VECTOR).fill(genesisEth1Data.blockHash);

  const state: BeaconState = config.types.BeaconState.tree.defaultValue();
  // MISC
  state.slot = GENESIS_SLOT;
  state.fork = {
    previousVersion: config.params.GENESIS_FORK_VERSION,
    currentVersion: config.params.GENESIS_FORK_VERSION,
    epoch: computeEpochAtSlot(config, GENESIS_SLOT),
  } as Fork;

  // Validator registry

  // Randomness and committees
  state.latestBlockHeader = latestBlockHeader;

  // Ethereum 1.0 chain data
  state.eth1Data = genesisEth1Data;
  state.randaoMixes = randaoMixes;

  return state as TreeBacked<BeaconState>;
}

export function getEmptyBlockBody(): BeaconBlockBody {
  return {
    randaoReveal: EMPTY_SIGNATURE,
    eth1Data: {
      depositRoot: ZERO_HASH,
      depositCount: 0,
      blockHash: ZERO_HASH,
    },
    graffiti: ZERO_HASH,
    proposerSlashings: [],
    attesterSlashings: [],
    attestations: [],
    deposits: [],
    voluntaryExits: [],
  };
}

/**
 * Get an empty [[BeaconBlock]].
 */
export function getEmptySignedBlock(): SignedBeaconBlock {
  const block = getEmptyBlock();
  return {
    message: block,
    signature: Buffer.alloc(96),
  };
}

/**
 * Get an empty [[BeaconBlock]].
 */
export function getEmptyBlock(): BeaconBlock {
  return {
    slot: GENESIS_SLOT,
    proposerIndex: 0,
    parentRoot: ZERO_HASH,
    stateRoot: ZERO_HASH,
    body: getEmptyBlockBody(),
  };
}
