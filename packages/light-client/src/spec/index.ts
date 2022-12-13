import {IBeaconConfig} from "@lodestar/config";
import {altair, Root, Slot} from "@lodestar/types";
import {LightClientStore} from "../types.js";
import {initializeLightClientStore} from "./initializeLightClientStore.js";
import {processLightClientFinalityUpdate} from "./processLightClientFinalityUpdate.js";
import {processLightClientOptimisticUpdate} from "./processLightClientOptimisticUpdate.js";
import {processLightClientStoreForceUpdate} from "./processLightClientStoreForceUpdate.js";
import {processLightClientUpdate} from "./processLightClientUpdate.js";

export {isBetterUpdate, toLightClientUpdateSummary, LightClientUpdateSummary} from "./isBetterUpdate.js";

export class LightclientSpec {
  readonly store: LightClientStore;

  // TODO: Connect to clock
  currentSlot: Slot = 0;

  constructor(private readonly config: IBeaconConfig, bootstrap: altair.LightClientBootstrap, trustedBlockRoot: Root) {
    this.store = initializeLightClientStore(trustedBlockRoot, bootstrap);
  }

  onUpdate(update: altair.LightClientUpdate): void {
    processLightClientUpdate(this.config, this.store, update, this.currentSlot);
  }

  onFinalityUpdate(update: altair.LightClientFinalityUpdate): void {
    processLightClientFinalityUpdate(this.config, this.store, update, this.currentSlot);
  }

  onOptimisticUpdate(update: altair.LightClientOptimisticUpdate): void {
    processLightClientOptimisticUpdate(this.config, this.store, update, this.currentSlot);
  }

  forceUpdate(): void {
    processLightClientStoreForceUpdate(this.store, this.currentSlot);
  }
}
