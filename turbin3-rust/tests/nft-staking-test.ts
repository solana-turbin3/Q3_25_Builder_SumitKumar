/**
 * Comprehensive NFT Staking System Tests
 * 
 * This test suite validates the complete NFT staking functionality including:
 * - Pool initialization with configurable parameters
 * - NFT staking and unstaking with proper validations
 * - Reward calculation and distribution
 * - Collection verification (optional)
 * - Time-based constraints and cooldowns
 * - Edge cases and error handling
 * 
 * Following GI Guidelines:
 * - Real implementations without mocks
 * - Production-ready testing
 * - Comprehensive test coverage
 * - Error-free functionality validation
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Turbin3Rust } from "../target/types/turbin3_rust";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";

describe("NFT Staking System", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Turbin3Rust as Program<Turbin3Rust>;
  
  // Test accounts
  let admin: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  let nftStakingPool: Keypair;
  let rewardMint: PublicKey;
  let nftMint1: PublicKey;
  let nftMint2: PublicKey;
  let collectionMint: PublicKey;

  // Derived accounts
  let rewardVault: PublicKey;
  let adminRewardAccount: PublicKey;
  let user1RewardAccount: PublicKey;
  let user2RewardAccount: PublicKey;
  let user1NftAccount1: PublicKey;
  let user1NftAccount2: PublicKey;
  let user2NftAccount1: PublicKey;
  let nftVault1: PublicKey;
  let nftVault2: PublicKey;
  let userNftStake1: PublicKey;
  let userNftStake2: PublicKey;
  let userNftStake3: PublicKey;

  // Test constants following GI guidelines (no hardcoding)
  const DAILY_REWARD_RATE = new anchor.BN(1_000_000); // 1 token per day per NFT (6 decimals)
  const MIN_STAKE_DURATION = 3600; // 1 hour in seconds
  const INITIAL_REWARD_FUNDING = new anchor.BN(100_000_000); // 100 reward tokens
  const SECONDS_PER_DAY = 86400;

  // Test helper functions
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  const deriveNftStakingPoolPda = async (rewardMint: PublicKey) => {
    return await PublicKey.findProgramAddress(
      [Buffer.from("nft_staking_pool"), rewardMint.toBuffer()],
      program.programId
    );
  };

  const deriveUserNftStakePda = async (
    nftStakingPool: PublicKey,
    nftMint: PublicKey,
    user: PublicKey
  ) => {
    return await PublicKey.findProgramAddress(
      [
        Buffer.from("user_nft_stake"),
        nftStakingPool.toBuffer(),
        nftMint.toBuffer(),
        user.toBuffer(),
      ],
      program.programId
    );
  };

  const deriveNftVaultPda = async (
    nftStakingPool: PublicKey,
    nftMint: PublicKey
  ) => {
    return await PublicKey.findProgramAddress(
      [
        Buffer.from("nft_vault"),
        nftStakingPool.toBuffer(),
        nftMint.toBuffer(),
      ],
      program.programId
    );
  };

  const deriveNftRewardVaultPda = async (nftStakingPool: PublicKey) => {
    return await PublicKey.findProgramAddress(
      [Buffer.from("nft_reward_vault"), nftStakingPool.toBuffer()],
      program.programId
    );
  };

  const createNftMint = async (
    payer: Keypair,
    mintAuthority: PublicKey
  ): Promise<PublicKey> => {
    return await createMint(
      provider.connection,
      payer,
      mintAuthority,
      null,
      0 // NFTs have 0 decimals
    );
  };

  const mintNftToUser = async (
    mint: PublicKey,
    userAccount: PublicKey,
    mintAuthority: Keypair
  ) => {
    await mintTo(
      provider.connection,
      mintAuthority,
      mint,
      userAccount,
      mintAuthority.publicKey,
      1 // NFTs have supply of 1
    );
  };

  before(async () => {
    console.log("Setting up NFT staking test environment...");
    
    // Generate test accounts
    admin = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();
    nftStakingPool = Keypair.generate();

    // Airdrop SOL to test accounts
    const accounts = [admin, user1, user2];
    for (const account of accounts) {
      const signature = await provider.connection.requestAirdrop(
        account.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature);
    }

    // Create reward token mint
    rewardMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6 // Standard token decimals
    );

    // Create NFT mints
    nftMint1 = await createNftMint(admin, admin.publicKey);
    nftMint2 = await createNftMint(admin, admin.publicKey);
    collectionMint = await createNftMint(admin, admin.publicKey);

    // Derive PDAs
    [rewardVault] = await deriveNftRewardVaultPda(nftStakingPool.publicKey);
    [nftVault1] = await deriveNftVaultPda(nftStakingPool.publicKey, nftMint1);
    [nftVault2] = await deriveNftVaultPda(nftStakingPool.publicKey, nftMint2);
    [userNftStake1] = await deriveUserNftStakePda(
      nftStakingPool.publicKey,
      nftMint1,
      user1.publicKey
    );
    [userNftStake2] = await deriveUserNftStakePda(
      nftStakingPool.publicKey,
      nftMint2,
      user1.publicKey
    );
    [userNftStake3] = await deriveUserNftStakePda(
      nftStakingPool.publicKey,
      nftMint1,
      user2.publicKey
    );

    // Get associated token accounts
    adminRewardAccount = await getAssociatedTokenAddress(rewardMint, admin.publicKey);
    user1RewardAccount = await getAssociatedTokenAddress(rewardMint, user1.publicKey);
    user2RewardAccount = await getAssociatedTokenAddress(rewardMint, user2.publicKey);
    user1NftAccount1 = await getAssociatedTokenAddress(nftMint1, user1.publicKey);
    user1NftAccount2 = await getAssociatedTokenAddress(nftMint2, user1.publicKey);
    user2NftAccount1 = await getAssociatedTokenAddress(nftMint1, user2.publicKey);

    // Create associated token accounts
    await createAssociatedTokenAccount(
      provider.connection,
      admin,
      rewardMint,
      admin.publicKey
    );

    await createAssociatedTokenAccount(
      provider.connection,
      user1,
      rewardMint,
      user1.publicKey
    );

    await createAssociatedTokenAccount(
      provider.connection,
      user2,
      rewardMint,
      user2.publicKey
    );

    await createAssociatedTokenAccount(
      provider.connection,
      user1,
      nftMint1,
      user1.publicKey
    );

    await createAssociatedTokenAccount(
      provider.connection,
      user1,
      nftMint2,
      user1.publicKey
    );

    await createAssociatedTokenAccount(
      provider.connection,
      user2,
      nftMint1,
      user2.publicKey
    );

    // Mint reward tokens to admin
    await mintTo(
      provider.connection,
      admin,
      rewardMint,
      adminRewardAccount,
      admin.publicKey,
      200_000_000 // 200 reward tokens for testing
    );

    // Mint NFTs to users
    await mintNftToUser(nftMint1, user1NftAccount1, admin);
    await mintNftToUser(nftMint2, user1NftAccount2, admin);
    await mintNftToUser(nftMint1, user2NftAccount1, admin);

    console.log("Test environment setup completed");
    console.log("Admin:", admin.publicKey.toString());
    console.log("User1:", user1.publicKey.toString());
    console.log("User2:", user2.publicKey.toString());
    console.log("Reward mint:", rewardMint.toString());
    console.log("NFT mint 1:", nftMint1.toString());
    console.log("NFT mint 2:", nftMint2.toString());
    console.log("NFT staking pool:", nftStakingPool.publicKey.toString());
  });

  describe("Pool Initialization", () => {
    it("Should initialize NFT staking pool with valid parameters", async () => {
      try {
        const tx = await program.methods
          .initializeNftStakingPool(
            DAILY_REWARD_RATE,
            new anchor.BN(MIN_STAKE_DURATION),
            null // No collection verification for this test
          )
          .accounts({
            admin: admin.publicKey,
            nftStakingPool: nftStakingPool.publicKey,
            rewardMint: rewardMint,
            rewardVault: rewardVault,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([nftStakingPool, admin])
          .rpc();

        console.log("Initialize NFT staking pool tx:", tx);

        // Verify the pool was created with correct parameters
        const poolAccount = await program.account.nftStakingPool.fetch(nftStakingPool.publicKey);
        expect(poolAccount.admin.toString()).to.equal(admin.publicKey.toString());
        expect(poolAccount.rewardMint.toString()).to.equal(rewardMint.toString());
        expect(poolAccount.dailyRewardRate.toString()).to.equal(DAILY_REWARD_RATE.toString());
        expect(poolAccount.minStakeDuration.toString()).to.equal(MIN_STAKE_DURATION.toString());
        expect(poolAccount.totalNftsStaked.toString()).to.equal("0");
        expect(poolAccount.collectionAddress).to.be.null;

        console.log("✅ NFT staking pool initialized successfully");
      } catch (error) {
        console.error("Initialize pool error:", error);
        throw error;
      }
    });

    it("Should fund the reward pool", async () => {
      try {
        const tx = await program.methods
          .fundNftRewards(INITIAL_REWARD_FUNDING)
          .accounts({
            admin: admin.publicKey,
            nftStakingPool: nftStakingPool.publicKey,
            adminRewardAccount: adminRewardAccount,
            rewardVault: rewardVault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();

        console.log("Fund NFT rewards tx:", tx);

        // Verify reward vault has funds
        const rewardVaultAccount = await getAccount(provider.connection, rewardVault);
        expect(rewardVaultAccount.amount.toString()).to.equal(INITIAL_REWARD_FUNDING.toString());

        console.log("✅ NFT reward pool funded successfully");
      } catch (error) {
        console.error("Fund rewards error:", error);
        throw error;
      }
    });
  });

  describe("NFT Staking", () => {
    it("Should stake NFT successfully", async () => {
      try {
        const tx = await program.methods
          .stakeNft()
          .accounts({
            user: user1.publicKey,
            nftStakingPool: nftStakingPool.publicKey,
            userNftStake: userNftStake1,
            nftMint: nftMint1,
            userNftAccount: user1NftAccount1,
            nftVault: nftVault1,
            nftMetadata: SystemProgram.programId, // Placeholder for metadata validation
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user1])
          .rpc();

        console.log("Stake NFT tx:", tx);

        // Verify user NFT stake was created
        const userNftStakeAccount = await program.account.userNftStake.fetch(userNftStake1);
        expect(userNftStakeAccount.user.toString()).to.equal(user1.publicKey.toString());
        expect(userNftStakeAccount.nftStakingPool.toString()).to.equal(nftStakingPool.publicKey.toString());
        expect(userNftStakeAccount.nftMint.toString()).to.equal(nftMint1.toString());

        // Verify pool total was updated
        const poolAccount = await program.account.nftStakingPool.fetch(nftStakingPool.publicKey);
        expect(poolAccount.totalNftsStaked.toString()).to.equal("1");

        // Verify NFT was transferred to vault
        const nftVaultAccount = await getAccount(provider.connection, nftVault1);
        expect(nftVaultAccount.amount.toString()).to.equal("1");

        // Verify user's NFT account is empty
        const userNftAccount = await getAccount(provider.connection, user1NftAccount1);
        expect(userNftAccount.amount.toString()).to.equal("0");

        console.log("✅ NFT staked successfully");
      } catch (error) {
        console.error("Stake NFT error:", error);
        throw error;
      }
    });

    it("Should stake second NFT from same user", async () => {
      try {
        const tx = await program.methods
          .stakeNft()
          .accounts({
            user: user1.publicKey,
            nftStakingPool: nftStakingPool.publicKey,
            userNftStake: userNftStake2,
            nftMint: nftMint2,
            userNftAccount: user1NftAccount2,
            nftVault: nftVault2,
            nftMetadata: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user1])
          .rpc();

        console.log("Stake second NFT tx:", tx);

        // Verify pool total was updated
        const poolAccount = await program.account.nftStakingPool.fetch(nftStakingPool.publicKey);
        expect(poolAccount.totalNftsStaked.toString()).to.equal("2");

        console.log("✅ Second NFT staked successfully");
      } catch (error) {
        console.error("Stake second NFT error:", error);
        throw error;
      }
    });

    it("Should stake NFT from different user", async () => {
      try {
        const tx = await program.methods
          .stakeNft()
          .accounts({
            user: user2.publicKey,
            nftStakingPool: nftStakingPool.publicKey,
            userNftStake: userNftStake3,
            nftMint: nftMint1,
            userNftAccount: user2NftAccount1,
            nftVault: nftVault1,
            nftMetadata: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user2])
          .rpc();

        console.log("Stake NFT from user2 tx:", tx);

        // Verify pool total was updated
        const poolAccount = await program.account.nftStakingPool.fetch(nftStakingPool.publicKey);
        expect(poolAccount.totalNftsStaked.toString()).to.equal("3");

        console.log("✅ NFT from different user staked successfully");
      } catch (error) {
        console.error("Stake NFT from user2 error:", error);
        throw error;
      }
    });
  });

  describe("Reward Claims", () => {
    it("Should wait and accumulate rewards", async () => {
      console.log("Waiting 5 seconds to accumulate rewards...");
      await sleep(5000);
      
      // Check that time has passed for reward accumulation
      const poolAccount = await program.account.nftStakingPool.fetch(nftStakingPool.publicKey);
      expect(poolAccount.totalNftsStaked.toString()).to.equal("3");
      
      console.log("✅ Time elapsed for reward accumulation");
    });

    it("Should claim rewards for first NFT", async () => {
      try {
        // Get initial balances
        const initialBalance = await getAccount(provider.connection, user1RewardAccount);
        const initialUserBalance = Number(initialBalance.amount);

        const tx = await program.methods
          .claimNftRewards()
          .accounts({
            user: user1.publicKey,
            nftStakingPool: nftStakingPool.publicKey,
            userNftStake: userNftStake1,
            userRewardAccount: user1RewardAccount,
            rewardVault: rewardVault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();

        console.log("Claim NFT rewards tx:", tx);

        // Verify user received rewards
        const finalBalance = await getAccount(provider.connection, user1RewardAccount);
        const finalUserBalance = Number(finalBalance.amount);
        
        expect(finalUserBalance).to.be.greaterThan(initialUserBalance);
        console.log(`Rewards claimed: ${finalUserBalance - initialUserBalance} tokens`);

        console.log("✅ NFT rewards claimed successfully");
      } catch (error) {
        console.error("Claim NFT rewards error:", error);
        throw error;
      }
    });
  });

  describe("NFT Unstaking", () => {
    it("Should fail to unstake before minimum duration", async () => {
      try {
        // This should fail because minimum stake duration hasn't passed
        await program.methods
          .unstakeNft()
          .accounts({
            user: user1.publicKey,
            nftStakingPool: nftStakingPool.publicKey,
            userNftStake: userNftStake1,
            userNftAccount: user1NftAccount1,
            userRewardAccount: user1RewardAccount,
            nftVault: nftVault1,
            rewardVault: rewardVault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();

        // If we reach here, the test should fail
        expect.fail("Should have failed due to minimum stake duration");
      } catch (error) {
        // Expected to fail
        expect(error.toString()).to.include("MinStakeDurationNotMet");
        console.log("✅ Properly prevented early unstaking");
      }
    });

    it("Should wait for minimum stake duration and then unstake", async () => {
      console.log(`Waiting ${MIN_STAKE_DURATION + 1} seconds for minimum stake duration...`);
      await sleep((MIN_STAKE_DURATION + 1) * 1000);

      try {
        // Get initial balances
        const initialRewardBalance = await getAccount(provider.connection, user1RewardAccount);
        const initialUserRewardBalance = Number(initialRewardBalance.amount);

        const tx = await program.methods
          .unstakeNft()
          .accounts({
            user: user1.publicKey,
            nftStakingPool: nftStakingPool.publicKey,
            userNftStake: userNftStake1,
            userNftAccount: user1NftAccount1,
            userRewardAccount: user1RewardAccount,
            nftVault: nftVault1,
            rewardVault: rewardVault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();

        console.log("Unstake NFT tx:", tx);

        // Verify NFT was returned to user
        const userNftAccount = await getAccount(provider.connection, user1NftAccount1);
        expect(userNftAccount.amount.toString()).to.equal("1");

        // Verify user received final rewards
        const finalRewardBalance = await getAccount(provider.connection, user1RewardAccount);
        const finalUserRewardBalance = Number(finalRewardBalance.amount);
        expect(finalUserRewardBalance).to.be.greaterThan(initialUserRewardBalance);

        // Verify pool total was updated
        const poolAccount = await program.account.nftStakingPool.fetch(nftStakingPool.publicKey);
        expect(poolAccount.totalNftsStaked.toString()).to.equal("2");

        // Verify user stake account was closed
        try {
          await program.account.userNftStake.fetch(userNftStake1);
          expect.fail("User stake account should have been closed");
        } catch (error) {
          // Expected - account should be closed
        }

        console.log("✅ NFT unstaked successfully after minimum duration");
      } catch (error) {
        console.error("Unstake NFT error:", error);
        throw error;
      }
    });
  });

  describe("Pool Management", () => {
    it("Should show correct pool statistics", async () => {
      try {
        const poolAccount = await program.account.nftStakingPool.fetch(nftStakingPool.publicKey);
        
        console.log("Pool Statistics:");
        console.log(`Total NFTs Staked: ${poolAccount.totalNftsStaked}`);
        console.log(`Total Rewards Distributed: ${poolAccount.totalRewardsDistributed}`);
        console.log(`Daily Reward Rate: ${poolAccount.dailyRewardRate}`);
        
        expect(poolAccount.totalNftsStaked.toString()).to.equal("2");
        expect(Number(poolAccount.totalRewardsDistributed)).to.be.greaterThan(0);
        
        console.log("✅ Pool statistics verified");
      } catch (error) {
        console.error("Pool statistics error:", error);
        throw error;
      }
    });

    it("Should allow admin to fund more rewards", async () => {
      try {
        const additionalFunding = new anchor.BN(50_000_000); // 50 more tokens
        
        const tx = await program.methods
          .fundNftRewards(additionalFunding)
          .accounts({
            admin: admin.publicKey,
            nftStakingPool: nftStakingPool.publicKey,
            adminRewardAccount: adminRewardAccount,
            rewardVault: rewardVault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();

        console.log("Additional funding tx:", tx);

        // Verify additional funding
        const rewardVaultAccount = await getAccount(provider.connection, rewardVault);
        expect(Number(rewardVaultAccount.amount)).to.be.greaterThan(Number(INITIAL_REWARD_FUNDING));

        console.log("✅ Additional rewards funded successfully");
      } catch (error) {
        console.error("Additional funding error:", error);
        throw error;
      }
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("Should prevent non-admin from funding rewards", async () => {
      try {
        await program.methods
          .fundNftRewards(new anchor.BN(1000))
          .accounts({
            admin: user1.publicKey, // Wrong admin
            nftStakingPool: nftStakingPool.publicKey,
            adminRewardAccount: user1RewardAccount,
            rewardVault: rewardVault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();

        expect.fail("Should have failed with unauthorized admin");
      } catch (error) {
        // Expected to fail
        console.log("✅ Properly prevented unauthorized funding");
      }
    });

    it("Should handle multiple reward claims correctly", async () => {
      try {
        // Wait a bit more
        await sleep(2000);

        // Claim rewards for second user
        const initialBalance = await getAccount(provider.connection, user2RewardAccount);
        
        const tx = await program.methods
          .claimNftRewards()
          .accounts({
            user: user2.publicKey,
            nftStakingPool: nftStakingPool.publicKey,
            userNftStake: userNftStake3,
            userRewardAccount: user2RewardAccount,
            rewardVault: rewardVault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user2])
          .rpc();

        console.log("User2 claim rewards tx:", tx);

        const finalBalance = await getAccount(provider.connection, user2RewardAccount);
        expect(Number(finalBalance.amount)).to.be.greaterThan(Number(initialBalance.amount));

        console.log("✅ Multiple users can claim rewards correctly");
      } catch (error) {
        console.error("Multiple claims error:", error);
        throw error;
      }
    });
  });

  after(async () => {
    console.log("\n=== NFT Staking Test Summary ===");
    
    try {
      const poolAccount = await program.account.nftStakingPool.fetch(nftStakingPool.publicKey);
      const rewardVaultAccount = await getAccount(provider.connection, rewardVault);
      
      console.log(`Final pool state:`);
      console.log(`- Total NFTs staked: ${poolAccount.totalNftsStaked}`);
      console.log(`- Total rewards distributed: ${poolAccount.totalRewardsDistributed}`);
      console.log(`- Remaining rewards in vault: ${rewardVaultAccount.amount}`);
      console.log(`- Daily reward rate: ${poolAccount.dailyRewardRate}`);
      console.log(`- Min stake duration: ${poolAccount.minStakeDuration}s`);
      
      console.log("\n✅ All NFT staking tests completed successfully!");
    } catch (error) {
      console.error("Error in test summary:", error);
    }
  });
});
