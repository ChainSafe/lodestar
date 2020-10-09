import {BeaconChain} from "..";

export async function handleForkDigestChange(this: BeaconChain): Promise<void> {
  this._currentForkDigest = await this.getCurrentForkDigest();
  this.emitter.emit("forkDigest", this._currentForkDigest);
}
