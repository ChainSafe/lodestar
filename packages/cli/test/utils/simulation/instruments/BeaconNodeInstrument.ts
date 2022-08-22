import {BeaconNode} from "@lodestar/beacon-node";
import {RecursivePartial} from "@lodestar/utils";

export class BeaconNodeInstrument {
  beaconNodes: BeaconNode[] = [];

  private _beaconInitOptions: RecursivePartial<Parameters<typeof BeaconNode.init>>;
  private _originalInit?: typeof BeaconNode.init;

  constructor(...beaconInitOptions: RecursivePartial<Parameters<typeof BeaconNode.init>>) {
    this._beaconInitOptions = beaconInitOptions;
  }

  register(): void {
    if (this._originalInit) {
      return;
    }

    this._originalInit = BeaconNode.init.bind(BeaconNode);

    // This is a hack to replace the BeaconNode.init function with our own.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    BeaconNode.init = this._proxyInit.bind(this);
  }

  private async _proxyInit(...options: Parameters<typeof BeaconNode.init>): ReturnType<typeof BeaconNode.init> {
    if (!this._originalInit) {
      throw new Error("BeaconEventInstrument.register() must be called before BeaconNode.init");
    }

    const beaconOptions = {...options[0], ...this._beaconInitOptions};

    const beaconNode = await this._originalInit(beaconOptions);
    this.beaconNodes.push(beaconNode);

    return beaconNode;
  }
}
