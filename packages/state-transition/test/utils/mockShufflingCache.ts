import {MapDef} from "@lodestar/utils";
import {Epoch, RootHex} from "@lodestar/types";
import {BeaconStateAllForks} from "../../src/types.js";
import {EpochShuffling, IShufflingCache, computeEpochShuffling} from "../../src/util/epochShuffling.js";

export class MockShufflingCache implements IShufflingCache {
  private readonly itemsByDecisionRootByEpoch: MapDef<Epoch, Map<RootHex, EpochShuffling>> = new MapDef(
    () => new Map<RootHex, EpochShuffling>()
  );
  build(epoch: number, decisionRoot: string, state: BeaconStateAllForks, activeIndices: number[]): void {
    const shuffling = computeEpochShuffling(state, activeIndices, epoch);
    this.set(shuffling, decisionRoot);
  }

  getOrBuildSync(
    epoch: number,
    decisionRoot: string,
    state: BeaconStateAllForks,
    activeIndices: number[]
  ): EpochShuffling {
    const shuffling = this.getSync(epoch, decisionRoot);
    if (!shuffling) {
      this.build(epoch, decisionRoot, state, activeIndices);
    }
    return this.getSync(epoch, decisionRoot) as EpochShuffling;
  }

  getSync(epoch: number, decisionRoot: string): EpochShuffling | null {
    return this.itemsByDecisionRootByEpoch.getOrDefault(epoch).get(decisionRoot) ?? null;
  }

  set(shuffling: EpochShuffling, decisionRoot: string): void {
    this.itemsByDecisionRootByEpoch.getOrDefault(shuffling.epoch).set(decisionRoot, shuffling);
  }
}
