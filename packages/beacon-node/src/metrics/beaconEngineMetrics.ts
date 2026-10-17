import {ForkChoiceMetrics, getForkChoiceMetrics} from "@lodestar/fork-choice";
import {BeaconStateTransitionMetrics, getMetrics as getStateTransitionMetrics} from "@lodestar/state-transition";
import {createBeaconEngineBeaconMetrics} from "./metrics/beacon.js";
import {createBeaconEngineLodestarMetrics} from "./metrics/lodestar.js";
import {RegistryMetricCreator} from "./utils/registryMetricCreator.js";

/** Engine-local recorders; Metrics and its registry stay on the BeaconChain side, including in-process mode. */
export type BeaconEngineMetrics = ReturnType<typeof createBeaconEngineBeaconMetrics> &
  ReturnType<typeof createBeaconEngineLodestarMetrics> &
  ForkChoiceMetrics & {
    stateTransition: BeaconStateTransitionMetrics | null;
    register: RegistryMetricCreator;
  };

export function createBeaconEngineMetrics(nativeStateTransition = false): BeaconEngineMetrics {
  const register = new RegistryMetricCreator();
  return {
    ...createBeaconEngineBeaconMetrics(register),
    ...createBeaconEngineLodestarMetrics(register),
    ...getForkChoiceMetrics(register),
    stateTransition: nativeStateTransition ? null : getStateTransitionMetrics(register),
    register,
  };
}
