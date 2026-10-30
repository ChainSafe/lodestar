import {IBeaconChain} from "../interface.js";
import {NativeComponent, NativeComponentsOpts, nativeComponentNotImplemented} from "../nativeComponents.js";
import {IValidationEngine} from "./interface.js";
import {ValidationEngine, ValidationEngineModules} from "./validationEngine.js";

export * from "./caches.js";
export * from "./interface.js";
export {TopicRoutedValidationEngine, ValidationEngine, type ValidationEngineModules} from "./validationEngine.js";

/** Once a native engine exists, topics in `nativeValidationTopics` are routed to it with `TopicRoutedValidationEngine` */
export function createValidationEngine(
  opts: NativeComponentsOpts,
  chain: IBeaconChain,
  modules: ValidationEngineModules = {}
): IValidationEngine {
  if ((opts.nativeValidationTopics ?? []).length > 0) {
    throw nativeComponentNotImplemented(NativeComponent.validation);
  }
  return new ValidationEngine(chain, modules);
}
