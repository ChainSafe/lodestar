import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ExecutionStatus, PayloadStatus, ProtoBlock, isGloasBlock} from "@lodestar/fork-choice";
import {ForkName, MIN_DEPOSIT_AMOUNT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  IBeaconStateView,
  IBeaconStateViewGloas,
  computeEpochAtSlot,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {RootHex, SSEPayloadAttributes, Slot, getBuilderStatus, gloas} from "@lodestar/types";
import {Logger, fromHex, isErrorAborted, sleep, toRootHex} from "@lodestar/utils";
import {getShufflingDependentRoot} from "../util/dependentRoot.js";
import {IBeaconChain} from "./interface.js";
import {getPayloadAttributesForSSE} from "./produceBlock/produceBlockBody.js";

const MAX_ALTERNATE_ATTEMPTS_PER_SLOT = 4;

type AlternateTrigger = {
  clockSlot: Slot;
  headRoot: RootHex;
  primaryParent: ProtoBlock;
  primary: SSEPayloadAttributes;
  preparedState: IBeaconStateView;
};
type AlternateBlock = ProtoBlock & {executionPayloadBlockHash: RootHex};

export class PayloadAttributesAlternates {
  private pending: AlternateTrigger | null = null;
  private running = false;
  private prepareSlot: Slot = -1;
  private primaryKey = "";
  private readonly attempted = new Set<string>();
  private readonly builderIndices: number[];

  constructor(
    private readonly chain: IBeaconChain,
    private readonly config: ChainForkConfig,
    private readonly logger: Logger,
    private readonly signal: AbortSignal
  ) {
    const indices = chain.opts.payloadAttributesAlternateBuilderIndices ?? [];
    if (
      indices.length > routes.events.MAX_PAYLOAD_ATTRIBUTES_ALTERNATE_BUILDERS ||
      indices.some((index) => !Number.isSafeInteger(index) || index < 0) ||
      new Set(indices).size !== indices.length
    ) {
      throw Error("INVALID_PAYLOAD_ATTRIBUTES_ALTERNATE_BUILDER_INDICES");
    }
    this.builderIndices = indices.slice();
    signal.addEventListener(
      "abort",
      () => {
        this.pending = null;
      },
      {once: true}
    );
  }

  request(trigger: AlternateTrigger): void {
    if (!this.canEmit(trigger) || trigger.primary.proposalSlot < this.prepareSlot) return;
    if (trigger.primary.proposalSlot > this.prepareSlot) {
      this.prepareSlot = trigger.primary.proposalSlot;
      this.attempted.clear();
    }
    this.primaryKey = this.key(trigger.primaryParent.blockRoot, toRootHex(trigger.primary.parentBlockHash));
    this.pending = trigger;
    if (!this.running) {
      this.running = true;
      void this.run();
    }
  }

  private canEmit(trigger: AlternateTrigger): boolean {
    return (
      !this.signal.aborted &&
      this.chain.opts.emitPayloadAttributes === true &&
      this.chain.opts.emitPayloadAttributesAlternates === true &&
      this.chain.opts.fastConfirmation !== true &&
      this.builderIndices.length > 0 &&
      this.chain.clock.currentSlot === trigger.clockSlot &&
      trigger.primary.proposalSlot === trigger.clockSlot + 1 &&
      this.config.getForkName(trigger.primary.proposalSlot) === ForkName.gloas &&
      this.chain.forkChoice.getHead().blockRoot === trigger.headRoot &&
      this.chain.emitter.listenerCount(routes.events.EventType.payloadAttributes) > 0
    );
  }

  private isCurrent(trigger: AlternateTrigger): boolean {
    return (
      this.canEmit(trigger) &&
      this.prepareSlot === trigger.primary.proposalSlot &&
      this.primaryKey === this.key(trigger.primaryParent.blockRoot, toRootHex(trigger.primary.parentBlockHash))
    );
  }

  private key(root: RootHex, hash: RootHex): string {
    return `${root}:${hash}`;
  }

  private async run(): Promise<void> {
    try {
      while (this.pending !== null && !this.signal.aborted) {
        await sleep(0, this.signal);
        const trigger = this.pending;
        this.pending = null;
        if (trigger === null || !this.isCurrent(trigger)) continue;
        try {
          await this.emit(trigger);
        } catch (error) {
          if (!isErrorAborted(error)) {
            this.logger.debug(
              "Skipping alternate payload attributes",
              {
                code: "ALTERNATE_PAYLOAD_ATTRIBUTES_UNAVAILABLE",
                prepareSlot: trigger.primary.proposalSlot,
              },
              error as Error
            );
          }
        }
      }
    } catch (error) {
      if (!isErrorAborted(error))
        this.logger.debug(
          "Alternate payload attributes stopped",
          {code: "ALTERNATE_PAYLOAD_ATTRIBUTES_STOPPED"},
          error as Error
        );
    } finally {
      this.running = false;
    }
  }

  private prepareState(trigger: AlternateTrigger, block: ProtoBlock): IBeaconStateView | null {
    const slot = trigger.primary.proposalSlot;
    if (slot <= block.slot || slot - block.slot > SLOTS_PER_EPOCH) return null;
    if (block.blockRoot === trigger.primaryParent.blockRoot) return trigger.preparedState;
    const epoch = computeEpochAtSlot(slot);
    const state =
      computeEpochAtSlot(block.slot) === epoch
        ? this.chain.regen.getStateSync(block.stateRoot)
        : this.chain.regen.getCheckpointStateSync({epoch, rootHex: block.blockRoot});
    if (state === null || state.slot > slot || computeEpochAtSlot(state.slot) !== epoch) return null;
    return state.slot === slot ? state : state.processSlots(slot, {dontTransferCache: true});
  }

  private async emit(trigger: AlternateTrigger): Promise<void> {
    const slot = trigger.primary.proposalSlot;
    const fork = this.config.getForkName(slot);
    if (fork !== ForkName.gloas) return;
    const epoch = computeEpochAtSlot(slot);
    const head = this.chain.forkChoice.getHead();
    const dependentRoot = getShufflingDependentRoot(
      this.chain.forkChoice,
      epoch,
      computeEpochAtSlot(trigger.primaryParent.slot),
      trigger.primaryParent
    );
    for (const root of new Set([head.blockRoot, head.parentRoot])) {
      const variants = [PayloadStatus.EMPTY, PayloadStatus.FULL]
        .map((status) => this.chain.forkChoice.getBlockHex(root, status))
        .filter(
          (block): block is AlternateBlock =>
            block !== null &&
            isGloasBlock(block) &&
            block.executionStatus !== ExecutionStatus.Invalid &&
            block.payloadStatus !== PayloadStatus.PENDING &&
            block.executionPayloadBlockHash !== null
        );
      const candidates = variants.filter((block) => {
        const key = this.key(root, block.executionPayloadBlockHash);
        return key !== this.primaryKey && !this.attempted.has(key);
      });
      if (candidates.length === 0 || !this.isCurrent(trigger)) continue;
      const remaining = MAX_ALTERNATE_ATTEMPTS_PER_SLOT - this.attempted.size;
      if (remaining <= 0) return;
      const bounded = candidates.slice(0, remaining);
      const branch = bounded[0];
      // Charge state preparation before doing it; untouched variants remain eligible after a stale trigger.
      this.attempted.add(this.key(root, branch.executionPayloadBlockHash));
      if (
        getShufflingDependentRoot(this.chain.forkChoice, epoch, computeEpochAtSlot(branch.slot), branch) !==
        dependentRoot
      )
        continue;
      const state = this.prepareState(trigger, branch);
      if (
        state === null ||
        !isStatePostGloas(state) ||
        state.slot !== slot ||
        toRootHex(state.getBlockRootAtSlot(slot - 1)) !== branch.blockRoot ||
        state.getBeaconProposer(slot) !== trigger.primary.proposerIndex
      )
        continue;
      for (const block of bounded) {
        await sleep(0, this.signal);
        if (!this.isCurrent(trigger)) return;
        this.attempted.add(this.key(root, block.executionPayloadBlockHash));
        try {
          if (block.stateRoot !== branch.stateRoot || block.slot !== branch.slot) continue;
          const full = block.payloadStatus === PayloadStatus.FULL;
          const hash = full
            ? state.latestExecutionPayloadBid.blockHash
            : state.latestExecutionPayloadBid.parentBlockHash;
          if (toRootHex(hash) !== block.executionPayloadBlockHash) continue;
          const requests = full ? await this.chain.getParentExecutionRequests(block.slot, root) : null;
          if (!this.isCurrent(trigger)) return;
          if (full && requests === null) continue;
          const currentVariant = this.chain.forkChoice.getBlockHex(root, block.payloadStatus);
          if (
            currentVariant?.executionPayloadBlockHash !== block.executionPayloadBlockHash ||
            currentVariant.executionStatus === ExecutionStatus.Invalid
          )
            continue;
          const prepared = requests === null ? state : state.withParentPayloadApplied(requests);
          const data = getPayloadAttributesForSSE(fork, this.chain, {
            prepareState: prepared,
            prepareSlot: slot,
            parentBlockRoot: fromHex(root),
            parentBlockHash: hash,
            safeBlockHash: toRootHex((trigger.primary as gloas.SSEPayloadAttributes).safeBlockHash),
            finalizedBlockHash: toRootHex((trigger.primary as gloas.SSEPayloadAttributes).finalizedBlockHash),
            feeRecipient: trigger.primary.payloadAttributes.suggestedFeeRecipient,
          }) as gloas.SSEPayloadAttributes;
          if (data.proposerIndex !== trigger.primary.proposerIndex) continue;
          this.chain.emitter.emit(routes.events.EventType.payloadAttributes, {
            version: fork,
            data,
            context: {
              role: "alternate",
              dependentRoot: fromHex(dependentRoot),
              builders: this.getBuilders(prepared),
            },
          });
        } catch (error) {
          if (!isErrorAborted(error))
            this.logger.debug(
              "Skipping alternate payload context",
              {
                code: "ALTERNATE_PAYLOAD_CONTEXT_UNAVAILABLE",
                prepareSlot: slot,
                parentBlockRoot: root,
                payloadStatus: block.payloadStatus,
              },
              error as Error
            );
        }
      }
    }
  }

  private getBuilders(state: IBeaconStateViewGloas): routes.events.AlternateBuilder[] {
    const pending = new Map(this.builderIndices.map((index) => [index, 0]));
    const addPending = ({builderIndex, amount}: gloas.BuilderPendingWithdrawal): void => {
      const prior = pending.get(builderIndex);
      if (prior === undefined) return;
      const total = prior + amount;
      if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(total)) {
        pending.set(builderIndex, Number.NaN);
      } else {
        pending.set(builderIndex, total);
      }
    };
    for (const withdrawal of state.builderPendingWithdrawals) addPending(withdrawal);
    for (const payment of state.builderPendingPayments) addPending(payment.withdrawal);
    const builders: routes.events.AlternateBuilder[] = [];
    for (const index of this.builderIndices) {
      if (index >= state.getBuildersLength()) continue;
      const builder = state.getBuilder(index);
      const liability = pending.get(index) ?? Number.NaN;
      const reserve = MIN_DEPOSIT_AMOUNT + liability;
      if (
        !Number.isSafeInteger(builder.balance) ||
        builder.balance < 0 ||
        !Number.isSafeInteger(reserve) ||
        !Number.isSafeInteger(builder.version) ||
        builder.version < 0 ||
        builder.version > 255
      )
        continue;
      builders.push({
        index,
        pubkey: builder.pubkey,
        version: builder.version,
        active: getBuilderStatus(builder, state.finalizedCheckpoint.epoch) === "active",
        availableGwei: Math.max(0, builder.balance - reserve),
      });
    }
    return builders;
  }
}
