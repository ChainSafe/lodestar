/**
 * @module chain/genesis
 */

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
import {TreeBacked, List, fromHexString} from "@chainsafe/ssz";
import {IBeaconDb} from "../../db";
import {IEth1Notifier, IDepositEvent} from "../../eth1";
import pipe from "it-pipe";

export interface IGenesisBuilderModules {
  db: IBeaconDb;
  eth1: IEth1Notifier;
  logger: ILogger;
}

export class GenesisBuilder {
  private state: TreeBacked<BeaconState>;
  private depositTree: TreeBacked<List<Root>>;
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly eth1: IEth1Notifier;
  private readonly logger: ILogger;

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
   * This processes an eth1 block and check if it can form genesis state of eth1.
   */
  public isFormingValidGenesisState = async (events: IDepositEvent[]): Promise<boolean> => {
    const block = await this.eth1.getBlock(events[0].blockNumber);
    applyTimestamp(this.config, this.state, block.timestamp);
    applyEth1BlockHash(this.config, this.state, fromHexString(block.hash));
    const isValid = isValidGenesisState(this.config, this.state);
    this.logger.verbose(`genesis: Process block ${block.number}, valid genesis state=${isValid}`);
    if (isValid) {
      const eth1Data = {
        blockHash: fromHexString(block.hash),
        depositRoot: this.depositTree.tree().root,
        depositCount: events[events.length - 1].index + 1,
      };

      await Promise.all([
        // proposing data
        this.db.depositData.batchPut(events.map((depositEvent) => ({
          key: depositEvent.index,
          value: depositEvent,
        }))),
        this.db.eth1Data.put(block.timestamp, eth1Data)
      ]);
    }
    return isValid;
  };

  public processDepositEvents(): ((source: AsyncIterable<IDepositEvent[]>) => AsyncIterable<IDepositEvent[]>) {
    const {logger, doProcessDepositEvents, config} = this;
    return ((source: AsyncIterable<IDepositEvent[]>): AsyncIterable<IDepositEvent[]> => {
      return async function* () {
        for await (const depositEvents of source) {
          const lastBlockNumber = depositEvents[depositEvents.length - 1].blockNumber;
          const firstBlockNumber = depositEvents[0].blockNumber;
          for (let blockNumber = firstBlockNumber; blockNumber <= lastBlockNumber; blockNumber++) {
            const blockDepositEvents = depositEvents.filter(event => event.blockNumber === blockNumber);
            if (blockDepositEvents.length > 0) {
              await doProcessDepositEvents(blockDepositEvents);
              const depositCount = blockDepositEvents[blockDepositEvents.length - 1].index + 1;
              logger.info(`genesis: Found ${blockDepositEvents.length} deposit events for block ${blockNumber}, ` +
                `depositCount=${depositCount}`);
              if (depositCount >= config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT) {
                yield blockDepositEvents;
              }
            }
          }
        }
      }();
    });
  }

  public genesis = async (): Promise<TreeBacked<BeaconState>> => {
    await this.initialize();
    const eth1DataStream = await this.eth1.getDepositEventsFromBlock(true, undefined);
    const {isFormingValidGenesisState: processSingleBlock, state} = this;
    const foundGenesis = this.eth1.foundGenesis.bind(this.eth1);
    return await pipe(eth1DataStream,
      this.processDepositEvents(),
      async function(source: AsyncIterable<IDepositEvent[]>) {
        for await (const depositEvents of source) {
          const isValidGenesis = await processSingleBlock(depositEvents);
          if (isValidGenesis) {
            await foundGenesis();
            return state;
          }
        }
      });
  };

  private doProcessDepositEvents = async (depositEvents: IDepositEvent[]): Promise<void> => {
    const depositDataRoots = new Map<number, Root>();
    depositEvents.forEach(
      event => depositDataRoots.set(event.index, this.config.types.DepositData.hashTreeRoot(event)));
    await Promise.all([
      // deposit data roots
      this.db.depositDataRoot.batchPut(depositEvents.map((depositEvent) => ({
        key: depositEvent.index,
        value: depositDataRoots.get(depositEvent.index),
      }))),
      this.db.setLastProcessedEth1BlockNumber(depositEvents[0].blockNumber),
    ]);
    const deposits = depositEvents.map((depositEvent) => {
      this.depositTree.push(depositDataRoots.get(depositEvent.index));
      return {
        proof: this.depositTree.tree().getSingleProof(this.depositTree.gindexOfProperty(depositEvent.index)),
        data: depositEvent,
      };
    });
    this.deposits.push(...deposits);
    applyDeposits(this.config, this.state, this.deposits, this.depositTree);
  };

  private async initialize(): Promise<void> {
    const depositDatas = await this.db.depositData.values();
    const depositDataRoots = await this.db.depositDataRoot.values();
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

function applyEth1BlockHash(config: IBeaconConfig, state: BeaconState, eth1BlockHash: Bytes32): void {
  state.eth1Data.blockHash = eth1BlockHash;
  state.randaoMixes = Array<Bytes32>(config.params.EPOCHS_PER_HISTORICAL_VECTOR).fill(eth1BlockHash);
}

function applyTimestamp(config: IBeaconConfig, state: BeaconState, eth1Timestamp: number): void {
  state.genesisTime =
    eth1Timestamp - eth1Timestamp % config.params.MIN_GENESIS_DELAY + 2 * config.params.MIN_GENESIS_DELAY;
}

/**
 * Apply deposits for a state.
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
    >= config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT;
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
