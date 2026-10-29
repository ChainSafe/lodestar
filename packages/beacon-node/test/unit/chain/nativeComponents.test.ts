import {describe, expect, it, vi} from "vitest";
import {IForkChoice} from "@lodestar/fork-choice";
import {IBeaconChain} from "../../../src/chain/interface.js";
import {
  NativeComponent,
  NativeComponentError,
  NativeComponentErrorCode,
  NativeComponentsOpts,
  assertNativeComponentOpts,
} from "../../../src/chain/nativeComponents.js";
import {StateEngineModules, createStateEngine} from "../../../src/chain/stateEngine/index.js";
import {ValidationTopic, createValidationEngine} from "../../../src/chain/validationEngine/index.js";

describe("chain / nativeComponents", () => {
  describe("assertNativeComponentOpts", () => {
    const validCases: {id: string; opts: NativeComponentsOpts}[] = [
      {id: "all JS", opts: {}},
      {id: "native STF only", opts: {nativeStateTransition: true}},
      {id: "stage 1", opts: {nativeStateTransition: true, nativeForkChoice: true}},
      {id: "stage 2", opts: {nativeStateTransition: true, nativeForkChoice: true, nativeStateEngine: true}},
      {
        id: "stage 3",
        opts: {
          nativeStateTransition: true,
          nativeForkChoice: true,
          nativeStateEngine: true,
          nativeValidationTopics: [ValidationTopic.attestation],
        },
      },
      {id: "empty topic list", opts: {nativeValidationTopics: []}},
    ];

    for (const {id, opts} of validCases) {
      it(`accepts ${id}`, () => {
        expect(() => assertNativeComponentOpts(opts)).not.toThrow();
      });
    }

    const invalidCases: {
      id: string;
      opts: NativeComponentsOpts;
      component: NativeComponent;
      requires: keyof NativeComponentsOpts;
    }[] = [
      {
        id: "fork choice without native STF",
        opts: {nativeForkChoice: true},
        component: NativeComponent.forkChoice,
        requires: "nativeStateTransition",
      },
      {
        id: "state engine without native fork choice",
        opts: {nativeStateTransition: true, nativeStateEngine: true},
        component: NativeComponent.stateEngine,
        requires: "nativeForkChoice",
      },
      {
        id: "validation topics without native state engine",
        opts: {
          nativeStateTransition: true,
          nativeForkChoice: true,
          nativeValidationTopics: [ValidationTopic.aggregate],
        },
        component: NativeComponent.validation,
        requires: "nativeStateEngine",
      },
    ];

    for (const {id, opts, component, requires} of invalidCases) {
      it(`rejects ${id}`, () => {
        expect(() => assertNativeComponentOpts(opts)).toThrow(
          new NativeComponentError({code: NativeComponentErrorCode.MISSING_PREREQUISITE, component, requires})
        );
      });
    }
  });

  describe("factories reject native implementations until lodestar-z has bindings", () => {
    const notImplemented = (component: NativeComponent): NativeComponentError =>
      new NativeComponentError({code: NativeComponentErrorCode.NOT_IMPLEMENTED, component});

    it("createStateEngine", () => {
      const initForkChoice = vi.fn<() => IForkChoice>();
      expect(() => createStateEngine({nativeStateEngine: true}, {} as StateEngineModules, initForkChoice)).toThrow(
        notImplemented(NativeComponent.stateEngine)
      );
      expect(initForkChoice).not.toHaveBeenCalled();
    });

    it("createValidationEngine", () => {
      expect(() =>
        createValidationEngine({nativeValidationTopics: [ValidationTopic.attestation]}, {} as IBeaconChain)
      ).toThrow(notImplemented(NativeComponent.validation));
    });
  });
});
