import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/logger";
import {IBeaconDb} from "../../../db/index.ts";
import {IStateDiffCodec} from "../interface.ts";
import {replayBlocks} from "../utils/replayBlocks.ts";
import {StateRegenArtifacts} from "./fetch.ts";
import {DifferentialStateRegenMetrics} from "./metrics.ts";
import {StateRegenPlan} from "./plan.ts";
import {BeaconStateSnapshot} from "./ssz.ts";
import {replayStateDifferentials} from "./stateDifferential.ts";
import {beaconStateBytesToSnapshot, snapshotToBeaconStateBytes} from "./stateSnapshot.ts";

export type StateRegenContext = {
  codec: IStateDiffCodec;
  config: BeaconConfig;
  logger?: Logger;
  pubkey2index: PubkeyIndexMap;
  db: IBeaconDb;
  metrics?: DifferentialStateRegenMetrics | null;
};

export async function applyStateRegenPlan(
  ctx: StateRegenContext,
  plan: StateRegenPlan,
  artifacts: StateRegenArtifacts
): Promise<BeaconStateSnapshot> {
  // When we start a node from a certain checkpoint which is usually
  // not the snapshot epoch but we fetch it because of the fallback settings
  if (plan.snapshotSlot !== artifacts.snapshot.slot) {
    ctx.logger?.warn("Expected snapshot not found", {
      expectedSnapshotSlot: plan.snapshotSlot,
      availableSnapshotSlot: artifacts.snapshot.slot,
    });
  }

  // TODO: Need to do further thinking if we fail here with fatal error
  if (artifacts.missingDiffs.length) {
    ctx.logger?.warn("Missing some diff states", {
      snapshotSlot: plan.snapshotSlot,
      diffPath: plan.diffSlots.join(","),
      missingDiffs: artifacts.missingDiffs.join(","),
    });
  }
  if (artifacts.diffs.length + artifacts.missingDiffs.length !== plan.diffSlots.length) {
    throw new Error(`Can not find required state diffs ${plan.diffSlots.join(",")}`);
  }

  if (plan.blockReplay && artifacts.diffs.at(-1)?.slot !== plan.blockReplay.fromSlot - 1) {
    throw new Error(`Can not replay blocks due to missing state diffs ${artifacts.missingDiffs.join(",")}`);
  }

  ctx.logger?.verbose("Replaying state diffs", {
    snapshotSlot: plan.snapshotSlot,
    diffPath: plan.diffSlots.join(","),
    availableDiffs: artifacts.diffs.map((d) => d.slot).join(","),
  });

  const stateWithDiffApplied = await replayStateDifferentials(
    {codec: ctx.codec, logger: ctx.logger},
    {stateDifferentials: artifacts.diffs, stateSnapshot: artifacts.snapshot}
  );

  if (stateWithDiffApplied.stateBytes.byteLength === 0 || stateWithDiffApplied.balancesBytes.byteLength === 0) {
    throw new Error(
      `Invalid state after applying diffs: 
      stateBytesSize=${stateWithDiffApplied.stateBytes.byteLength},
      balancesBytesSize=${stateWithDiffApplied.balancesBytes.byteLength}`
    );
  }

  if (!plan.blockReplay) return stateWithDiffApplied;

  const stateBytes = snapshotToBeaconStateBytes({config: ctx.config}, stateWithDiffApplied);

  ctx.logger?.verbose("Replaying blocks", {
    fromSlot: plan.blockReplay.fromSlot,
    tillSlot: plan.blockReplay.tillSlot,
  });

  const blockReplayTimer = ctx.metrics?.blockReplayTime.startTimer();
  const replayed = await replayBlocks(ctx, {
    stateBytes,
    fromSlot: plan.blockReplay.fromSlot,
    toSlot: plan.blockReplay.tillSlot,
  });
  blockReplayTimer?.();
  ctx.metrics?.blockReplayCount.observe(plan.blockReplay.tillSlot - plan.blockReplay.fromSlot);

  return beaconStateBytesToSnapshot({config: ctx.config}, plan.blockReplay.tillSlot, replayed);
}
