import {Epoch, RootHex, ValidatorIndex} from "@lodestar/types";
import {BeaconStateAllForks} from "../../src/types.js";
import {EpochShuffling, IShufflingCache} from "../../src/util/epochShuffling.js";

export class MockShufflingCache implements IShufflingCache {
  private previousShuffling: EpochShuffling | null = null;
  private currentShuffling: EpochShuffling | null = null;
  private nextShuffling: EpochShuffling | null = null;

  constructor(private state: BeaconStateAllForks) {}

  computeNextEpochShuffling(state: BeaconStateAllForks, activeIndices: ValidatorIndex[], epoch: Epoch): void {
    this.previousShuffling = this.currentShuffling;
    this.currentShuffling = this.nextShuffling;
    this.nextShuffling = this.buildSync(state, activeIndices, epoch);
  }

  getSync(shufflingEpoch: Epoch, dependentRoot: RootHex): EpochShuffling | null {
    dependentRoot;
    switch (shufflingEpoch) {
      case this.previousShuffling?.epoch:
        return this.previousShuffling;
      case this.currentShuffling?.epoch:
        return this.currentShuffling;
      case this.nextShuffling?.epoch:
        return this.nextShuffling;
    }
    return null;
  }

  buildSync(state: BeaconStateAllForks, activeIndexes: number[], epoch: Epoch): EpochShuffling {
    // shuffling = computeEpochShuffling(state, activeIndices, epoch);
    state;
    activeIndexes;
    epoch;
    return undefined as unknown as EpochShuffling;
  }

  getOrBuildSync(epoch: Epoch, state: BeaconStateAllForks, activeIndexes: number[]): EpochShuffling {
    return this.getSync(epoch, "") ?? this.buildSync(state, activeIndexes, epoch);
  }
}
