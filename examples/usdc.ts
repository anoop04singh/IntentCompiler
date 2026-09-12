import type { Definition } from "../src/spec.js";
export const usdc: Definition = {
  network: "mainnet",
  contracts: ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
  startBlock: 19000000,
  testStartBlock: 19000000,
  abiSource:
    "https://github.com/circlefin/stablecoin-evm/blob/master/contracts/interface/IERC20.sol",
  events: [
    {
      type: "event",
      name: "Transfer",
      anonymous: false,
      inputs: [
        { name: "from", type: "address", indexed: true },
        { name: "to", type: "address", indexed: true },
        { name: "value", type: "uint256", indexed: false },
      ],
    },
  ],
};
