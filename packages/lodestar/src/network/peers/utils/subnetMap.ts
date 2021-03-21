import {Slot} from "@chainsafe/lodestar-types";

export type RequestedSubnet = {
  subnetId: number;
  /**
   * Slot after which the network will stop maintaining a min number of peers
   * connected to `subnetId`
   */
  toSlot: Slot;
};

/**
 * Track requested subnets by `toSlot`
 */
export class SubnetMap {
  /** Map of subnets and the slot until they are needed */
  private subnets = new Map<number, Slot>();

  /** Register requested subnets */
  request(requestedSubnets: RequestedSubnet[]): void {
    for (const {subnetId, toSlot} of requestedSubnets) {
      this.subnets.set(subnetId, toSlot);
    }
  }

  /** Return subnetIds with a `toSlot` equal greater than `currentSlot` */
  getActive(currentSlot: Slot): number[] {
    const activeSubnetIds: number[] = [];

    for (const [subnetId, toSlot] of this.subnets.entries()) {
      if (toSlot >= currentSlot) {
        activeSubnetIds.push(subnetId);
      } else {
        // Prune expired subnets
        this.subnets.delete(subnetId);
      }
    }

    return activeSubnetIds;
  }
}
