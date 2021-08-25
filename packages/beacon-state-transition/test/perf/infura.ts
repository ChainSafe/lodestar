const INFURA_CREDENTIALS = "1sla4tyOFn0bB1ohyCKaH2sLmHu:b8cdb9d881039fd04fe982a5ec57b0b8";

export function getInfuraUrl(network: "mainnet" | "pyrmont" | "prater"): string {
  return `https://${INFURA_CREDENTIALS}@eth2-beacon-${network}.infura.io`;
}
