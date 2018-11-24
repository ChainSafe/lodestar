class public_key {
	constructor(k: number) { };
	x: number;
	y: number;
}

class key {
	k: number; // private_key
	p: public_key; // public_key
}


var field_mod: number;

class field_element {
	f: number;
	constructor(n: number) {
		this.f = n % field_mod
	}
}

class Signature {
	keygen():public_key { 
		return new public_key(0);
	}
}
