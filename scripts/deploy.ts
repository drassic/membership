import { ethers } from "hardhat";

/**
 * Deploy the membership
 * 
 * Deploy locally with: npx hardhat run scripts/deploy.ts --network localhost
 */

const fee = 10000000;
const lengthInBlocks = 60;

async function main() {
  const Membership = await ethers.getContractFactory("Membership");
  const membership = await Membership.deploy(fee + "", lengthInBlocks)
  await membership.deployed();

  console.log("Membership deployed to:", membership.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
