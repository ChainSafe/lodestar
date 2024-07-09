import {MapDef} from "@lodestar/utils";
import {Epoch, RootHex} from "@lodestar/types";
import {BeaconStateAllForks} from "../../src/types.js";
import {EpochShuffling, IShufflingCache, computeEpochShuffling} from "../../src/util/epochShuffling.js";

export class MockShufflingCache implements IShufflingCache {
  private readonly itemsByDecisionRootByEpoch: MapDef<Epoch, Map<RootHex, EpochShuffling>> = new MapDef(
    () => new Map<RootHex, EpochShuffling>()
  );
  async build(
    epoch: number,
    decisionRoot: string,
    state: BeaconStateAllForks,
    activeIndices: number[]
  ): Promise<EpochShuffling> {
    const cachedShuffling = this.getSync(epoch, decisionRoot);
    if (cachedShuffling) {
      return cachedShuffling;
    }
    return new Promise((resolve) => {
      setTimeout(() => {
        const shuffling = computeEpochShuffling(state, activeIndices, epoch);
        this.set(shuffling, decisionRoot);
        resolve(shuffling);
      });
    });
  }

  buildSync(epoch: number, decisionRoot: string, state: BeaconStateAllForks, activeIndices: number[]): EpochShuffling {
    const cachedShuffling = this.getSync(epoch, decisionRoot);
    if (cachedShuffling) {
      return cachedShuffling;
    }
    const shuffling = computeEpochShuffling(state, activeIndices, epoch);
    this.set(shuffling, decisionRoot);
    return shuffling;
  }

  getSync(epoch: number, decisionRoot: string): EpochShuffling | null {
    return this.itemsByDecisionRootByEpoch.getOrDefault(epoch).get(decisionRoot) ?? null;
  }

  set(shuffling: EpochShuffling, decisionRoot: string): void {
    this.itemsByDecisionRootByEpoch.getOrDefault(shuffling.epoch).set(decisionRoot, shuffling);
  }
}
