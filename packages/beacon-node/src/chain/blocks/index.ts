/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {allForks} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {JobItemQueue} from "../../util/queue/index.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import {IBeaconChain} from "../interface.js";
import {verifyBlock, VerifyBlockModules} from "./verifyBlock.js";
import {importBlock, ImportBlockModules} from "./importBlock.js";
import {assertLinearChainSegment} from "./utils/chainSegment.js";
import {ImportBlockOpts} from "./types.js";
export {ImportBlockOpts} from "./types.js";

const QUEUE_MAX_LENGHT = 256;

export type ProcessBlockModules = VerifyBlockModules &
  ImportBlockModules & {
    persistInvalidSszValue: IBeaconChain["persistInvalidSszValue"];
    persistInvalidSszView: IBeaconChain["persistInvalidSszView"];
  };

/**
 * BlockProcessor processes block jobs in a queued fashion, one after the other.
 */
export class BlockProcessor {
  readonly jobQueue: JobItemQueue<[allForks.SignedBeaconBlock[], ImportBlockOpts], void>;

  constructor(modules: ProcessBlockModules, opts: BlockProcessOpts, signal: AbortSignal) {
    this.jobQueue = new JobItemQueue<[allForks.SignedBeaconBlock[], ImportBlockOpts], void>(
      (job, importOpts) => {
        return processBlocks(modules, job, {...opts, ...importOpts});
      },
      {maxLength: QUEUE_MAX_LENGHT, signal},
      modules.metrics ? modules.metrics.blockProcessorQueue : undefined
    );
  }

  async processBlocksJob(job: allForks.SignedBeaconBlock[], opts: ImportBlockOpts = {}): Promise<void> {
    await this.jobQueue.push(job, opts);
  }
}

/**
 * Validate and process a block
 *
 * The only effects of running this are:
 * - forkChoice update, in the case of a valid block
 * - various events emitted: checkpoint, forkChoice:*, head, block, error:block
 * - (state cache update, from state regeneration)
 *
 * All other effects are provided by downstream event handlers
 */
export async function processBlocks(
  chain: ProcessBlockModules,
  blocks: allForks.SignedBeaconBlock[],
  opts: BlockProcessOpts & ImportBlockOpts
): Promise<void> {
  if (blocks.length === 0) {
    return; // TODO: or throw?
  } else if (blocks.length > 1) {
    assertLinearChainSegment(chain.config, blocks);
  }

  try {
    for (const block of blocks) {
      const fullyVerifiedBlock = await verifyBlock(chain, block, opts);

      // No need to sleep(0) here since `importBlock` includes a disk write
      // TODO: Consider batching importBlock too if it takes significant time
      await importBlock(chain, fullyVerifiedBlock, opts);
    }
  } catch (e) {
    // above functions should only throw BlockError
    const err = getBlockError(e, blocks[0]);

    // TODO: De-duplicate with logic above
    // ChainEvent.errorBlock
    if (!(err instanceof BlockError)) {
      chain.logger.error("Non BlockError received", {}, err);
    } else if (!opts.disableOnBlockError) {
      onBlockError(chain, err);
    }

    throw err;
  }
}

function getBlockError(e: unknown, block: allForks.SignedBeaconBlock): BlockError {
  if (e instanceof BlockError) {
    return e;
  } else if (e instanceof Error) {
    const blockError = new BlockError(block, {code: BlockErrorCode.BEACON_CHAIN_ERROR, error: e as Error});
    blockError.stack = e.stack;
    return blockError;
  } else {
    return new BlockError(block, {code: BlockErrorCode.BEACON_CHAIN_ERROR, error: e as Error});
  }
}

function onBlockError(chain: ProcessBlockModules, err: BlockError): void {
  // err type data may contain CachedBeaconState which is too much to log
  const slimError = new Error();
  slimError.message = err.message;
  slimError.stack = err.stack;
  chain.logger.error("Block error", {slot: err.signedBlock.message.slot, errCode: err.type.code}, slimError);

  if (err.type.code === BlockErrorCode.INVALID_SIGNATURE) {
    const {signedBlock} = err;
    const blockSlot = signedBlock.message.slot;
    const {state} = err.type;
    const forkTypes = chain.config.getForkTypes(blockSlot);
    chain.persistInvalidSszValue(forkTypes.SignedBeaconBlock, signedBlock, `${blockSlot}_invalid_signature`);
    chain.persistInvalidSszView(state, `${state.slot}_invalid_signature`);
  } else if (err.type.code === BlockErrorCode.INVALID_STATE_ROOT) {
    const {signedBlock} = err;
    const blockSlot = signedBlock.message.slot;
    const {preState, postState} = err.type;
    const forkTypes = chain.config.getForkTypes(blockSlot);
    const invalidRoot = toHex(postState.hashTreeRoot());

    const suffix = `slot_${blockSlot}_invalid_state_root_${invalidRoot}`;
    chain.persistInvalidSszValue(forkTypes.SignedBeaconBlock, signedBlock, suffix);
    chain.persistInvalidSszView(preState, `${suffix}_preState`);
    chain.persistInvalidSszView(postState, `${suffix}_postState`);
  }
}
