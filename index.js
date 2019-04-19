const assert = require('assert')
const keccak256 = require('keccak256')
const mcl = require('mcl-wasm')

async function init () {
  await mcl.init(mcl.BLS12_381)
}

/**
 * @returns {bytes32} secretKey
 */
function genSecret () {
  const s = new mcl.Fr()
  s.setByCSPRNG()
  return toBuffer(s)
}

/**
 * @param {bytes32} secretKey
 * @returns {bytes48} pubkey
 */
function genPublic (secretKey) {
  const s = mclSecretKey(secretKey)
  const q = g1()
  const key = toBuffer(mcl.mul(q, s));
  key[0] |= 0xa0;
  return key
}

/**
 * @param {bytes32} secretKey
 * @param {bytes32} messageHash
 * @param {bytes8} domain
 * @returns {bytes96} signature
 */
function sign (secretKey, messageHash, domain) {
  const s = mclSecretKey(secretKey)
  const hash = hashToG2(messageHash, domain)
  return toBuffer(mcl.mul(hash, s))
}

/**
 * Return G1 as defined [here](https://github.com/zkcrypto/pairing/tree/master/src/bls12_381#g1)
 * @returns {mcl.G1} g1
 */
function g1() {
	const g = new mcl.G1()
	g.setStr('1 3685416753713387016781088315183077757961620795782546409894578378688607592378376318836054947676345821548104185464507 1339506544944476473020471379941921221584933875938349620426543736416511423956333506472724655353366534992391756441569')
	return g
}

/**
 * @param {bytes32} messageHash
 * @param {bytes8} domain
 * @returns {mcl.G2} g2
 */
function hashToG2 (messageHash, domain) {
  assert.equal(messageHash.length, 32, 'messageHash must be 32 bytes long')
  assert.equal(domain.length, 8, 'domain must be 8 bytes long')
	const xReal = keccak256(Buffer.concat([
    messageHash,
    domain,
    Buffer.from([1]),
  ]))
  const xRealFp = new mcl.Fp()
  xRealFp.setLittleEndian(xReal)
	const xImag = keccak256(Buffer.concat([
    messageHash,
    domain,
    Buffer.from([2]),
  ]))
  const xImagFp = new mcl.Fp()
  xImagFp.setLittleEndian(xImag)
  const xCoordinate = new mcl.Fp2()
  xCoordinate.set_a(xRealFp)
  xCoordinate.set_b(xImagFp)
  return xCoordinate.mapToG2()
}

/**
 * @param {Array<bytes48>} pubkeys
 * @returns {bytes48}
 */
function aggregatePubkeys(pubkeys) {
  return toBuffer(
    pubkeys.map((pub) => mclPubkey(pub))
      .reduce((acc, val) => mcl.add(acc, val))
  )
}

/**
 * @param {Array<bytes96>} signatures
 * @returns {bytes96}
 */
function aggregateSignatures(signatures) {
  return toBuffer(
    signatures.map((sig) => mclSignature(sig))
      .reduce((acc, val) => mcl.add(acc, val))
  )
}

/**
 * @param {bytes48} pubkey
 * @param {bytes32} messageHash
 * @param {bytes96} signature
 * @param {bytes8} domain
 * @returns {boolean}
 */
function verify (pubkey, messageHash, signature, domain) {
  const pubkeyG1 = mclPubkey(pubkey)
  const signatureG2 = mclSignature(signature)
	return toG2AndPairing(pubkeyG1, messageHash, domain).isEqual(mcl.pairing(g1(), signatureG2))
}

/**
 * @param {Array<bytes48>} pubkeys
 * @param {Array<bytes32>} messageHashes
 * @param {bytes96} signature
 * @param {bytes8} domain
 * @returns {boolean}
 */
function verifyMultiple (pubkeys, messageHashes, signature, domain) {
  assert.equal(pubkeys.length, messageHashes.length,
    'number of pubkeys must equal number of message hashes')
	const pubkeyG1s = pubkeys.map((pub) => mclPubkey(pub))
  const signatureG2 = mclSignature(signature)

  const ePH = Array.from({length: pubkeys.length}, (_, i) => i)
    // create a pairing for each pubkey, messageHash pair
    .map((i) => toG2AndPairing(pubkeyG1s[i], messageHashes[i], domain))
    // accumulate into a single mcl.GT
    .reduce((acc, val) => mcl.mul(acc, val))
	return ePH.isEqual(mcl.pairing(g1(), signatureG2))
}

// Internal functions

/**
 * Utility function used to hash messageHash and domain to G2 and do a pairing with pubkey
 * @param {mcl.G1} pubkey
 * @param {bytes32} messageHash
 * @param {bytes8} domain
 * @returns {mcl.GT}
 */
function toG2AndPairing (pubkey, messageHash, domain) {
  return mcl.pairing(pubkey, hashToG2(messageHash, domain))
}

// mcl object constructors with 'type' assertions

function mclSecretKey(secretKey) {
  assert.equal(secretKey.length, 32, 'secretKey must be 32 bytes long')
  return fromBuffer(mcl.Fr, secretKey)
}

function mclPubkey(pubkey) {
  assert.equal(pubkey.length, 48, 'pubkey must be 48 bytes long')
  return fromBuffer(mcl.G1, pubkey)
}

function mclSignature(signature) {
  assert.equal(signature.length, 96, 'signature must be 96 bytes long')
  return fromBuffer(mcl.G2, signature)
}

// Utility function to create a new mcl object from a buffer
// Used to create a mcl.G1, mcl.G2, mcl.Fp, etc.
function fromBuffer(mclType, buffer) {
  const object = new mclType()
  // We assume input is serialized to big-endian order
  // the mcl library expects little-endian order
  // so we must reverse before deserializing
  object.deserialize((new Uint8Array(buffer)).slice().reverse())
  return object
}

// Utility function to create a buffer from an mcl object
// Used to create a buffer from a mcl.G1, mcl.G2, mcl.Fp, etc.
function toBuffer(object) {
  // Our standard expects output serialized to big-endian order
  // the mcl library serializes to little-endian order
  // so we must reverse after serializing
  return Buffer.from(object.serialize()).reverse()
}


module.exports = {
  init,
  genSecret,
  genPublic,
  sign,
  g1,
  hashToG2,
  aggregatePubkeys,
  aggregateSignatures,
  verify,
  verifyMultiple,
};
