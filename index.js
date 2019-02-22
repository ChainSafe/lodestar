const mcl = require('mcl-wasm')
const keccak256 = require('keccak256')

async function init () {
  await mcl.init(mcl.BLS12_381)
}

/**
 * @returns {bytes32} secretKey
 */
function genSecret () {
  const s = new mcl.Fr()
  s.setByCSPRNG()
  return Buffer.from(s.serialize())
}

/**
 * @param {bytes32} secretKey
 * @returns {bytes48} pubkey
 */
function genPublic (secretKey) {
  const sFr = fromBuffer(mcl.Fr, secretKey)
  const q = g1()
  return toBuffer(mcl.mul(q, sFr))
}

/**
 * @param {bytes32} secretKey
 * @param {bytes32} messageHash
 * @returns {bytes96} signature
 */
function sign (secretKey, messageHash, domain) {
  const s = fromBuffer(mcl.Fr, secretKey)
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
 * @param {int} domain
 * @returns {mcl.G2} g2
 */
function hashToG2 (messageHash, domain) {
	const xReal = keccak256(Buffer.concat([
    messageHash,
    Buffer.alloc(1, domain),
    Buffer.from([1]),
  ]))
  const xRealFp = new mcl.Fp()
  xRealFp.setLittleEndian(xReal)
	const xImag = keccak256(Buffer.concat([
    messageHash,
    Buffer.alloc(1, domain),
    Buffer.from([1]),
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
  return Buffer.from(
    pubkeys.map((pub) => fromBuffer(mcl.G1, pub))
    .reduce((acc, val) => mcl.add(acc, val))
    .serialize()
  )
}

/**
 * @param {Array<bytes96>} signatures
 * @returns {bytes96}
 */
function aggregateSignatures(signatures) {
  return Buffer.from(
    signatures.map((sig) => fromBuffer(mcl.G2, sig))
    .reduce((acc, val) => mcl.add(acc, val))
    .serialize()
  )
}

/**
 * @param {bytes48} pubkey
 * @param {bytes32} messageHash
 * @param {bytes96} signature
 * @param {int} domain
 * @returns {boolean}
 */
function verify (pubkey, messageHash, signature, domain) {
  const pubkeyG1 = fromBuffer(mcl.G1, pubkey)
  const signatureG2 = fromBuffer(mcl.G2, signature)
	return mcl.pairing(pubkeyG1, hashToG2(messageHash, domain)).isEqual(mcl.pairing(g1(), signatureG2))
}

/**
 * @param {Array<bytes48>} pubkeys
 * @param {Array<bytes32>} messageHashes
 * @param {bytes96} signature
 * @param {int} domain
 * @returns {boolean}
 */
function verifyMultiple (pubkeys, messageHashes, signature, domain) {
	const pubkeyG1s = pubkeys.map((pub) => fromBuffer(mcl.G1, pub))
  const signatureG2 = fromBuffer(mcl.G2, signature)
	if (pubkeys.length !== messageHashes.length) {
    throw new Error('number of pubkeys does not equal number of message hashes')
  }

  let ePH = pairing(pubkeyG1s[0], messageHashes[0], domain)
  for (let i = 1; i < messageHashes.length; i++) {
    ePH = mcl.mul(ePH, pairing(pubkeyG1s[i], messageHashes[i], domain))
  }
	return ePH.isEqual(mcl.pairing(g1(), signatureG2))
}

// Internal functions

/**
 * Utility function used to hash messageHash and domain to G2 and do a pairing with pubkey
 * @param {mcl.G1} pubkey
 * @param {bytes32} pubkey
 * @param {int} domain
 * @returns {mcl.GT}
 */
function pairing (pubkey, messageHash, domain) {
  return mcl.pairing(pubkey, hashToG2(messageHash, domain))
}

// Utility function to create a new mcl object from a buffer
// Used to create a mcl.G1, mcl.G2, mcl.Fp, etc.
function fromBuffer(mclType, buffer) {
  const object = new mclType()
  object.deserialize(buffer)
  return object
}

// Utility function to create a buffer from an mcl object
// Used to create a buffer from a mcl.G1, mcl.G2, mcl.Fp, etc.
function toBuffer(object) {
  return Buffer.from(object.serialize())
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
}
