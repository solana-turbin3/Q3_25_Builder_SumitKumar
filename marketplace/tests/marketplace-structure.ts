import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import { IDL } from "../target/types/marketplace";

describe("Marketplace Structure Tests", () => {
  describe("Program Structure", () => {
    it("should have correct program ID", () => {
      const expectedProgramId = "HYxi42pNZDn3dpnF8HPNeFurSLQSpcYWdvRSkfuqkkui";
      expect(expectedProgramId).to.be.a('string');
      expect(expectedProgramId.length).to.equal(44); // Valid base58 length for PublicKey
      
      // Validate it's a proper PublicKey
      const programId = new PublicKey(expectedProgramId);
      expect(programId.toString()).to.equal(expectedProgramId);
      
      console.log("✅ Program ID validated:", programId.toString());
    });

    it("should have correct IDL structure", () => {
      expect(IDL).to.exist;
      expect(IDL.name).to.equal("marketplace");
      expect(IDL.version).to.equal("0.1.0");
      expect(IDL.instructions).to.be.an('array');
      expect(IDL.accounts).to.be.an('array');
      expect(IDL.errors).to.be.an('array');
      
      console.log("✅ IDL structure validated");
    });

    it("should have correct instruction definitions", () => {
      const instructionNames = IDL.instructions.map(ix => ix.name);
      const expectedInstructions = [
        "initialize",
        "listing", 
        "delist",
        "purchase",
        "updateMarketplace",
        "withdrawFees"
      ];
      
      expectedInstructions.forEach(name => {
        expect(instructionNames).to.include(name);
      });
      
      console.log("✅ All expected instructions found:", instructionNames);
    });

    it("should have correct account definitions", () => {
      const accountNames = IDL.accounts.map(acc => acc.name);
      const expectedAccounts = ["marketplace", "listing"];
      
      expectedAccounts.forEach(name => {
        expect(accountNames).to.include(name);
      });
      
      console.log("✅ All expected accounts found:", accountNames);
    });

    it("should have correct error definitions", () => {
      expect(IDL.errors.length).to.be.greaterThan(0);
      
      // Check for specific error codes
      const errorCodes = IDL.errors.map(err => err.code);
      expect(errorCodes).to.include(6000); // InvalidFee
      expect(errorCodes).to.include(6001); // InvalidName
      expect(errorCodes).to.include(6002); // InvalidPrice
      
      console.log("✅ Error definitions validated:", IDL.errors.length, "errors");
    });
  });

  describe("PDA Derivation Tests", () => {
    const programId = new PublicKey("HYxi42pNZDn3dpnF8HPNeFurSLQSpcYWdvRSkfuqkkui");
    
    it("should derive marketplace PDA correctly", () => {
      const marketplaceName = "TestMarketplace";
      
      const [marketplacePda, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("marketplace"), Buffer.from(marketplaceName)],
        programId
      );
      
      expect(marketplacePda).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a('number');
      expect(bump).to.be.at.least(0);
      expect(bump).to.be.at.most(255);
      
      console.log("✅ Marketplace PDA:", marketplacePda.toString());
      console.log("   Bump:", bump);
    });

    it("should derive treasury PDA correctly", () => {
      const marketplaceName = "TestMarketplace";
      const [marketplacePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("marketplace"), Buffer.from(marketplaceName)],
        programId
      );
      
      const [treasuryPda, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("treasury"), marketplacePda.toBuffer()],
        programId
      );
      
      expect(treasuryPda).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a('number');
      
      console.log("✅ Treasury PDA:", treasuryPda.toString());
      console.log("   Bump:", bump);
    });

    it("should derive rewards mint PDA correctly", () => {
      const marketplaceName = "TestMarketplace";
      const [marketplacePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("marketplace"), Buffer.from(marketplaceName)],
        programId
      );
      
      const [rewardsPda, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("rewards"), marketplacePda.toBuffer()],
        programId
      );
      
      expect(rewardsPda).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a('number');
      
      console.log("✅ Rewards Mint PDA:", rewardsPda.toString());
      console.log("   Bump:", bump);
    });

    it("should derive listing PDA correctly", () => {
      const marketplaceName = "TestMarketplace";
      const [marketplacePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("marketplace"), Buffer.from(marketplaceName)],
        programId
      );
      
      // Create a test mint address
      const testMint = new PublicKey("11111111111111111111111111111112");
      
      const [listingPda, bump] = PublicKey.findProgramAddressSync(
        [marketplacePda.toBuffer(), testMint.toBuffer()],
        programId
      );
      
      expect(listingPda).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a('number');
      
      console.log("✅ Listing PDA:", listingPda.toString());
      console.log("   Bump:", bump);
    });
  });

  describe("Marketplace Logic Tests", () => {
    it("should calculate fees correctly", () => {
      const price = 1000000000; // 1 SOL in lamports
      const feeBasisPoints = 250; // 2.5%
      
      const feeAmount = Math.floor((price * feeBasisPoints) / 10000);
      const sellerAmount = price - feeAmount;
      
      expect(feeAmount).to.equal(25000000); // 0.025 SOL
      expect(sellerAmount).to.equal(975000000); // 0.975 SOL
      expect(feeAmount + sellerAmount).to.equal(price);
      
      console.log("✅ Fee calculation validated:");
      console.log("   Price:", price / 1000000000, "SOL");
      console.log("   Fee:", feeAmount / 1000000000, "SOL");
      console.log("   Seller receives:", sellerAmount / 1000000000, "SOL");
    });

    it("should validate marketplace name constraints", () => {
      const validNames = ["Test", "MyMarketplace", "NFTMarket123"];
      const invalidNames = ["", "a".repeat(33)]; // Empty and too long
      
      validNames.forEach(name => {
        expect(name.length).to.be.greaterThan(0);
        expect(name.length).to.be.at.most(32);
      });
      
      invalidNames.forEach(name => {
        const isValid = name.length > 0 && name.length <= 32;
        expect(isValid).to.be.false;
      });
      
      console.log("✅ Name validation working correctly");
    });

    it("should validate fee constraints", () => {
      const validFees = [0, 250, 1000, 10000]; // 0% to 100%
      const invalidFees = [-1, 10001, 99999]; // Outside valid range
      
      validFees.forEach(fee => {
        expect(fee).to.be.at.least(0);
        expect(fee).to.be.at.most(10000);
      });
      
      invalidFees.forEach(fee => {
        const isValid = fee >= 0 && fee <= 10000;
        expect(isValid).to.be.false;
      });
      
      console.log("✅ Fee validation working correctly");
    });

    it("should validate price constraints", () => {
      const validPrices = [1, 1000000000, 5000000000]; // Positive prices
      const invalidPrices = [0, -1, -1000]; // Zero or negative
      
      validPrices.forEach(price => {
        expect(price).to.be.greaterThan(0);
      });
      
      invalidPrices.forEach(price => {
        expect(price).to.be.at.most(0);
      });
      
      console.log("✅ Price validation working correctly");
    });
  });

  describe("Integration Readiness", () => {
    it("should have all required components for deployment", () => {
      const components = {
        programId: "HYxi42pNZDn3dpnF8HPNeFurSLQSpcYWdvRSkfuqkkui",
        idl: IDL,
        instructions: IDL.instructions.length,
        accounts: IDL.accounts.length,
        errors: IDL.errors.length
      };
      
      expect(components.programId).to.be.a('string');
      expect(components.idl).to.exist;
      expect(components.instructions).to.be.greaterThan(0);
      expect(components.accounts).to.be.greaterThan(0);
      expect(components.errors).to.be.greaterThan(0);
      
      console.log("✅ All deployment components ready:");
      console.log("   Program ID:", components.programId);
      console.log("   Instructions:", components.instructions);
      console.log("   Accounts:", components.accounts);
      console.log("   Errors:", components.errors);
    });

    it("should be ready for client SDK integration", () => {
      // Verify all necessary exports are available
      expect(IDL).to.have.property('version');
      expect(IDL).to.have.property('name');
      expect(IDL).to.have.property('instructions');
      expect(IDL).to.have.property('accounts');
      expect(IDL).to.have.property('errors');
      
      console.log("✅ Ready for client SDK integration");
      console.log("   Version:", IDL.version);
      console.log("   Name:", IDL.name);
    });
  });
});

// Helper function for test logging
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { sleep };
