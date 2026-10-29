import {IBeaconChain} from "../interface.js";
import {NativeComponent, NativeComponentsOpts, nativeComponentNotImplemented} from "../nativeComponents.js";
import {IValidationEngine} from "./interface.js";
import {ValidationEngine} from "./validationEngine.js";

export * from "./interface.js";
export {TopicRoutedValidationEngine, ValidationEngine} from "./validationEngine.js";

/** Once a native engine exists, topics in `nativeValidationTopics` are routed to it with `TopicRoutedValidationEngine` */
export function createValidationEngine(opts: NativeComponentsOpts, chain: IBeaconChain): IValidationEngine {
  if ((opts.nativeValidationTopics ?? []).length > 0) {
    throw nativeComponentNotImplemented(NativeComponent.validation);
  }
  return new ValidationEngine(chain);
}
