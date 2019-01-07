// BLS JS
// Copyright (C) 2018 ChainSafe Systems

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

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

class signature {
	keygen():public_key {
		return new public_key(0);
	}
}
