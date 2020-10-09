import {IChainEvents} from "..";
import {BeaconChain} from "../chain";
import {handleAttestation} from "./attestation";
import {handleBlock} from "./block";
import {handleCheckpoint, handleFinalizedCheckpoint, handleJustifiedCheckpoint} from "./checkpoints";
import {handleErrorAttestation, handleErrorBlock} from "./error";
import {
  handleForkChoiceFinalized,
  handleForkChoiceHead,
  handleForkChoiceJustified,
  handleForkChoiceReorg,
} from "./forkChoice";
import {handleForkDigestChange} from "./forkVersionChange";
import {handleClockSlot} from "./time";

export * from "./checkpoints";
export * from "./forkVersionChange";
export * from "./time";
export * from "./forkChoice";
export * from "./block";
export * from "./attestation";
export * from "./error";

interface IEventMap<Events, Key extends keyof Events = keyof Events, Value extends Events[Key] = Events[Key]>
  extends Map<Key, Value> {
  set<Key extends keyof Events>(key: Key, value: Events[Key]): this;
}

export function getChainEventHandlers(chain: BeaconChain): IEventMap<IChainEvents> {
  const handlers: IEventMap<IChainEvents> = new Map();
  handlers.set("clock:slot", handleClockSlot.bind(chain));
  handlers.set("forkVersion", handleForkDigestChange.bind(chain));
  handlers.set("justified", handleJustifiedCheckpoint.bind(chain));
  handlers.set("finalized", handleFinalizedCheckpoint.bind(chain));
  handlers.set("checkpoint", handleCheckpoint.bind(chain));
  handlers.set("forkChoice:justified", handleForkChoiceJustified.bind(chain));
  handlers.set("forkChoice:finalized", handleForkChoiceFinalized.bind(chain));
  handlers.set("forkChoice:head", handleForkChoiceHead.bind(chain));
  handlers.set("forkChoice:reorg", handleForkChoiceReorg.bind(chain));
  handlers.set("block", handleBlock.bind(chain));
  handlers.set("attestation", handleAttestation.bind(chain));
  handlers.set("error:block", handleErrorBlock.bind(chain));
  handlers.set("error:attestation", handleErrorAttestation.bind(chain));
  return handlers;
}
