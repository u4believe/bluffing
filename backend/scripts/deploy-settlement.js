/**
 * scripts/deploy-settlement.js
 *
 * Compiles contracts/BlufflineSettlement.sol with solc and deploys it to
 * 0G Chain using ethers. Reads config from the environment (source .env first):
 *
 *   ZEROG_CHAIN_RPC_URL        RPC endpoint (required)
 *   ZEROG_SETTLER_PRIVATE_KEY  deployer key; also becomes the contract settler (required)
 *   SETTLER_ADDRESS            optional: use a different settler than the deployer
 *   DEPLOY=1                   safety gate — without it this only does a preflight
 *
 * Usage:
 *   set -a; . ./.env; set +a
 *   node scripts/deploy-settlement.js            # preflight: compile + balance check
 *   DEPLOY=1 node scripts/deploy-settlement.js   # actually broadcast the deployment
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.resolve(__dirname, "../contracts/BlufflineSettlement.sol");
const CONTRACT_NAME = "BlufflineSettlement";

const RPC = process.env.ZEROG_CHAIN_RPC_URL;
const PK = process.env.ZEROG_SETTLER_PRIVATE_KEY;
const SETTLER_OVERRIDE = process.env.SETTLER_ADDRESS;
const DO_DEPLOY = process.env.DEPLOY === "1";

function compile() {
  const source = fs.readFileSync(CONTRACT_PATH, "utf8");
  const input = {
    language: "Solidity",
    sources: { "BlufflineSettlement.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors || []).filter((e) => e.severity === "error");
  if (errors.length) {
    console.error(errors.map((e) => e.formattedMessage).join("\n"));
    throw new Error("solc compilation failed");
  }
  const c = out.contracts["BlufflineSettlement.sol"][CONTRACT_NAME];
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

async function main() {
  if (!RPC) throw new Error("ZEROG_CHAIN_RPC_URL not set (did you `source .env`?)");
  if (!PK) throw new Error("ZEROG_SETTLER_PRIVATE_KEY not set");

  const { abi, bytecode } = compile();
  console.log(`compiled ${CONTRACT_NAME}: ${(bytecode.length - 2) / 2} bytes of bytecode`);

  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  const wallet = new ethers.Wallet(PK, provider);
  const settler = SETTLER_OVERRIDE || wallet.address;
  const balance = await provider.getBalance(wallet.address);

  console.log(`\n--- preflight ---`);
  console.log(`RPC:               ${RPC}`);
  console.log(`chainId (on-chain):${net.chainId}`);
  console.log(`deployer address:  ${wallet.address}`);
  console.log(`settler arg:       ${settler}`);
  console.log(`deployer balance:  ${ethers.formatEther(balance)} 0G`);

  if (!DO_DEPLOY) {
    console.log(`\nPreflight only — no transaction sent. Re-run with DEPLOY=1 to broadcast.`);
    return;
  }
  if (balance === 0n) {
    throw new Error(`deployer has 0 balance — fund ${wallet.address} from faucet.0g.ai first`);
  }

  console.log(`\nbroadcasting deployment...`);
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(settler);
  const tx = contract.deploymentTransaction();
  console.log(`deploy tx hash: ${tx.hash}`);
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`\n✅ ${CONTRACT_NAME} deployed at: ${address}`);
  console.log(`\nNext: set this in backend/.env AND the WS server env:`);
  console.log(`  ZEROG_SETTLEMENT_CONTRACT_ADDRESS=${address}`);
}

main().catch((e) => {
  console.error("deploy failed:", e.message || e);
  process.exit(1);
});
