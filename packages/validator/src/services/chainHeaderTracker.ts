import {Api, routes} from "@chainsafe/lodestar-api";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Slot, Root} from "@chainsafe/lodestar-types";
import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {fromHexString} from "@chainsafe/ssz";

const {EventType} = routes.events;

export type SlotRoot = {slot: Slot; root: Root};

type RunEveryFn = (slotRoot: SlotRoot) => Promise<void>;

/**
 * Track the head slot/root using the event stream api "head".
 */
export class ChainHeaderTracker {
  private headBlockSlot: Slot = GENESIS_SLOT;
  private headBlockRoot: Root | null = null;
  private readonly fns: RunEveryFn[] = [];

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

  runOnNewHead(fn: RunEveryFn): void {
    this.fns.push(fn);
  }

  private onHeadUpdate = (event: routes.events.BeaconEvent): void => {
    if (event.type === EventType.head) {
      const {message} = event;
      this.headBlockSlot = message.slot;
      this.headBlockRoot = fromHexString(message.block);
      for (const fn of this.fns) {
        void fn({slot: this.headBlockSlot, root: this.headBlockRoot});
      }
      this.logger.verbose("Found new chain head", {slot: message.slot, blockRoot: message.block});
    }
  };
}
