import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { fail } from "assert";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Membership } from "../typechain";

// Some tests are built assuming this is 10
const MEMBERSHIP_LENGTH = 10;

describe("Membership", function () {

  it("Should become a partner", async function () {
    const m = await deployMembership();
    const [_, partner] = await ethers.getSigners();
    expect(await m.connect(partner).isPartner(partner.address)).to.be.false;
    await m.connect(partner).becomePartner(partner.address, "Some Body");

    expect(await m.connect(partner).isPartner(partner.address)).to.be.true;
  });

  it("Should update partner name", async function () {
    const m = await deployMembership();
    const [_, partner, member] = await ethers.getSigners();
    await m.connect(partner).becomePartner(partner.address, "Some Body");

    expect(await m.getPartnerName(partner.address)).to.eq("Some Body");
    const tx1 = await m.connect(partner).updatePartner(partner.address, member.address, "Hello World");
    tx1.wait();
    expect(await m.getPartnerName(partner.address)).to.eq("Hello World");
  });

  it("Should add and remove owner", async function () {
    async function checkOwnership(m: Membership, partner: string, member: SignerWithAddress, result: boolean) {
      expect(await m.connect(member)["isOwner(address)"](partner)).to.eq(result)
      expect(await m["isOwner(address,address)"](partner, member.address)).to.eq(result);
    }

    const m = await deployMembership();
    const [_, partner, member] = await ethers.getSigners();
    await m.connect(partner).becomePartner(partner.address, "Some Body");

    await checkOwnership(m, partner.address, partner, true);
    await checkOwnership(m, partner.address, member, false);
    await m.connect(partner).addOwner(partner.address, member.address);

    await checkOwnership(m, partner.address, partner, true);
    await checkOwnership(m, partner.address, member, true);
    await m.connect(member).removeOwner(partner.address, partner.address);

    await checkOwnership(m, partner.address, partner, false);
    await checkOwnership(m, partner.address, member, true);
  });

  it("Should restrict access to ownerOnly methods", async function () {
    async function tryRestrictedOperations(m: Membership, partner: string, member: SignerWithAddress, shouldFail: boolean) {
      let failures = 0;
      let attemtps = 4; // number of restricted methods
      try { await m.connect(member).updatePartner(partner, member.address, "hello") } catch (e) { failures += 1; }
      try { await m.connect(member).addOwner(partner, member.address) } catch (e) { failures += 1; }
      try { await m.connect(member).payout(partner) } catch (e) { failures += 1; }
      try { await m.connect(member).removeOwner(partner, partner) } catch (e) { failures += 1; }
      if (shouldFail) {
        expect(failures).to.eq(attemtps)
      } else {
        expect(failures).to.eq(0);
      }
    }

    const m = await deployMembership();
    const [_, partner, member] = await ethers.getSigners();
    await m.connect(partner).becomePartner(partner.address, "Some Body");

    await tryRestrictedOperations(m, partner.address, member, true);
    await m.connect(partner).addOwner(partner.address, member.address);

    await tryRestrictedOperations(m, partner.address, member, false);
  });

  it("Should receive payment from single subscriber", async function () {
    const m = await deployMembership();
    const [_, partner, member, partner2] = await ethers.getSigners();
    await m.connect(partner).becomePartner(partner.address, "Some Body");
    await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() + "" });
    // Add partner2 so that gasFees don't mess up calculations
    await m.connect(partner).addOwner(partner.address, partner2.address);
    const initialBalance = await partner.getBalance();
    await m.connect(partner2).payout(partner.address);
    expect(await partner.getBalance()).to.eq(initialBalance);
    await simulateBlocks(15);
    await m.connect(partner2).payout(partner.address);
    expect(await partner.getBalance()).to.eq(initialBalance.add(BigNumber.from(getFee())));
  });

  it("Should receive payment from multiple and repeat subscribers", async function () {
    const m = await deployMembership();
    const [_, partner, member, partner2, member2, member3] = await ethers.getSigners();
    await m.connect(partner).becomePartner(partner.address, "Some Body");
    await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() + "" });
    await m.connect(member2).applyAndSubscribe(partner.address, { value: getFee() + "" });
    await simulateBlocks(2);
    await m.connect(member3).applyAndSubscribe(partner.address, { value: getFee() + "" });
    await simulateBlocks(15);
    await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() + "" });
    // Add partner2 so that gasFees don't mess up calculations
    await m.connect(partner).addOwner(partner.address, partner2.address);
    const initialBalance = await partner.getBalance();
    await simulateBlocks(15);
    await m.connect(partner2).payout(partner.address);
    expect(await partner.getBalance()).to.eq(initialBalance.add(BigNumber.from(4 * getFee())));
  });

  it("Should receive payment only from expired subscriptions, but in order of subscriptions", async function () {
    const m = await deployMembership();
    const [_, partner, member, partner2, member2, member3] = await ethers.getSigners();
    await m.connect(partner).becomePartner(partner.address, "Some Body");
    await m.connect(partner2).becomePartner(partner2.address, "Some Body");
    await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() + "" });
    await simulateBlocks(1);
    await m.connect(member2).applyAndSubscribe(partner2.address, { value: getFee() + "" });
    await simulateBlocks(2);
    // member2 membership will expire before member3
    await m.connect(member3).applyAndSubscribe(partner.address, { value: getFee() + "" });
    // but member2 is subscribed after member3 so funds won't be released until after member3 membership expires
    await m.connect(member2).subscribe(partner.address, { value: getFee() + "" });
    // membership 1 and 2 should be expired but only funds from member1 will be available
    await simulateBlocks(5);
    // Add partner2 so that gasFees don't mess up calculations
    await m.connect(partner).addOwner(partner.address, partner2.address);
    const initialBalance = await partner.getBalance();
    await m.connect(partner2).payout(partner.address);
    expect(await partner.getBalance()).to.eq(initialBalance.add(BigNumber.from(1 * getFee())));
    await simulateBlocks(5);
    // now remaining funds are released
    await m.connect(partner2).payout(partner.address);
    expect((await partner.getBalance()).sub(initialBalance.add(BigNumber.from(2.5 * getFee())))).to.eq(0);
  });
});

