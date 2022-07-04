import { ethers } from "hardhat";

/**
 * Random helpful functions when running contract locally
 * 
 * Run with: npx hardhat run scripts/adhoc.ts --network localhost
 */

const contractAddress = "";

async function isSubscribed() {
    const [ownr, partner, partner2, ,usr3] = await ethers.getSigners();
    const Reg = await ethers.getContractFactory("Membership");
    const reg = Reg.attach(contractAddress);

    const isSubscribed = await reg.connect(usr3)["isSubscribed(address)"](partner.address);
    console.log("subed: " + isSubscribed)

    const isMember = await reg.connect(usr3)["isMember()"]();
    console.log("Is member: " + isMember)
}

async function becomePartner() {
    const [ownr, partner, partner2, ,usr3] = await ethers.getSigners();
    const Reg = await ethers.getContractFactory("Membership");
    const reg = Reg.attach(contractAddress);
    console.log(partner2.address)
    reg.connect(partner2).becomePartner(partner2.address, "Some bro");
}

async function sendFunds() {
    const [ownr] = await ethers.getSigners();

    const addy = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const tx = await ownr.sendTransaction({to: addy, value: ethers.utils.parseEther("5.5")})
    tx.wait();
}

async function main() {
    // await isSubscribed();
    await becomePartner();
    // await sendFunds();
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});