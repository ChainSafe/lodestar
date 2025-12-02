import {Status} from "@lodestar/types";

export interface StatusCache {
  get(): Status;
}

export class LocalStatusCache implements StatusCache {
  constructor(private status: Status) {}

  get(): Status {
    return this.status;
  }

  update(localStatus: Status): void {
    this.status = localStatus;
  }
}
