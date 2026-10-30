import {IForkChoice} from "@lodestar/fork-choice";
import {NativeComponent, NativeComponentsOpts, nativeComponentNotImplemented} from "../nativeComponents.js";
import {ForkChoiceStateInputs, IStateEngine} from "./interface.js";
import {StateEngine, StateEngineModules, StateEngineOpts} from "./stateEngine.js";

export * from "./interface.js";
export {StateEngine, type StateEngineModules, type StateEngineOpts} from "./stateEngine.js";

/** Fork choice is returned alongside because the engine has to construct it, see `ForkChoiceStateInputs` */
export function createStateEngine(
  opts: StateEngineOpts & NativeComponentsOpts,
  modules: StateEngineModules,
  initForkChoice: (inputs: ForkChoiceStateInputs) => IForkChoice
): {stateEngine: IStateEngine; forkChoice: IForkChoice} {
  if (opts.nativeStateEngine) {
    throw nativeComponentNotImplemented(NativeComponent.stateEngine);
  }
  const stateEngine = new StateEngine(opts, modules, initForkChoice);
  return {stateEngine, forkChoice: stateEngine.forkChoice};
}
