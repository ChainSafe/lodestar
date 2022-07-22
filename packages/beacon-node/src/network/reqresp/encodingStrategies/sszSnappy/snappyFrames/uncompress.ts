import BufferList from "bl";
import {uncompress} from "snappyjs";

const IDENTIFIER = Buffer.from([0x73, 0x4e, 0x61, 0x50, 0x70, 0x59]);

export class SnappyFramesUncompress {
  private buffer = new BufferList();

  private state: IUncompressState = {
    foundIdentifier: false,
  };

  /**
   * Accepts chunk of data containing some part of snappy frames stream
   * @param chunk
   * @return Buffer if there is one or more whole frames, null if it's partial
   */
  uncompress(chunk: Buffer): Buffer | null {
    this.buffer.append(chunk);
    const result = new BufferList();
    while (this.buffer.length > 0) {
      if (this.buffer.length < 4) break;

      const type = getChunkType(this.buffer.get(0));
      const frameSize = getFrameSize(this.buffer, 1);
      const data = this.buffer.slice(4, 4 + frameSize);

      if (this.buffer.length - 4 < frameSize) {
        break;
      }

      this.buffer.consume(4 + frameSize);

      if (!this.state.foundIdentifier && type !== ChunkType.IDENTIFIER) {
        throw "malformed input: must begin with an identifier";
      }

      if (type === ChunkType.IDENTIFIER) {
        if (!data.equals(IDENTIFIER)) {
          throw "malformed input: bad identifier";
        }
        this.state.foundIdentifier = true;
        continue;
      }

      if (type === ChunkType.COMPRESSED) {
        result.append(uncompress(data.slice(4)));
      }
      if (type === ChunkType.UNCOMPRESSED) {
        result.append(data.slice(4));
      }
    }
    if (result.length === 0) {
      return null;
    } else {
      return result.slice();
    }
  }

  reset(): void {
    this.buffer = new BufferList();
    this.state = {
      foundIdentifier: false,
    };
  }
}

interface IUncompressState {
  foundIdentifier: boolean;
}

enum ChunkType {
  IDENTIFIER = 0xff,
  COMPRESSED = 0x00,
  UNCOMPRESSED = 0x01,
  PADDING = 0xfe,
}

function getFrameSize(buffer: BufferList, offset: number): number {
  return buffer.get(offset) + (buffer.get(offset + 1) << 8) + (buffer.get(offset + 2) << 16);
}

function getChunkType(value: number): ChunkType {
  switch (value) {
    case ChunkType.IDENTIFIER:
      return ChunkType.IDENTIFIER;
    case ChunkType.COMPRESSED:
      return ChunkType.COMPRESSED;
    case ChunkType.UNCOMPRESSED:
      return ChunkType.UNCOMPRESSED;
    case ChunkType.PADDING:
      return ChunkType.PADDING;
    default:
      throw new Error("Unsupported snappy chunk type");
  }
}
