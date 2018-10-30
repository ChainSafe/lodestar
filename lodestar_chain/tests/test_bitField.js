const assert = require('chai').assert;

const bitfield = require('../utils/bitfield.js');

describe('bitField',() => {
	it('should get empty bitfield', () => {
		let emptyBitField = bitfield.getEmptyBitfield(16);
		assert(emptyBitField.length == 2);
		let z = 0
		for (let i in emptyBitField){
			z = z&i
		}  
		assert (z == 0) 
	});

})
