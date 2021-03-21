import {toBufferLE, toBigIntLE, toBufferBE, toBigIntBE} from "bigint-buffer";

type Endianness = "le" | "be";

/**
 * Return a byte array from a number or BigInt
 */
export function intToBytes(value: bigint | number, length: number, endianness: Endianness = "le"): Buffer {
  switch(typeof value){
    case "number":
      return numberToBytes(value,length,endianness);
    case "bigint":
      return bigIntToBytes(value, length, endianness);
      break;
    default:
      throw new Error(`unsupported number type ${typeof value}`);
  }
}

/**
 * Convert byte array in LE to integer.
 */

export function numberToBytes(value: number,length: number,endianness: Endianness = "le"): Buffer {
  //length less than required will lead to truncation on the msb side, same as bigint inttobytes
  if(value<0)value=-value;//bigint inttobytes always return the absolute value
  if(value>Number.MAX_SAFE_INTEGER)return intToBytes(BigInt(value),length,endianness);
  let buffer = new ArrayBuffer(Math.max(length,8));
  let mvalue;
  switch(endianness){
    case "le":
      new DataView(buffer).setInt32(0, value, true);
      if(length>4){
        mvalue= Math.floor(value/2**32);
        new DataView(buffer).setInt32(4, mvalue, true);
      }
      if(buffer.byteLength > length)buffer=buffer.slice(0,length);
      break;
    case "be":
      new DataView(buffer).setInt32(buffer.byteLength-4, value, false);
      if(length>4){
        mvalue= Math.floor(value/2**32);
        new DataView(buffer).setInt32(buffer.byteLength-8, mvalue, false);
      }
      if(buffer.byteLength > length)buffer=buffer.slice(buffer.byteLength-length,buffer.byteLength);
      break;
    default:
      throw new Error("endianness must be either 'le' or 'be'");
  }
  return Buffer.from(buffer);
}

export function bytesToInt(value: Uint8Array, endianness: Endianness = "le"): number {
  let isbigint: any=false;
  let buffer=new ArrayBuffer(8);
  let left,right,view;
  switch(endianness){
    case "le":
      if(value.length>6) isbigint=(value[6]>31)||value.slice(7,value.length).reduce((acc,vrow)=>(acc||(vrow>0)),false);
      if(isbigint)return Number(bytesToBigInt(value, endianness));
      Buffer.from(value).copy(Buffer.from(buffer),0,0,Math.min(value.length,8));
      view = new DataView(buffer);
      left =  view.getUint32(4, true);
      right = view.getUint32(0, true);
      break;
    case "be":
      if(value.length>6) isbigint=(value[value.length-7]>31)||value.slice(0,value.length-7).reduce((acc,vrow)=>(acc||(vrow>0)),false);
      if(isbigint)return Number(bytesToBigInt(value, endianness));
      Buffer.from(value).copy(Buffer.from(buffer),Math.max(0,8-value.length),Math.max(value.length-8,0),value.length);
      view = new DataView(buffer);
      left =  view.getUint32(0, false);
      right = view.getUint32(4, false);
      break;
  }

  const combined=2**32*left + right;
  return combined;
}

export function bigIntToBytes(value: bigint, length: number, endianness: Endianness = "le"): Buffer {
  if (endianness === "le") {
    return toBufferLE(value, length);
  } else if (endianness === "be") {
    return toBufferBE(value, length);
  }
  throw new Error("endianness must be either 'le' or 'be'");
}

export function bytesToBigInt(value: Uint8Array, endianness: Endianness = "le"): bigint {
  if (endianness === "le") {
    return toBigIntLE(value as Buffer);
  } else if (endianness === "be") {
    return toBigIntBE(value as Buffer);
  }
  throw new Error("endianness must be either 'le' or 'be'");
}

export function toHex(buffer: Parameters<typeof Buffer.from>[0]): string {
  if (Buffer.isBuffer(buffer)) {
    return "0x" + buffer.toString("hex");
  } else if (buffer instanceof Uint8Array) {
    return "0x" + Buffer.from(buffer.buffer, buffer.byteOffset, buffer.length).toString("hex");
  } else {
    return "0x" + Buffer.from(buffer).toString("hex");
  }
}

export function fromHex(hex: string): Uint8Array {
  const b = Buffer.from(hex.replace("0x", ""), "hex");
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}
