import deepmerge from "deepmerge";
import {defaultOptions, IBeaconNodeOptions} from "@lodestar/light-client-p2p";
import {isPlainObject, RecursivePartial} from "@lodestar/utils";

export class BeaconNodeLightOptions {
  /**
   * Convenience class to deep merge nested options
   */
  constructor(private beaconNodeOptions: RecursivePartial<IBeaconNodeOptions>) {}

  /**
   * Returns current options
   */
  get(): RecursivePartial<IBeaconNodeOptions> {
    return this.beaconNodeOptions;
  }

  /**
   * Returns merged current options with defaultOptions
   */
  getWithDefaults(): IBeaconNodeOptions {
    return mergeBeaconNodeLightOptionsWithDefaults(defaultOptions, this.beaconNodeOptions);
  }

  set(beaconNodeOptionsPartial: RecursivePartial<IBeaconNodeOptions>): void {
    this.beaconNodeOptions = mergeBeaconNodeLightOptions(this.beaconNodeOptions, beaconNodeOptionsPartial);
  }
}

/**
 * Typesafe wrapper to merge partial IBeaconNodeOptions objects
 */
export function mergeBeaconNodeLightOptions(
  ...partialOptionsArr: RecursivePartial<IBeaconNodeOptions>[]
): RecursivePartial<IBeaconNodeOptions> {
  return partialOptionsArr.reduce((mergedBeaconOptions, options) => {
    // IBeaconNodeOptions contains instances so a deepmerge can only be done safely with `isMergeableObject: isPlainObject`
    return deepmerge(mergedBeaconOptions, options, {
      arrayMerge: overwriteTargetArrayIfItems,
      isMergeableObject: isPlainObject,
    });
  }, partialOptionsArr[0]);
}

/**
 * Typesafe wrapper to merge IBeaconNodeOptions objects
 */
export function mergeBeaconNodeLightOptionsWithDefaults(
  defaultOptions: IBeaconNodeOptions,
  ...partialOptionsArr: RecursivePartial<IBeaconNodeOptions>[]
): IBeaconNodeOptions {
  return mergeBeaconNodeLightOptions(defaultOptions, ...partialOptionsArr) as IBeaconNodeOptions;
}

/**
 * If override array option (source) is defined and has items
 * replace target (original option).
 * Example: network.localMultiaddrs has default ['/ip4/127.0.0.1/tcp/30606'] and we don't wanna append to that with cli flag
 * as it could result in port taken
 * @param target
 * @param source
 */
function overwriteTargetArrayIfItems(target: unknown[], source: unknown[]): unknown[] {
  if (source.length === 0) {
    return target;
  }
  return source;
}
