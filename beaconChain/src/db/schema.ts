// Buckets are separate database areas
export enum Bucket {
  attestation,
  block,
  mainChain,
  chainInfo,
  blockOperations,
  validator,
}

export const Key = {
  chainHeight: Buffer.from('chainHeight'),
  state: Buffer.from('state'),
  finalizedState: Buffer.from('finalizedState'),
}

/**
 * Prepend a bucket to a key
 */
export function encodeKey(bucket: Bucket, key: Buffer | string | number, useBuffer = true): Buffer | string {
  let buf;
  if (typeof key === 'string') {
    buf = Buffer.alloc(key.length + 1);
    buf.write(key, 1);
  } else if (typeof key === 'number') {
    buf = Buffer.alloc(9)
    buf.writeUInt32(key, 1);
  } else {
    buf = Buffer.alloc(key.length + 1);
    key.copy(buf, 1);
  }
  buf.writeUInt8(bucket, 0);
  return useBuffer ? buf : buf.toString('hex');
}
