/*

data stored as simple proof, classic proof, or ssz tree offset proof
use Proxy to override get and set to get "normal" interface

get ->
  translate get into path
  translate path into generalized index + length
  lookup generalized index chunk
  deserialize data
*/
