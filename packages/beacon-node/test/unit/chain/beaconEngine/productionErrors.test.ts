import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ErrorAborted} from "@lodestar/utils";
import {ApiError, NodeIsSyncing} from "../../../../src/api/impl/errors.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import * as duties from "../../../../src/chain/beaconEngine/duties.js";
import {BeaconEngineErrorCode} from "../../../../src/chain/beaconEngine/interface.js";
import * as production from "../../../../src/chain/beaconEngine/produceEngineOrBuilderBlock.js";
import {QueueError, QueueErrorCode} from "../../../../src/util/queue/index.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {zeroProtoBlock} from "../../../utils/state.js";

const request = {
  slot: 1,
  randaoReveal: new Uint8Array(96),
  graffiti: new Uint8Array(32),
  builderSelection: routes.validator.BuilderSelection.ExecutionOnly,
  builderBoostFactor: 0n,
  includePayload: false,
  builderConfig: {minBid: 0n, builderBoostFactor: 0n, builders: []},
};

describe.each(["produceBlock", "produceBlockV4", "produceAttestationData"] as const)("%s error logging", (method) => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    {error: new Error("unexpected"), code: BeaconEngineErrorCode.INTERNAL, level: "error"},
    {error: new ApiError(500, "state unavailable"), code: BeaconEngineErrorCode.API_ERROR, level: "debug"},
    {error: new ApiError(400, "invalid request"), code: BeaconEngineErrorCode.API_ERROR, level: "debug"},
    {error: new NodeIsSyncing("waiting for parent"), code: BeaconEngineErrorCode.NODE_SYNCING, level: "debug"},
    {error: new ErrorAborted("closed"), code: BeaconEngineErrorCode.ABORTED, level: null},
    {error: new QueueError({code: QueueErrorCode.QUEUE_ABORTED}), code: BeaconEngineErrorCode.ABORTED, level: null},
  ] as const)("logs $code at $level before returning plain metadata", async ({error, code, level}) => {
    const logger = getMockedLogger();
    const core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
      logger,
      forkChoice: {getHead: () => zeroProtoBlock},
    });
    vi.spyOn(production, "produceEngineOrBuilderBlock").mockRejectedValue(error);
    vi.spyOn(production, "produceBlockV4").mockRejectedValue(error);
    vi.spyOn(duties, "produceAttestationData").mockRejectedValue(error);

    const result =
      method === "produceAttestationData" ? await core[method](request.slot, 2) : await core[method](request);
    const expectedCode =
      method === "produceAttestationData" && code === BeaconEngineErrorCode.NODE_SYNCING
        ? BeaconEngineErrorCode.API_ERROR
        : code;
    expect(result).toMatchObject({ok: false, code: expectedCode});
    expect(result).not.toHaveProperty("stack");
    expect(result).not.toHaveProperty("error");
    expect(result).not.toHaveProperty("payload.stack");
    if (level === null) {
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.debug).not.toHaveBeenCalled();
    } else {
      expect(logger[level]).toHaveBeenCalledExactlyOnceWith(
        method === "produceBlock"
          ? "Error producing block"
          : method === "produceBlockV4"
            ? "Error producing block V4"
            : "Error producing attestation data",
        {
          slot: request.slot,
          code: expectedCode,
          ...(method === "produceAttestationData" ? {committeeIndex: 2} : {}),
          ...(expectedCode === BeaconEngineErrorCode.API_ERROR && error instanceof ApiError
            ? {status: error.statusCode}
            : {}),
        },
        error
      );
      expect(logger[level === "error" ? "debug" : "error"]).not.toHaveBeenCalled();
    }
  });
});
