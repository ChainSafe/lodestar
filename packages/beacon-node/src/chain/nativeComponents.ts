import {LodestarError} from "@lodestar/utils";
import {ValidationTopic} from "./validationEngine/interface.js";

/**
 * Per-component switches for moving the consensus core to lodestar-z one stage at a time.
 * Each stage requires the previous one, because its native implementation shares native objects with it:
 * 1. fork choice reads the native state in `onBlock`
 * 2. the state engine walks native fork choice ancestry and supplies its justified balances
 * 3. validation reads native fork choice and state caches, and writes fork choice votes directly
 */
export type NativeComponentsOpts = {
  nativeStateTransition?: boolean;
  nativeForkChoice?: boolean;
  nativeStateEngine?: boolean;
  nativeValidationTopics?: ValidationTopic[];
};

export enum NativeComponent {
  forkChoice = "forkChoice",
  stateEngine = "stateEngine",
  validation = "validation",
}

export enum NativeComponentErrorCode {
  MISSING_PREREQUISITE = "NATIVE_COMPONENT_ERROR_MISSING_PREREQUISITE",
  NOT_IMPLEMENTED = "NATIVE_COMPONENT_ERROR_NOT_IMPLEMENTED",
}

export type NativeComponentErrorType =
  | {
      code: NativeComponentErrorCode.MISSING_PREREQUISITE;
      component: NativeComponent;
      requires: keyof NativeComponentsOpts;
    }
  | {code: NativeComponentErrorCode.NOT_IMPLEMENTED; component: NativeComponent};

export class NativeComponentError extends LodestarError<NativeComponentErrorType> {}

export function assertNativeComponentOpts(opts: NativeComponentsOpts): void {
  if (opts.nativeForkChoice && !opts.nativeStateTransition) {
    throw missingPrerequisite(NativeComponent.forkChoice, "nativeStateTransition");
  }
  if (opts.nativeStateEngine && !opts.nativeForkChoice) {
    throw missingPrerequisite(NativeComponent.stateEngine, "nativeForkChoice");
  }
  if ((opts.nativeValidationTopics ?? []).length > 0 && !opts.nativeStateEngine) {
    throw missingPrerequisite(NativeComponent.validation, "nativeStateEngine");
  }
}

/** Thrown by each component factory until lodestar-z exposes a binding for it */
export function nativeComponentNotImplemented(component: NativeComponent): NativeComponentError {
  return new NativeComponentError({code: NativeComponentErrorCode.NOT_IMPLEMENTED, component});
}

function missingPrerequisite(component: NativeComponent, requires: keyof NativeComponentsOpts): NativeComponentError {
  return new NativeComponentError({code: NativeComponentErrorCode.MISSING_PREREQUISITE, component, requires});
}