describe("Member tests", function () {
  it("Should become member and subscribe to partner", async function () {
    const m = await deployMembership();
    const [_, partner, member] = await ethers.getSigners();
    await m.connect(partner).becomePartner(partner.address, "Some Body");

    await checkMembership(m, partner, member, false);
    await checkSubsription(m, partner, member, false);
    await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() + "" });

    await checkMembership(m, partner, member, true);
    await checkSubsription(m, partner, member, true);
  });

  it("Should not become member if already member", async function () {
    const m = await deployMembership();
    const [_, partner, member] = await ethers.getSigners();
    await m.connect(partner).becomePartner(partner.address, "Some Body");

    await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() + "" });

    let shouldFail = true;
    try {
      await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() + "" });

    } catch (e) {
      shouldFail = false;
    }
    if (shouldFail) fail("Should not be able to become member again");
  });

  it("Should become a member if membership expired", async function () {
    const m = await deployMembership();
    const [_, partner, member] = await ethers.getSigners();
    await m.connect(partner).becomePartner(partner.address, "Some Body");

    await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() + "" });

    await checkMembership(m, partner, member, true);
    await simulateBlocks(15);
    await checkMembership(m, partner, member, false);
    await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() + "" });

    await checkMembership(m, partner, member, true);
  })

  it("Should not become member if payment too low", async function () {
    const m = await deployMembership();
    const [_, partner, member] = await ethers.getSigners();
    await m.connect(partner).becomePartner(partner.address, "Some Body");

    let shouldFail = true;
    try {
      await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() - 100 + "" });

    } catch (e) {
      shouldFail = false;
    }
    if (shouldFail) fail("Membership was successful");
  })

  it("Should subscribe to partner", async function () {
    const m = await deployMembership();
    const [_, partner, member, partner2] = await ethers.getSigners();
    await m.connect(partner).becomePartner(partner.address, "Some Body");

    await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() + "" });

    await checkSubsription(m, partner, member, true);
    await m.connect(partner2).becomePartner(partner2.address, "Different Body");

    await checkSubsription(m, partner2, member, false);
    await m.connect(member).subscribe(partner2.address);

    await checkSubsription(m, partner2, member, true);
  });

  it("Should not re-subsrcibe during current membership", async function () {
    const m = await deployMembership();
    const [_, partner, member, partner2] = await ethers.getSigners();
    await m.connect(partner).becomePartner(partner.address, "Some Body");

    await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() + "" });

    await m.connect(partner2).becomePartner(partner2.address, "Different Body");

    await m.connect(member).subscribe(partner2.address);

    let shouldFail = true;
    try {
      await m.connect(member).subscribe(partner2.address);

    } catch (e) {
      shouldFail = false;
    }
    if (shouldFail) fail("Should not be able to resubscribe");
  });

  it("Should re-subscribe if new membership is active", async function () {
    const m = await deployMembership();
    const [_, partner, member, partner2] = await ethers.getSigners();
    await m.connect(partner).becomePartner(partner.address, "Some Body");

    await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() + "" });

    await m.connect(partner2).becomePartner(partner2.address, "Different Body");

    await m.connect(member).subscribe(partner2.address);

    checkSubsription(m, partner, member, true);
    checkSubsription(m, partner2, member, true);
    await simulateBlocks(15);
    checkSubsription(m, partner, member, false);
    checkSubsription(m, partner2, member, false);
    await m.connect(member).applyAndSubscribe(partner.address, { value: getFee() + "" });

    await m.connect(member).subscribe(partner2.address);

    checkSubsription(m, partner, member, true);
    checkSubsription(m, partner2, member, true);
  })
})

async function simulateBlocks(n: number) {
  for (let i = 0; i < n; i++) {
    await ethers.provider.send("evm_mine", []);
  }
}

async function checkMembership(m: Membership, partner: SignerWithAddress, member: SignerWithAddress, shouldBeMember: boolean) {
  expect(await m.connect(member)["isMember()"]()).to.eq(shouldBeMember);
  expect(await m.connect(partner)["isMember(address)"](member.address)).to.eq(shouldBeMember);
}

async function checkSubsription(m: Membership, partner: SignerWithAddress, member: SignerWithAddress, shouldBeSubscribed: boolean) {
  expect(await m.connect(member)["isSubscribed(address)"](partner.address)).to.eq(shouldBeSubscribed);
  expect(await m.connect(partner)["isSubscribed(address,address)"](member.address, partner.address)).to.eq(shouldBeSubscribed);
}

async function deployMembership(): Promise<Membership> {
  const Membership = await ethers.getContractFactory("Membership");
  const m = await Membership.deploy(getFee() + "", MEMBERSHIP_LENGTH);
  await m.deployed();
  return m;
}

function getFee() {
  return 100000;
}
