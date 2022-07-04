// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * A partner is someone a member can subscribe to.
 */
struct Partner {
    // the blocks that at least one subscriber's membership will expire
    uint[] blockExpiries;

    // list of addresses whose membership expire at the block number
    mapping(uint => address[]) blockToSubscribers;

    // optional
    string name; 
    address payable payTo;
    mapping(address => bool) owners;
}

/**
 * A member can subscribe to a partner's content if their membership is active.
 */
struct Member {
    uint expiresAtBlock;
    mapping(uint => uint) blockToSubscriptionCount;
}

/**
 * The Membership is a group of partners and members. 
 * The goal is to create a shared paywall across the web.
 * Decentralized but less exclusive than other paywalls. 
 * The Membership could act as a replacement for or supplement to ad monetization.
 *
 * A member pays a single fee to become a member. 
 * A member can subscribe to as many partners as they like.
 * 
 * A partner receives a portion of each of their subscriber's membership fee. 
 * This portion is proportional to how many partners the member subscribed to.
 *
 * Note: Members need to re-subscribe to a partner each membership period for that partner to receive any portion of their membership fee.
 */
contract Membership {

    // Membership fee
    uint private _fee;
    // Number of blocks that a new membership will be valid
    uint private _membershipLengthInBlocks;

    mapping(address => Member) private _addressToMember;
    mapping(address => Partner) private _addressToPartner;

    /**
     * Initialized the Membership
     * @param fee_ The Membership's fee
     * @param membershipLengthInBlocks_ Number of blocks till a member needs to re-apply
     */
    constructor(uint fee_, uint membershipLengthInBlocks_) {
        _fee = fee_;
        _membershipLengthInBlocks = membershipLengthInBlocks_;
    }

    /**
     * @param partner address to check
     * @return True if provided address belongs to a partner, false otherwise.
     */
    function isPartner(address partner) public view returns (bool) {
        return _addressToPartner[partner].payTo != address(0);
    }

    /**
     * @param partner address of partner to check
     * @param ownerToCheck address of owner to check
     * @return True if provided address has ownership rights to the partner, false otherwise.
     */
    function isOwner(address partner, address ownerToCheck) public view returns (bool) {
        return _addressToPartner[partner].owners[ownerToCheck];
    }

    /**
     * @param partner address of partner to check
     * @return True if the sender has ownership rights to the partner, false otherwise.
     */
    function isOwner(address partner) public view returns (bool) {
        return isOwner(partner, msg.sender);
    }

    /**
     * @return True if the sender is an active member, false otherwise.
     */
    function isMember() public view returns (bool) {
        return isMember(msg.sender);
    }

    /** 
     * @param member address to check
     * @return True if the provided address belongs to an active member, false otherwise.
     */
    function isMember(address member) public view returns (bool) {
        return _addressToMember[member].expiresAtBlock >= block.number;
    }

    /** 
     * @param partner address of partner to check
     * @return True if sender is currently subscribed to provided partner, false otherwise.
     */
    function isSubscribed(address partner) public view returns (bool) {
        return isSubscribed(msg.sender, partner);
    }

    /** 
     * @param member address of member to check
     * @param partner address of partner to check
     * @return True if provided member is currently subscribed to provided partner, false otherwise.
     */
    function isSubscribed(address member, address partner) public view returns (bool) {
        if (!isMember(member)) {
            return false;
        }
        uint expirationBlock = _addressToMember[member].expiresAtBlock;
        address[] memory subscribers = _addressToPartner[partner].blockToSubscribers[expirationBlock];
        for (uint i; i < subscribers.length; i++) {
            address c = subscribers[i];
            if (c == member) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return The current membership fee 
     */
    function getFee() public view returns (uint) {
        return _fee;
    }

    /**
     * Non-members call this to activate a membership and subscribe to their first partner
     * @param partner address the member will first subscribe to
     */
    function applyAndSubscribe(address partner) public payable {
        require(!isMember(msg.sender), "Already a member.");
        require(msg.value >= _fee, "Payment too low.");
        _addressToMember[msg.sender].expiresAtBlock = block.number + _membershipLengthInBlocks;
        subscribe(partner);
    }

    /**
     * Members call this to subscribe to new partners
     * @param partner address to subscribe to
     */
    function subscribe(address partner) public payable {
        require(isMember(msg.sender), "Not a member.");
        require(!isSubscribed(msg.sender, partner), "Already subscribed.");
        require(isPartner(partner), "Partner does not exist");
        uint expirationBlock = _addressToMember[msg.sender].expiresAtBlock;
        _addressToMember[msg.sender].blockToSubscriptionCount[expirationBlock]++;
        _addressToPartner[partner].blockToSubscribers[expirationBlock].push(msg.sender);
        if (_addressToPartner[partner].blockToSubscribers[expirationBlock].length == 1) {
            _addressToPartner[partner].blockExpiries.push(expirationBlock);
        }
    }

    /**
     * Call to become a partner
     * @param payTo the address to send payouts to
     * @param name human friendly name for partner
     */
    function becomePartner(address payable payTo, string memory name) public {
        require(!isPartner(msg.sender), "Partner already exists");
        _addressToPartner[msg.sender].owners[msg.sender] = true;
        updatePartner(msg.sender, payTo, name);
    }

    /**
     * Update partner data
     * @param partner address of partner to update
     * @param payTo new address to receive payments
     * @param name new human friendly name of partner
     */
    function updatePartner(address partner, address payable payTo, string memory name) public {
        require(isOwner(partner), "Not authorized owner");
        _addressToPartner[msg.sender].payTo = payTo;
        _addressToPartner[msg.sender].name = name;
    }

    /**
     * @param partner address
     * @return name of partner
     */
    function getPartnerName(address partner) public view returns (string memory) {
        return _addressToPartner[partner].name;
    }

    /**
     * Add an owner to the provided partner
     * @param partner address of partner to add owner to
     * @param owner address of new owner
     */
    function addOwner(address partner, address owner) public {
        require(isOwner(partner), "Not authorized owner");
        _addressToPartner[partner].owners[owner] = true;
    }

    /**
     * Remove owner from the provided partner
     * @param partner address of partner to remove owner from
     * @param owner address of owner to remove
     */
    function removeOwner(address partner, address owner) public {
        require(isOwner(partner), "Not authorized owner");
        _addressToPartner[partner].owners[owner] = false;
    }

    /**
     * Get payout from expired subscribers.
     * A partner is entitled to a portion of the membership fee of every member who subscribed to the partner.
     * This portion can only be accessed after that membership period is expired.
     *
     * Note: The payout will be sent to the `payTo` address for the partner, not the message sender.
     *
     * @param partnerAddress address of partner to initiate payout for
     */
    function payout(address partnerAddress) public {
        require(isOwner(partnerAddress), "Not authorized owner");

        Partner storage partner = _addressToPartner[partnerAddress];
        uint[] memory expiries = partner.blockExpiries;
        uint blockNumber = block.number;
        uint start = 0;
        for (uint i = 0; i < expiries.length; i++) {
            if (expiries[i] > blockNumber) {
                break;
            }

            start = i + 1;
            address[] memory subs = partner.blockToSubscribers[expiries[i]];
            for (uint j = 0; j < subs.length; j++) {
                uint payoutVal = getPayout(expiries[i], _addressToMember[subs[j]]);
                partner.payTo.transfer(payoutVal);
            }
        }

        sliceArray(partner.blockExpiries, start);
    }

    function getPayout(uint expiryBlock, Member storage member) internal view returns (uint) {
        uint count = member.blockToSubscriptionCount[expiryBlock];
        return _fee / count;
    }

    function sliceArray(uint[] storage arr, uint start) internal {

       if (start == 0) return;

       for (uint i = 0; i + start < arr.length; i++) {
           arr[i] = arr[start + i];
       }

       for (uint i = arr.length - start; i < arr.length; i) {
           arr.pop();
       }
    }
}
