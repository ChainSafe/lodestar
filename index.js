const mcl = require('mcl-wasm')
const bls = require('bls-wasm')

const setup = async() => {
	let curve = await mcl.init(mcl.BLS12_381)
	return curve
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


module.exports = {aggregate, verify}
