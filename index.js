const mcl = require('mcl-wasm')
const keccak256 = require('keccak256')

// return base point of mcl.G1
const Q = () => {
	let P = new mcl.G1()
	P.setStr('1 3685416753713387016781088315183077757961620795782546409894578378688607592378376318836054947676345821548104185464507 1339506544944476473020471379941921221584933875938349620426543736416511423956333506472724655353366534992391756441569')
	return P
}

// return 
const q = () => {
	let q = new mcl.Fr()
	q.setLittleEndian('409555221667393417789825735904156556882819939007885332058136124031650490837864442687629129015664037894272559787', 10)
	// todo: don't think this is correct
	//console.log(q.getStr(10))
	return q
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
		if (x.slice(95,96) == " ") return '0x0' + x.slice(0,95)
		else return '0x' + x
	}
}

// x:mcl.Fr
const modular_squareroot = (x) => {
	candidate = x ** (q() + 8)
	return null
}

// msg:string
// domain:int
const hash_to_G2 = (msg, domain) => {
	let x_re = keccak256(`${msg}${domain}01`)
	//console.log(x_re.toString('hex'))
	let x_im = keccak256(`${msg}${domain}02`)
	//console.log(x_im.toString('hex'))
	//let x_coordinate = [x_re, x_im]

	let done = false
	let y_re
	let y_im 

	while(!done) {
		let x_re_num = parseInt(x_re.toString('hex'), 16)
		let x_im_num = parseInt(x_im.toString('hex'), 16)
		let y_re_sq = x_re_num ** 3 + 4
		let y_im_sq = x_im_num ** 3 + 4
		y_re = modular_squareroot(y_re_sq)
		y_im = modular_squareroot(y_im_sq)

		if (y_re !== null && y_im !== null) done = true

		done = true
	}

	return [y_re, y_im]
}

// s:mcl.Fr
// msg:string
// return sig:mcl.G2
const sign = (s, msg, domain) => {
	let str = `${msg}${domain}`
	let hash = mcl.hashAndMapToG2(str)
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


module.exports = {Q, getHexStr, hash_to_G2, gen_secret, gen_public, aggregate, sign, verify, verify_multiple}
