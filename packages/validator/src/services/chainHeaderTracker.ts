import {Api, routes} from "@chainsafe/lodestar-api";
import {ILogger} from "@chainsafe/lodestar-utils";
import {phase0} from "@chainsafe/lodestar-types";
import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {toHexString} from "@chainsafe/ssz";

const {EventType} = routes.events;

/**
 * Track the head slot/root using the event stream api "head".
 */
export class ChainHeaderTracker {
  private headBlockSlot: phase0.Slot;
  private headBlockRoot: phase0.Root | null;

  constructor(private readonly logger: ILogger, private readonly api: Api) {
    this.headBlockSlot = GENESIS_SLOT;
    this.headBlockRoot = null;
  }

  start(signal: AbortSignal): void {
    this.api.events.eventstream([EventType.head], signal, this.onHeadUpdate);
    this.logger.verbose("Subscribed to head event");
  }

  getCurrentChainHead(slot: phase0.Slot): phase0.Root | null {
    if (slot >= this.headBlockSlot) {
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
      this.logger.verbose("Found new chain head", {
        slot: this.headBlockSlot,
        blockRoot: toHexString(this.headBlockRoot),
      });
    }
  };
}
