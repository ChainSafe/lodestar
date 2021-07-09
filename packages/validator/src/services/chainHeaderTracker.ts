import {Api, routes} from "@chainsafe/lodestar-api";
import {phase0} from "@chainsafe/lodestar-types";
import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {ZERO_HASH} from "../constants";

const {EventType} = routes.events;

/**
 * Track the head slot/root using the event stream api "head".
 */
export class ChainHeaderTracker {
  private headBlockSlot: phase0.Slot;
  private headBlockRoot: phase0.Root;

  constructor(private readonly api: Api) {
    this.headBlockSlot = GENESIS_SLOT;
    this.headBlockRoot = ZERO_HASH;
  }

  start(signal: AbortSignal): void {
    this.api.events.eventstream([EventType.head], signal, this.onHeadUpdate);
  }

  getCurrentChainHead(slot: phase0.Slot): phase0.Root | null {
    if (slot > this.headBlockSlot) {
      return this.headBlockRoot;
    }
    // We don't know head of an old block
    return null;
  }

  private onHeadUpdate = (event: routes.events.BeaconEvent): void => {
    if (event.type === EventType.head) {
      const {message} = event;
      this.headBlockSlot = message.slot;
      this.headBlockRoot = message.block;
    }
  };
}
