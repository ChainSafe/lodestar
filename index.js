const mcl = require('mcl-wasm')
const bls = require('bls-wasm')

// return generator of mcl.G1
const g1 = () => {
	let g_x = "3685416753713387016781088315183077757961620795782546409894578378688607592378376318836054947676345821548104185464507"
	let g_y = "1339506544944476473020471379941921221584933875938349620426543736416511423956333506472724655353366534992391756441569"
	let g = new mcl.G1()
	g.setStr(`${g_x}${g_y}`)
	return g
}

const setup = async() => {
	let curve = await mcl.init(mcl.BLS12_381)
	return curve
}

// return s: mcl.Fr
const gen_secret = () => {
	return (new mcl.FR).setByCSPRNG()
}

// s: mcl.Fr
// return P: mcl.G1
const gen_public = (s) => {
	// todo: generator point for G1
	return mcl.mul(new mcl.G1(), s)
}

// s:mcl.Fr
// msg:string
// return sig:mcl.G2
const sign = (s, msg) => {
	let hash = mcl.hashAndMapToG2(msg)
	return mcl.mul(hash, s)
}

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
	if (!(pub instanceof bls.PublicKey)) throw new Error('verify:wrong pubkey type')
	if (!(sig instanceof bls.Signature)) throw new Error('verify:wrong signature type')
	let msg = `${message}${domain}`
	return pub.verify(sig, msg)
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

	// ned generator point for g1...
	let g = new mcl.G1()
	return ePH.isEqual(mcl.pairing(g, signature))
}


module.exports = {g1, aggregate, verify, verify_multiple}
