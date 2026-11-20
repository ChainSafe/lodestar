import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {
  type EngineApiRpcReturnTypes,
  ErrorJsonRpcResponse,
  type JsonRpcHttpClient,
  parseExecutionPayload,
  serializePayloadAttributes,
} from "@lodestar/beacon-node";
import type {BuildHandle, BuildRequest, BuiltPayload, PayloadSource} from "@lodestar/builder";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, LodestarError, toHex} from "@lodestar/utils";

type PayloadResponse = EngineApiRpcReturnTypes["engine_getPayloadV6"];
type Rpc = Pick<JsonRpcHttpClient, "fetch">;

export type TransactionsPlan = {
  transactions: string[];
  extraData?: string;
  parentHash?: string;
  slotNumber?: number;
};

export type TestingPayloadSourceOptions = {
  transactionsFile: string;
  outputDir?: string;
};

export enum TestingPayloadErrorCode {
  INVALID_PLAN = "TESTING_PAYLOAD_INVALID_PLAN",
  PLAN_MISMATCH = "TESTING_PAYLOAD_PLAN_MISMATCH",
  PARENT_UNAVAILABLE = "TESTING_PAYLOAD_PARENT_UNAVAILABLE",
  BUILD_IN_PROGRESS = "TESTING_PAYLOAD_BUILD_IN_PROGRESS",
  RESPONSE_MISMATCH = "TESTING_PAYLOAD_RESPONSE_MISMATCH",
  UNKNOWN_HANDLE = "TESTING_PAYLOAD_UNKNOWN_HANDLE",
  UNSUPPORTED_FORK = "TESTING_PAYLOAD_UNSUPPORTED_FORK",
  COMPLETION_UNKNOWN = "TESTING_PAYLOAD_COMPLETION_UNKNOWN",
}

export class TestingPayloadError extends LodestarError<{code: TestingPayloadErrorCode; reason: string}> {}

/** The RPC must use the process signal: a proposal deadline cannot cancel the EL's synchronous build. */
export class TestingPayloadSource implements PayloadSource {
  private pending = false;
  private buildCompletionUnknown = false;
  private lastFailure: {key: string; error: unknown} | undefined;
  private readonly prepared = new Map<string, {key: string; payload: BuiltPayload}>();

  constructor(
    readonly id: string,
    private readonly rpc: Rpc,
    private readonly opts: TestingPayloadSourceOptions
  ) {}

  async prepare(request: BuildRequest, signal: AbortSignal): Promise<BuildHandle> {
    if (signal.aborted) throw new ErrorAborted();
    if (request.fork !== ForkName.gloas) {
      throw new TestingPayloadError({code: TestingPayloadErrorCode.UNSUPPORTED_FORK, reason: request.fork});
    }
    if (this.buildCompletionUnknown) {
      throw new TestingPayloadError({
        code: TestingPayloadErrorCode.COMPLETION_UNKNOWN,
        reason: "Previous build completion is unknown; check the EL and restart the builder",
      });
    }
    const attributes = serializePayloadAttributes(request.payloadAttributes);
    const parentHash = request.forkchoiceState.headBlockHash;
    const key = JSON.stringify([request.fork, parentHash, attributes]);
    for (const [payloadId, built] of this.prepared) {
      if (built.key === key) return {sourceId: this.id, fork: request.fork, payloadId};
    }
    if (this.lastFailure?.key === key) throw this.lastFailure.error;
    if (this.pending) {
      throw new TestingPayloadError({
        code: TestingPayloadErrorCode.BUILD_IN_PROGRESS,
        reason: "EL build still pending",
      });
    }

    this.pending = true;
    let buildStarted = false;
    try {
      const plan = parseTransactionsPlan(JSON.parse(await readFile(this.opts.transactionsFile, "utf8")));
      if (
        (plan.parentHash !== undefined && plan.parentHash.toLowerCase() !== parentHash.toLowerCase()) ||
        (plan.slotNumber !== undefined && plan.slotNumber !== request.payloadAttributes.slotNumber)
      ) {
        throw new TestingPayloadError({code: TestingPayloadErrorCode.PLAN_MISMATCH, reason: "Parent or slot differs"});
      }
      const head = await this.rpc.fetch<{hash: string} | null>({
        method: "eth_getBlockByNumber",
        params: ["latest", false],
      });
      if (head?.hash.toLowerCase() !== parentHash.toLowerCase()) {
        throw new TestingPayloadError({code: TestingPayloadErrorCode.PARENT_UNAVAILABLE, reason: parentHash});
      }
      if (signal.aborted) throw new ErrorAborted();

      const rpcRequest = {
        method: "testing_buildBlockV1",
        params: [parentHash, attributes, plan.transactions, plan.extraData ?? "0x"],
      };
      const startedAt = Date.now();
      let response: PayloadResponse;
      buildStarted = true;
      try {
        response = await this.rpc.fetch<PayloadResponse, typeof rpcRequest.params>(rpcRequest);
      } catch (error) {
        // Geth's RPC timeout can reply before its synchronous build finishes.
        if (!(error instanceof ErrorJsonRpcResponse) || error.response.error.code === -32002) {
          this.buildCompletionUnknown = true;
        }
        throw error;
      }
      const completedAt = Date.now();
      const payload = validateTestingPayload(this.id, request, plan, response);
      if (this.opts.outputDir) {
        const filename = `${request.payloadAttributes.slotNumber}-${toHex(payload.executionPayload.blockHash)}-${randomUUID()}.json`;
        await writeCapture(this.opts.outputDir, filename, {
          fork: request.fork,
          forkchoiceState: request.forkchoiceState,
          startedAt,
          completedAt,
          aborted: signal.aborted,
          request: rpcRequest,
          response,
        });
      }
      if (signal.aborted) throw new ErrorAborted();

      const payloadId = randomUUID();
      this.prepared.set(payloadId, {key, payload});
      while (this.prepared.size > 2) this.prepared.delete(this.prepared.keys().next().value as string);
      return {sourceId: this.id, fork: request.fork, payloadId};
    } catch (error) {
      if (buildStarted) this.lastFailure = {key, error};
      throw error;
    } finally {
      this.pending = false;
    }
  }

