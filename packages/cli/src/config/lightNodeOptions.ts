import deepmerge from "deepmerge";
import {defaultOptions, ILightNodeOptions} from "@lodestar/light-client-p2p";
import {isPlainObject, RecursivePartial} from "@lodestar/utils";

export class LightNodeOptions {
  /**
   * Convenience class to deep merge nested options
   */
  constructor(private beaconNodeOptions: RecursivePartial<ILightNodeOptions>) {}

  /**
   * Returns current options
   */
  get(): RecursivePartial<ILightNodeOptions> {
    return this.beaconNodeOptions;
  }

  /**
   * Returns merged current options with defaultOptions
   */
  getWithDefaults(): ILightNodeOptions {
    return mergeBeaconNodeLightOptionsWithDefaults(defaultOptions, this.beaconNodeOptions);
  }

  set(beaconNodeOptionsPartial: RecursivePartial<ILightNodeOptions>): void {
    this.beaconNodeOptions = mergeBeaconNodeLightOptions(this.beaconNodeOptions, beaconNodeOptionsPartial);
  }
}

/**
 * Typesafe wrapper to merge partial ILightNodeOptions objects
 */
export function mergeBeaconNodeLightOptions(
  ...partialOptionsArr: RecursivePartial<ILightNodeOptions>[]
): RecursivePartial<ILightNodeOptions> {
  return partialOptionsArr.reduce((mergedBeaconOptions, options) => {
    // ILightNodeOptions contains instances so a deepmerge can only be done safely with `isMergeableObject: isPlainObject`
    return deepmerge(mergedBeaconOptions, options, {
      arrayMerge: overwriteTargetArrayIfItems,
      isMergeableObject: isPlainObject,
    });
  }, partialOptionsArr[0]);
}

/**
 * Typesafe wrapper to merge ILightNodeOptions objects
 */
export function mergeBeaconNodeLightOptionsWithDefaults(
  defaultOptions: ILightNodeOptions,
  ...partialOptionsArr: RecursivePartial<ILightNodeOptions>[]
): ILightNodeOptions {
  return mergeBeaconNodeLightOptions(defaultOptions, ...partialOptionsArr) as ILightNodeOptions;
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
