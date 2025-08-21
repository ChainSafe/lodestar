import {ChainForkConfig} from "@lodestar/config";
import {ZERO_HASH_HEX} from "@lodestar/params";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Root} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {Eth1DataAndDeposits, IEth1ForBlockProduction, PowMergeBlock, TDProgress} from "./interface.js";
import {Eth1MockOptions} from "./options.js";

/**
 * Mock version of Eth1ForBlockProduction
 */
export class Eth1ForBlockProductionMock implements IEth1ForBlockProduction {
  private powBlocks: Map<string, PowMergeBlock> = new Map();

  constructor(
    private readonly options: Eth1MockOptions,
    config?: ChainForkConfig
  ) {
    const {terminalPowBlockNumber, terminalPowBlockHash} = options;
    const genericBlock: PowMergeBlock = {
      number: 0,
      blockHash: ZERO_HASH_HEX,
      parentHash: ZERO_HASH_HEX,
      totalDifficulty: BigInt(0),
    };
    const terminalPowBlock: PowMergeBlock = {
      number: terminalPowBlockNumber,
      blockHash: terminalPowBlockHash,
      parentHash: ZERO_HASH_HEX,
      totalDifficulty: config?.TERMINAL_TOTAL_DIFFICULTY ?? BigInt(0),
    };
    this.powBlocks.set(ZERO_HASH_HEX, genericBlock);
    this.powBlocks.set(terminalPowBlockHash, terminalPowBlock);
  }

  /**
   * Returns same eth1Data as in state and no deposits
   * May produce invalid blocks if deposits have to be added
   */
  async getEth1DataAndDeposits(state: CachedBeaconStateAllForks): Promise<Eth1DataAndDeposits> {
    return {eth1Data: state.eth1Data, deposits: []};
  }

  /**
   * Will miss the oportunity to propose the merge block but will still produce valid blocks
   */
  async getTerminalPowBlock(): Promise<Root | null> {
    return fromHex(this.options.terminalPowBlockHash);
  }

  /** Will not be able to validate the merge block */
  async getPowBlock(powBlockHash: string): Promise<PowMergeBlock | null> {
    let powBlock = this.powBlocks.get(powBlockHash);
    if (powBlock != null) {
      return powBlock;
    }
    // eth1mock may generate a random pow block hash
    const lastPowBlock = Array.from(this.powBlocks.values()).at(-1);
    if (lastPowBlock == null) {
      // should not happen, we populate at least 2 blocks in constructor
      throw new Error("No pow blocks available in Eth1ForBlockProductionDisabled");
    }
    powBlock = {
      number: lastPowBlock.number + 1,
      blockHash: powBlockHash,
      parentHash: lastPowBlock.blockHash,
      totalDifficulty: lastPowBlock.totalDifficulty + BigInt(1),
    };
    this.powBlocks.set(powBlockHash, powBlock);
    return powBlock;
  }

  getTDProgress(): TDProgress | null {
    return null;
  }

  isPollingEth1Data(): boolean {
    return false;
  }

  startPollingMergeBlock(): void {
    // Ignore
  }

  stopPollingEth1Data(): void {
    // Ignore
  }
}
