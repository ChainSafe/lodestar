import {RingBuffer} from "../../util/ringBuffer.js";
import {GossipType} from "../gossip/interface.js";

export type GossipTypeSharedArrayBuffers = Record<GossipType, {data: SharedArrayBuffer; control: SharedArrayBuffer}>;
export type GossipBuffersSharedArrayBuffers = GossipTypeSharedArrayBuffers & {control: SharedArrayBuffer};

export function createGossipBuffersSharedArrayBuffers(): GossipBuffersSharedArrayBuffers {
  return {
    [GossipType.beacon_block]: {
      data: new SharedArrayBuffer(1000 * 1024),
      control: new SharedArrayBuffer(8),
    },
    [GossipType.blob_sidecar]: {
      data: new SharedArrayBuffer(1000 * 1024),
      control: new SharedArrayBuffer(8),
    },
    [GossipType.beacon_aggregate_and_proof]: {
      data: new SharedArrayBuffer(1000 * 1024),
      control: new SharedArrayBuffer(8),
    },
    [GossipType.beacon_attestation]: {
      data: new SharedArrayBuffer(1000 * 1024),
      control: new SharedArrayBuffer(8),
    },
    [GossipType.voluntary_exit]: {
      data: new SharedArrayBuffer(1000 * 1024),
      control: new SharedArrayBuffer(8),
    },
    [GossipType.proposer_slashing]: {
      data: new SharedArrayBuffer(1000 * 1024),
      control: new SharedArrayBuffer(8),
    },
    [GossipType.attester_slashing]: {
      data: new SharedArrayBuffer(1000 * 1024),
      control: new SharedArrayBuffer(8),
    },
    [GossipType.sync_committee_contribution_and_proof]: {
      data: new SharedArrayBuffer(1000 * 1024),
      control: new SharedArrayBuffer(8),
    },
    [GossipType.sync_committee]: {
      data: new SharedArrayBuffer(1000 * 1024),
      control: new SharedArrayBuffer(8),
    },
    [GossipType.light_client_finality_update]: {
      data: new SharedArrayBuffer(1000 * 1024),
      control: new SharedArrayBuffer(8),
    },
    [GossipType.light_client_optimistic_update]: {
      data: new SharedArrayBuffer(1000 * 1024),
      control: new SharedArrayBuffer(8),
    },
    [GossipType.bls_to_execution_change]: {
      data: new SharedArrayBuffer(1000 * 1024),
      control: new SharedArrayBuffer(8),
    },
    control: new SharedArrayBuffer(8),
  };
}

export class GossipBuffers {
  private readonly buffers: Record<GossipType, RingBuffer<BufferedGossipsubMessage>>;
  private readonly controlBuffer: Int32Array;
  private lastRead = 0;
  private lastWrite = 0;

  constructor(sabs: GossipBuffersSharedArrayBuffers) {
    this.buffers = {} as Record<GossipType, RingBuffer<BufferedGossipsubMessage>>;

    this.controlBuffer = new Int32Array(sabs.control);
    const gossipTypeSabs: GossipTypeSharedArrayBuffers = {...sabs};
    delete (gossipTypeSabs as {control?: unknown}).control;

    // this.controlBuffer[0] = 1;
    // this.lastWrite = 1;
    // console.log(this.controlBuffer.buffer, this.controlBuffer, this.controlBuffer[0], this.lastWrite);

    for (const [type, {data, control}] of Object.entries(gossipTypeSabs)) {
      this.buffers[type as GossipType] = new RingBuffer<BufferedGossipsubMessage>(
        data,
        control,
        serializeBufferedGossipsubMessage,
        deserializeBufferedGossipsubMessage
      );
    }
  }

  async awaitNewData(signal: AbortSignal): Promise<void> {
    const result = Atomics.waitAsync(this.controlBuffer, 0, this.lastRead);
    if (result.async) {
      let onAbort: () => void = () => {};
      const abortPromise = new Promise<void>((_, reject) => {
        onAbort = () => {
          reject(new Error("aborted"));
        };
        signal.addEventListener("abort", onAbort);
      });
      try {
        await Promise.race([result.value, abortPromise]);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  readObject(type: GossipType): BufferedGossipsubMessage | undefined {
    this.lastRead = Atomics.load(this.controlBuffer, 0);
    return this.buffers[type].readObject();
  }

  writeObject(type: GossipType, object: BufferedGossipsubMessage): boolean {
    try {
      return this.buffers[type].writeObject(object);
    } finally {
      // increment with rollover
      this.lastWrite += 1;
      if (this.lastWrite >= 0xffffffff) {
        this.lastWrite = 0;
      }
      Atomics.store(this.controlBuffer, 0, this.lastWrite);
      Atomics.notify(this.controlBuffer, 0);
    }
  }
}

// minimize data to send from the network to the processor
export type BufferedGossipsubMessage = {
  msgTopic: string;
  msgData: Uint8Array;
  msgId: string;
  propagationSource: string;
  seenTimestampSec: number;
};

export function serializeBufferedGossipsubMessage({
  msgTopic,
  msgData,
  msgId,
  propagationSource,
  seenTimestampSec,
}: BufferedGossipsubMessage): Uint8Array {
  const out = Buffer.alloc(
    4 + msgTopic.length + msgData.length + 4 + msgId.length + 4 + propagationSource.length + 4 + 6
  );

  out.writeUint32LE(msgTopic.length, 0);
  out.write(msgTopic, 4);

  out.writeUint32LE(msgData.length, 4 + msgTopic.length);
  out.set(msgData, 4 + msgTopic.length + 4);

  out.writeUint32LE(msgId.length, 4 + msgTopic.length + 4 + msgData.length);
  out.write(msgId, 4 + msgTopic.length + 4 + msgData.length + 4);

  out.writeUint32LE(propagationSource.length, 4 + msgTopic.length + 4 + msgData.length + 4 + msgId.length);
  out.write(propagationSource, 4 + msgTopic.length + 4 + msgData.length + 4 + msgId.length + 4);

  out.writeUintLE(
    seenTimestampSec,
    4 + msgTopic.length + 4 + msgData.length + 4 + msgId.length + 4 + propagationSource.length,
    6
  );

  return out;
}

export function deserializeBufferedGossipsubMessage(data: Uint8Array): BufferedGossipsubMessage {
  const buf = Buffer.from(data);

  let offset = 0;

  const msgTopicLength = buf.readUint32LE(offset);
  offset += 4;
  const msgTopic = buf.subarray(offset, offset + msgTopicLength).toString();
  offset += msgTopicLength;

  const msgDataLength = buf.readUint32LE(offset);
  offset += 4;
  const msgData = buf.subarray(offset, offset + msgDataLength);
  offset += msgDataLength;

  const msgIdLength = buf.readUint32LE(offset);
  offset += 4;
  const msgId = buf.subarray(offset, offset + msgIdLength).toString();
  offset += msgIdLength;

  const propagationSourceLength = buf.readUint32LE(offset);
  offset += 4;
  const propagationSource = buf.subarray(offset, offset + propagationSourceLength).toString();
  offset += propagationSourceLength;

  const seenTimestampSec = buf.readUintLE(offset, 6);

  return {
    msgTopic,
    msgData,
    msgId,
    propagationSource,
    seenTimestampSec,
  };
}
