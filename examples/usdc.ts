import type { Definition } from "../src/spec.js";
export const usdc: Definition = {
  network: "sepolia",
  contracts: ["0x1c7d4b196cb0c7b01d743fbc6116a902379c7238"],
  startBlock: 11686714,
  testStartBlock: 11686714,
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
