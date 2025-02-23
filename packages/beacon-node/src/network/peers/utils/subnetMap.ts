import {Slot, SubnetID} from "@lodestar/types";

export type RequestedSubnet = {
  subnet: SubnetID;
  /**
   * Slot after which the network will stop maintaining a min number of peers
   * connected to `subnetId`RequestedSubnet
   */
  toSlot: Slot;
};

/**
 * Track requested subnets by `toSlot`
 */
export class SubnetMap {
  /** Map of subnets and the slot until they are needed */
  private subnets = new Map<SubnetID, Slot>();

  get size(): number {
    return this.subnets.size;
  }

  has(subnet: SubnetID): boolean {
    return this.subnets.has(subnet);
  }

  /**
   * Register requested subnets, extends toSlot if same subnet.
   **/
  request(requestedSubnet: RequestedSubnet): void {
    const {subnet, toSlot} = requestedSubnet;
    this.subnets.set(subnet, Math.max(this.subnets.get(subnet) ?? 0, toSlot));
  }

  /**
   * Get last active slot of a subnet.
   */
  getToSlot(subnet: SubnetID): Slot | undefined {
    return this.subnets.get(subnet);
  }

  isActiveAtSlot(subnet: SubnetID, slot: Slot): boolean {
    const toSlot = this.subnets.get(subnet);
    return toSlot !== undefined && toSlot >= slot; // ACTIVE: >=
  }

  /** Return subnetIds with a `toSlot` equal greater than `currentSlot` */
  getActive(currentSlot: Slot): SubnetID[] {
    const subnetIds: SubnetID[] = [];
    for (const [subnet, toSlot] of this.subnets.entries()) {
      if (toSlot >= currentSlot) {
        subnetIds.push(subnet);
      }
    }
    return subnetIds;
  }

  /** Return subnetIds with a `toSlot` equal greater than `currentSlot` */
  getActiveTtl(currentSlot: Slot): RequestedSubnet[] {
    const subnets: RequestedSubnet[] = [];
    for (const [subnet, toSlot] of this.subnets.entries()) {
      if (toSlot >= currentSlot) {
        subnets.push({subnet, toSlot});
      }
    }
    return subnets;
  }

  /** Return subnetIds with a `toSlot` less than `currentSlot`. Also deletes expired entries */
  getExpired(currentSlot: Slot): SubnetID[] {
    const subnetIds: SubnetID[] = [];
    for (const [subnet, toSlot] of this.subnets.entries()) {
      if (toSlot < currentSlot) {
        subnetIds.push(subnet);
        this.subnets.delete(subnet);
      }
    }
    return subnetIds;
  }

  getAll(): SubnetID[] {
    return Array.from(this.subnets.keys());
  }

  delete(subnet: SubnetID): void {
    this.subnets.delete(subnet);
  }
}
