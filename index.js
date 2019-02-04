const mcl = require('mcl-wasm')

// return base point of mcl.G1
const Q = () => {
	let P = new mcl.G1()
	P.setStr('1 3685416753713387016781088315183077757961620795782546409894578378688607592378376318836054947676345821548104185464507 1339506544944476473020471379941921221584933875938349620426543736416511423956333506472724655353366534992391756441569')
	return P
}

// return s: mcl.Fr
const gen_secret = () => {
	let s = new mcl.Fr()
	s.setByCSPRNG()
	return s
}

// s: mcl.Fr
// return P: mcl.G1
const gen_public = (s) => {
	let q = Q()
	return mcl.mul(q, s)
}

const getHexStr = (p) => {
	if (p instanceof mcl.Fr) {
		return '0x' + p.getStr(16)
	} else if (p instanceof mcl.G1) {
		let x = p.getStr(16).slice(2, 98)
		if (x.slice(95,96) === " ") return '0x0' + x.slice(95,96)
		else return '0x' + x
	}
}

// s:mcl.Fr
// msg:string
// return sig:mcl.G2
const sign = (s, msg) => {
	let hash = mcl.hashAndMapToG2(msg)
	return mcl.mul(hash, s)
}

// list can be either pubkeys:mcl.G1[] or signatures:mcl.G2[]
// if pubkeys, returns aggregated pubkey P:mcl.G1
// if signatures, returns aggregated signature Sig:mc;.G2
const aggregate = (list) => {
	let res = list[0]
	for (let i = 1; i < list.length; i++) {
		res = mcl.add(res, list[i])
	}
	return res
}

// pubkey:bls.PublicKey()
// message:string
// signature:bls.Signature()
// domain:uint
const verify = (pub, message, sig, domain) => {
	if (!(pub instanceof mcl.G1)) throw new Error('verify:wrong pubkey type')
	if (!(sig instanceof mcl.G2)) throw new Error('verify:wrong signature type')
	let msg = `${message}${domain}`
	let hash = mcl.hashAndMapToG2(msg)
	return mcl.pairing(pub, hash).isEqual(mcl.pairing(Q(), sig))
}

// pubkeys:list[mcl.G1]
// messages:list[string]
// signature:mcl.G2
// domain:int
const verify_multiple = (pubkeys, messages, signature, domain) => {
	pubkeys.map((pub) => {
        	if (!(pub instanceof mcl.G1)) throw new Error('verify_multiple:wrong pubkey type')
	})
	if (!(signature instanceof mcl.G2)) throw new Error('verify_multiple:wrong signature type')
	if (pubkeys.length !== messages.length) throw new Error('verify_multiple:number of pubkeys does not equal number of messages')

	let msg = `${messages[0]}${domain}`
	let hash = mcl.hashAndMapToG2(msg)
 	let ePH = mcl.pairing(pubkeys[0], hash)
	for(let i = 1; i < pubkeys.length; i++) {
		msg = `${messages[i]}${domain}`
		hash = mcl.hashAndMapToG2(msg)
		ePH = mcl.mul(ePH, mcl.pairing(pubkeys[i], hash))
	}

	return ePH.isEqual(mcl.pairing(Q(), signature))
}


module.exports = {Q, getHexStr, gen_secret, gen_public, aggregate, sign, verify, verify_multiple}
