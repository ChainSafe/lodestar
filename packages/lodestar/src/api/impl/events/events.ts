import {IEventsApi} from "./interfaces";
import {ApiNamespace, IApiModules} from "../interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain} from "../../../chain";
import {IApiOptions} from "../../options";
import {LodestarEventIterator} from "../../../util/events";
import {BeaconEvent} from "./types";
import {
  handleBeaconAttestationEvent,
  handleBeaconBlockEvent,
  handleBeaconHeadEvent,
  handleChainReorgEvent,
  handleFinalizedCheckpointEvent, handleVoluntaryExitEvent,
} from "./handlers";

export class EventsApi implements IEventsApi {
  public namespace: ApiNamespace;

  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config" | "chain">) {
    this.namespace = ApiNamespace.EVENTS;
    this.config = modules.config;
    this.chain = modules.chain;
  }

  public getEventStream(): LodestarEventIterator<BeaconEvent> {
    return new LodestarEventIterator<BeaconEvent>(({push}) => {
      const beaconHeadHandler = handleBeaconHeadEvent(this.config, push);
      const beaconBlockHandler = handleBeaconBlockEvent(this.config, push);
      const beaconAttestationHandler = handleBeaconAttestationEvent(this.config, push);
      const voluntaryExitHandler = handleVoluntaryExitEvent(this.config, push);
      const finalizedCheckpointHandler = handleFinalizedCheckpointEvent(this.config, push);
      const chainReorgHandler = handleChainReorgEvent(this.config, push);
      this.chain.emitter.on("forkChoice:head", beaconHeadHandler);
      this.chain.emitter.on("block", beaconBlockHandler);
      this.chain.emitter.on("attestation", beaconAttestationHandler);
      this.chain.emitter.on("voluntaryExit", voluntaryExitHandler);
      this.chain.emitter.on("forkChoice:finalized", finalizedCheckpointHandler);
      this.chain.emitter.on("forkChoice:reorg", chainReorgHandler);
      return () => {
        this.chain.emitter.off("forkChoice:head", beaconHeadHandler);
        this.chain.emitter.off("block", beaconBlockHandler);
        this.chain.emitter.off("attestation", beaconAttestationHandler);
        this.chain.emitter.off("voluntaryExit", voluntaryExitHandler);
        this.chain.emitter.off("forkChoice:finalized", finalizedCheckpointHandler);
        this.chain.emitter.off("forkChoice:reorg", chainReorgHandler);
      };
    });
  }
}
