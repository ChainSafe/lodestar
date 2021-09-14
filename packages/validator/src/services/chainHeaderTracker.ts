import {Api, routes} from "@chainsafe/lodestar-api";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Slot, Root} from "@chainsafe/lodestar-types";
import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {fromHexString} from "@chainsafe/ssz";

const {EventType} = routes.events;

/**
 * Track the head slot/root using the event stream api "head".
 */
export class ChainHeaderTracker {
  private headBlockSlot: Slot = GENESIS_SLOT;
  private headBlockRoot: Root | null = null;

  constructor(private readonly logger: ILogger, private readonly api: Api) {}

  start(signal: AbortSignal): void {
    this.api.events.eventstream([EventType.head], signal, this.onHeadUpdate);
    this.logger.verbose("Subscribed to head event");
  }

  getCurrentChainHead(slot: Slot): Root | null {
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
      this.headBlockRoot = fromHexString(message.block);
      this.logger.verbose("Found new chain head", {slot: message.slot, blockRoot: message.block});
    }
  };
}
