import {ApiClient} from "@lodestar/api";
import {ChainForkConfig, NotEqualParamsError, assertEqualParams} from "@lodestar/config";
import {isForkPostGloas} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex, Slot} from "@lodestar/types";
import {Logger, isErrorAborted, toRootHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {ProposerPreferencesTracker} from "./proposerPreferencesTracker.js";

/** Additional sources are capped to keep the per-slot refresh fan-out small */
export const MAX_ADDITIONAL_PROPOSER_PREFERENCES_SOURCES = 3;

/** Distinct dependent roots a refresh may retain per proposal slot, legitimately one or two */
const MAX_DEPENDENT_ROOTS_PER_SLOT = 4;

export type ProposerPreferencesSource = {
  /** Printable identifier used in logs and metrics, must not contain credentials */
  id: string;
  api: ApiClient;
};

export type ProposerPreferencesRecoveryModules = {
  config: ChainForkConfig;
  logger: Logger;
  tracker: ProposerPreferencesTracker;
  metrics: Metrics | null;
  signal: AbortSignal;
};

export type ProposerPreferencesRecoveryOptions = {
  /** Trusted beacon node that serves all other builder data, verified by the caller */
  primary: ProposerPreferencesSource;
  /** Trusted only once their genesis and config match the primary */
  additional: ProposerPreferencesSource[];
  genesisValidatorsRoot: RootHex;
  genesisTime: number;
  /** Deadline per request in milliseconds */
  timeoutMs: number;
};

type SourceState = {
  source: ProposerPreferencesSource;
  verified: boolean;
  failing: boolean;
};

class WrongNetworkError extends Error {}

/**
 * Proposer preferences are only gossiped once. A beacon node that misses the gossip never emits the
 * SSE event, so the pools of the primary and additional trusted beacon nodes are polled to fill gaps.
 */
export class ProposerPreferencesRecovery {
  private readonly sources: SourceState[];
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly modules: ProposerPreferencesRecoveryModules,
    private readonly opts: ProposerPreferencesRecoveryOptions
  ) {
    if (opts.additional.length > MAX_ADDITIONAL_PROPOSER_PREFERENCES_SOURCES) {
      throw Error(`At most ${MAX_ADDITIONAL_PROPOSER_PREFERENCES_SOURCES} additional proposer preferences sources`);
    }
    this.sources = [
      {source: opts.primary, verified: true, failing: false},
      ...opts.additional.map((source) => ({source, verified: false, failing: false})),
    ];
  }

  getSourceIds(): string[] {
    return this.sources.map(({source}) => source.id);
  }

  /** Polls all sources once, a call while a refresh is in progress joins it */
  refresh(currentSlot: Slot): Promise<void> {
    if (this.inflight !== null) {
      return this.inflight;
    }
    const nextEpochStart = computeStartSlotAtEpoch(computeEpochAtSlot(currentSlot) + 1);
    if (this.modules.signal.aborted || !isForkPostGloas(this.modules.config.getForkName(nextEpochStart))) {
      return Promise.resolve();
    }
    this.inflight = this.refreshAll(currentSlot).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refreshAll(currentSlot: Slot): Promise<void> {
    const maxSlotExclusive = computeStartSlotAtEpoch(computeEpochAtSlot(currentSlot) + 2);
    await Promise.all(this.sources.map((state) => this.refreshSource(state, currentSlot, maxSlotExclusive)));
  }

  private async refreshSource(state: SourceState, currentSlot: Slot, maxSlotExclusive: Slot): Promise<void> {
    const {logger, metrics, signal, tracker} = this.modules;
    const {id, api} = state.source;
    const init = {signal, timeoutMs: this.opts.timeoutMs};

    try {
      if (!state.verified) {
        await this.verify(state.source, init);
        signal.throwIfAborted();
        state.verified = true;
        logger.info("Verified proposer preferences source", {source: id});
      }
      const preferences = (await api.beacon.getProposerPreferences(undefined, init)).value();
      if (signal.aborted) {
        return;
      }

      let added = 0;
      let ignored = 0;
      for (const signed of preferences) {
        const slot = signed.message.proposalSlot;
        if (slot < currentSlot || slot >= maxSlotExclusive || tracker.count(slot) >= MAX_DEPENDENT_ROOTS_PER_SLOT) {
          ignored++;
          continue;
        }
        if (tracker.onProposerPreferences(signed)) {
          added++;
          logger.debug("Recovered proposer preferences", {
            source: id,
            slot,
            dependentRoot: toRootHex(signed.message.dependentRoot),
          });
        }
      }

      if (state.failing) {
        state.failing = false;
        logger.info("Proposer preferences source is available again", {source: id});
      }
      metrics?.proposerPreferences.recovered.inc({source: id}, added);
      const logCtx = {source: id, count: preferences.length, added, ignored};
      if (added > 0) {
        logger.info("Recovered proposer preferences", logCtx);
      } else {
        logger.verbose("No proposer preferences to recover", logCtx);
      }
    } catch (e) {
      if (signal.aborted || isErrorAborted(e)) {
        return;
      }
      if (e instanceof WrongNetworkError || e instanceof NotEqualParamsError) {
        this.sources.splice(this.sources.indexOf(state), 1);
        logger.error("Excluded proposer preferences source on a different network", {source: id}, e);
        return;
      }
      metrics?.proposerPreferences.fetchErrors.inc({source: id});
      if (state.failing) {
        logger.debug("Unable to fetch proposer preferences", {source: id}, e as Error);
      } else {
        state.failing = true;
        logger.warn("Unable to fetch proposer preferences", {source: id}, e as Error);
      }
    }
  }

  private async verify(source: ProposerPreferencesSource, init: {signal: AbortSignal; timeoutMs: number}) {
    const genesis = (await source.api.beacon.getGenesis(init)).value();
    init.signal.throwIfAborted();
    const genesisValidatorsRoot = toRootHex(genesis.genesisValidatorsRoot);
    const genesisTime = Number(genesis.genesisTime);
    if (genesisValidatorsRoot !== this.opts.genesisValidatorsRoot || genesisTime !== this.opts.genesisTime) {
      throw new WrongNetworkError(
        `Genesis mismatch genesisValidatorsRoot=${genesisValidatorsRoot} genesisTime=${genesisTime}`
      );
    }
    assertEqualParams(this.modules.config, (await source.api.config.getSpec(init)).value());
    init.signal.throwIfAborted();
  }
}