  async getPayload(handle: BuildHandle, signal: AbortSignal): Promise<BuiltPayload> {
    if (signal.aborted) throw new ErrorAborted();
    const prepared = this.prepared.get(handle.payloadId);
    if (handle.sourceId !== this.id || prepared?.payload.fork !== handle.fork) {
      throw new TestingPayloadError({code: TestingPayloadErrorCode.UNKNOWN_HANDLE, reason: handle.payloadId});
    }
    this.prepared.delete(handle.payloadId);
    return prepared.payload;
  }
}

export function parseTransactionsPlan(value: unknown): TransactionsPlan {
  const fail = (reason: string): never => {
    throw new TestingPayloadError({code: TestingPayloadErrorCode.INVALID_PLAN, reason});
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("Expected an object");
  const plan = value as Record<string, unknown>;
  if (!Array.isArray(plan.transactions)) return fail("transactions must be an array; null would select the txpool");
  const transactions = plan.transactions.map((tx: unknown) => {
    if (typeof tx !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(tx)) return fail("Invalid signed transaction hex");
    if (tx.slice(2, 4) === "03") return fail("Blob transactions require sidecars and are not supported");
    return tx;
  });
  const {extraData, parentHash, slotNumber} = plan;
  if (extraData !== undefined && (typeof extraData !== "string" || !/^0x(?:[0-9a-fA-F]{2}){0,32}$/.test(extraData))) {
    return fail("extraData must contain at most 32 bytes");
  }
  if (parentHash !== undefined && (typeof parentHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(parentHash))) {
    return fail("parentHash must contain 32 bytes");
  }
  if (
    slotNumber !== undefined &&
    (typeof slotNumber !== "number" || !Number.isSafeInteger(slotNumber) || slotNumber < 0)
  ) {
    return fail("slotNumber must be a nonnegative safe integer");
  }
  return {transactions, extraData, parentHash, slotNumber};
}

function validateTestingPayload(
  sourceId: string,
  request: BuildRequest,
  plan: TransactionsPlan,
  response: PayloadResponse
): BuiltPayload {
  const fail = (reason: string): never => {
    throw new TestingPayloadError({code: TestingPayloadErrorCode.RESPONSE_MISMATCH, reason});
  };
  const parsed = parseExecutionPayload(ForkName.gloas, response);
  // The parser is fork-aware but its return type is the union of all forks.
  const executionPayload = parsed.executionPayload as BuiltPayload["executionPayload"];
  const {blobsBundle, executionRequests, executionPayloadValue} = parsed;
  const attrs = request.payloadAttributes;
  if (!blobsBundle || !executionRequests) return fail("Missing blobs bundle or execution requests");
  if (!("builderDeposits" in executionRequests) || !("builderExits" in executionRequests)) {
    return fail("Missing Gloas execution request fields");
  }
  if (
    executionPayload.blobGasUsed !== 0n ||
    blobsBundle.blobs.length !== 0 ||
    blobsBundle.commitments.length !== 0 ||
    blobsBundle.proofs.length !== 0
  )
    return fail("Unexpected blobs in a controlled payload");
  if (
    toHex(executionPayload.parentHash).toLowerCase() !== request.forkchoiceState.headBlockHash.toLowerCase() ||
    executionPayload.slotNumber !== attrs.slotNumber ||
    executionPayload.timestamp !== attrs.timestamp ||
    toHex(executionPayload.prevRandao) !== toHex(attrs.prevRandao) ||
    toHex(executionPayload.feeRecipient).toLowerCase() !== attrs.suggestedFeeRecipient.toLowerCase() ||
    !ssz.capella.Withdrawals.equals(executionPayload.withdrawals, attrs.withdrawals) ||
    toHex(executionPayload.extraData).toLowerCase() !== (plan.extraData ?? "0x").toLowerCase()
  )
    return fail("Returned payload does not match the requested parent or attributes");
  if (
    executionPayload.transactions.length !== plan.transactions.length ||
    plan.transactions.some((tx, i) => toHex(executionPayload.transactions.get(i)).toLowerCase() !== tx.toLowerCase())
  )
    return fail("Returned transactions differ from the requested order");
  return {sourceId, fork: request.fork, executionPayload, executionPayloadValue, blobsBundle, executionRequests};
}

async function writeCapture(directory: string, filename: string, capture: unknown): Promise<void> {
  await mkdir(directory, {recursive: true});
  const temporary = path.join(directory, `.capture-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(capture, null, 2), {flag: "wx"});
    await rename(temporary, path.join(directory, filename));
  } finally {
    await rm(temporary, {force: true});
  }
}
