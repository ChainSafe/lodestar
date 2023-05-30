import {phase0} from "@lodestar/types";

export interface StatusCache {
  get(): phase0.Status;
}

export class LocalStatusCache implements StatusCache {
  constructor(private status: phase0.Status) {}

  get(): phase0.Status {
    return this.status;
  }

  update(localStatus: phase0.Status): void {
    this.status = localStatus;
  }
}
