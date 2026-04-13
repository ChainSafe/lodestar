import {describe, expect, it} from "vitest";
import {
  NativeStateViewError,
  NativeStateViewErrorCode,
  createBeaconStateView,
  createBeaconStateViewForHistoricalRegen,
} from "../../src/index.js";

describe("stateViewFactory", () => {
  it("throws a structured error for native state view at beacon startup", () => {
    expectNativeStateViewError(
      () => createBeaconStateView({useNative: true, stateBytes: new Uint8Array()}),
      "beacon startup"
    );
  });

  it("throws a structured error for native state view during historical regeneration", () => {
    expectNativeStateViewError(
      () => createBeaconStateViewForHistoricalRegen({useNative: true, stateBytes: new Uint8Array()}),
      "historical state regeneration"
    );
  });
});

function expectNativeStateViewError(fn: () => void, context: "beacon startup" | "historical state regeneration"): void {
  try {
    fn();
    expect.unreachable("Expected native state view guard to throw");
  } catch (e) {
    expect(e).toBeInstanceOf(NativeStateViewError);
    if (!(e instanceof NativeStateViewError)) {
      return;
    }

    expect(e.type).toEqual({code: NativeStateViewErrorCode.NOT_IMPLEMENTED, context});
    expect(e.message).toContain("--chain.nativeStateView");
  }
}
