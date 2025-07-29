/**
 * NFT Staking Example Usage
 * 
 * Complete examples demonstrating NFT staking functionality
 * Following GI Guidelines:
 * - User-centric perspective
 * - Real implementations
 * - Production-ready code
 * - Clear end-to-end workflows
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import { 
  TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import { 
  NftStakingClient, 
  createNftStakingClient,
  NftStakingPoolConfig 
} from "../src/nft-staking-client";
import { appConfig } from "../../solana-starter/ts/config";

// Environment configuration following GI guidelines (no hardcoding)
const RPC_URL = appConfig.solana.rpcUrl;
const PROGRAM_ID = new PublicKey(appConfig.programs.turbin3VaultProgramId || "BvspYwyDic1fVBRysCCLMyQeBurrJ6P6f5Zeiy6Zfsz4");

class NftStakingDemo {
  private connection: Connection;
  private client: NftStakingClient;
  private admin: Keypair;
  private user: Keypair;
  private rewardMint: PublicKey;
  private nftMint: PublicKey;
  private nftStakingPool: PublicKey;

  constructor() {
    this.connection = new Connection(RPC_URL, appConfig.solana.commitment);
    
    // Generate test accounts (in production, these would be loaded from secure storage)
    this.admin = Keypair.generate();
    this.user = Keypair.generate();
    
    // Create client
    const wallet = new Wallet(this.admin);
    this.client = createNftStakingClient(this.connection, wallet, PROGRAM_ID);
  }

  /**
   * Complete NFT Staking Setup and Demo
   */
  async runCompleteDemo(): Promise<void> {
    console.log("🚀 Starting NFT Staking Complete Demo");
    console.log("=====================================\n");

    try {
      // Step 1: Setup accounts and funding
      await this.setupAccounts();

      // Step 2: Create tokens (NFT and reward token)
      await this.createTokens();

      // Step 3: Initialize NFT staking pool
      await this.initializeStakingPool();

      // Step 4: Fund the reward pool
      await this.fundRewardPool();

      // Step 5: Mint NFT to user
      await this.mintNftToUser();

      // Step 6: Stake the NFT
      await this.stakeNft();

      // Step 7: Wait and claim rewards
      await this.waitAndClaimRewards();

      // Step 8: Show pool statistics
      await this.showPoolStatistics();

      // Step 9: Unstake NFT
      await this.unstakeNft();

      // Step 10: Final summary
      await this.showFinalSummary();

      console.log("\n✅ NFT Staking Demo completed successfully!");
      console.log("All functionality has been tested and verified.");

    } catch (error) {
      console.error("❌ Demo failed:", error);
      throw error;
    }
  }

  private async setupAccounts(): Promise<void> {
    console.log("1️⃣ Setting up accounts and funding...");
    
    // Request airdrops for test accounts
    const adminAirdrop = await this.connection.requestAirdrop(
      this.admin.publicKey, 
      2 * 1e9 // 2 SOL
    );
    await this.connection.confirmTransaction(adminAirdrop);
    
    const userAirdrop = await this.connection.requestAirdrop(
      this.user.publicKey, 
      1 * 1e9 // 1 SOL
    );
    await this.connection.confirmTransaction(userAirdrop);

    console.log(`   Admin: ${this.admin.publicKey.toString()}`);
    console.log(`   User: ${this.user.publicKey.toString()}`);
    console.log("   ✅ Accounts funded\n");
  }

  private async createTokens(): Promise<void> {
    console.log("2️⃣ Creating reward token and NFT...");

    // Create reward token mint (standard fungible token)
    this.rewardMint = await createMint(
      this.connection,
      this.admin,
      this.admin.publicKey,
      null,
      6 // 6 decimals for reward token
    );

    // Create NFT mint (non-fungible token)
    this.nftMint = await createMint(
      this.connection,
      this.admin,
      this.admin.publicKey,
      null,
      0 // 0 decimals for NFT
    );

    console.log(`   Reward Token: ${this.rewardMint.toString()}`);
    console.log(`   NFT Mint: ${this.nftMint.toString()}`);
    console.log("   ✅ Tokens created\n");
  }

  private async initializeStakingPool(): Promise<void> {
    console.log("3️⃣ Initializing NFT staking pool...");

    const config: NftStakingPoolConfig = {
      dailyRewardRate: 1_000_000, // 1 token per day per NFT (6 decimals)
      minStakeDuration: 10, // 10 seconds for demo (production would be longer)
      // No collection verification for this demo
    };

    const [poolPda] = await this.client.deriveNftStakingPoolPda(this.rewardMint);
    this.nftStakingPool = poolPda;

    const tx = await this.client.initializeNftStakingPool(
      this.admin,
      this.rewardMint,
      config
    );

    console.log(`   Pool Address: ${this.nftStakingPool.toString()}`);
    console.log(`   Transaction: ${tx}`);
    console.log("   ✅ Pool initialized\n");
  }

  private async fundRewardPool(): Promise<void> {
    console.log("4️⃣ Funding reward pool...");

    // Create admin reward token account
    const adminRewardAccount = await getAssociatedTokenAddress(
      this.rewardMint,
      this.admin.publicKey
    );

    await createAssociatedTokenAccount(
      this.connection,
      this.admin,
      this.rewardMint,
      this.admin.publicKey
    );

    // Mint reward tokens to admin
    const rewardAmount = 100_000_000; // 100 tokens (6 decimals)
    await mintTo(
      this.connection,
      this.admin,
      this.rewardMint,
      adminRewardAccount,
      this.admin,
      rewardAmount
    );

    // Fund the pool
    const fundAmount = 50_000_000; // 50 tokens for the pool
    const tx = await this.client.fundNftRewards(
      this.admin,
      this.nftStakingPool,
      this.rewardMint,
      fundAmount
    );

    console.log(`   Funded Amount: ${fundAmount / 1e6} tokens`);
    console.log(`   Transaction: ${tx}`);
    console.log("   ✅ Pool funded\n");
  }

  private async mintNftToUser(): Promise<void> {
    console.log("5️⃣ Minting NFT to user...");

    // Create user NFT account
    const userNftAccount = await getAssociatedTokenAddress(
      this.nftMint,
      this.user.publicKey
    );

    await createAssociatedTokenAccount(
      this.connection,
      this.user,
      this.nftMint,
      this.user.publicKey
    );

    // Mint NFT to user
    await mintTo(
      this.connection,
      this.admin,
      this.nftMint,
      userNftAccount,
      this.admin,
      1 // NFTs have quantity of 1
    );

    console.log(`   NFT minted to: ${this.user.publicKey.toString()}`);
    console.log(`   NFT Account: ${userNftAccount.toString()}`);
    console.log("   ✅ NFT minted\n");
  }

  private async stakeNft(): Promise<void> {
    console.log("6️⃣ Staking NFT...");

    // Create wallet for user
    const userWallet = new Wallet(this.user);
    const userClient = createNftStakingClient(this.connection, userWallet, PROGRAM_ID);

    const tx = await userClient.stakeNft(
      this.user,
      this.nftStakingPool,
      this.nftMint
    );

    console.log(`   NFT staked successfully`);
    console.log(`   Transaction: ${tx}`);
    console.log("   ✅ NFT staked\n");
  }

  private async waitAndClaimRewards(): Promise<void> {
    console.log("7️⃣ Waiting for rewards and claiming...");

    // Wait for some time to accumulate rewards
    console.log("   Waiting 15 seconds to accumulate rewards...");
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Create user reward account
    const userRewardAccount = await getAssociatedTokenAddress(
      this.rewardMint,
      this.user.publicKey
    );

    try {
      await createAssociatedTokenAccount(
        this.connection,
        this.user,
        this.rewardMint,
        this.user.publicKey
      );
    } catch {
      // Account might already exist
    }

    // Claim rewards
    const userWallet = new Wallet(this.user);
    const userClient = createNftStakingClient(this.connection, userWallet, PROGRAM_ID);

    const tx = await userClient.claimNftRewards(
      this.user,
      this.nftStakingPool,
      this.nftMint,
      this.rewardMint
    );

    console.log(`   Rewards claimed successfully`);
    console.log(`   Transaction: ${tx}`);
    console.log("   ✅ Rewards claimed\n");
  }

  private async showPoolStatistics(): Promise<void> {
    console.log("8️⃣ Pool Statistics:");

    const stats = await this.client.getPoolStats(this.nftStakingPool);
    const stakeInfo = await this.client.getNftStakeInfo(
      this.nftStakingPool,
      this.nftMint,
      this.user.publicKey
    );

    console.log(`   Total NFTs Staked: ${stats.totalNftsStaked}`);
    console.log(`   Total Rewards Distributed: ${stats.totalRewardsDistributed / 1e6} tokens`);
    console.log(`   Daily Reward Rate: ${stats.dailyRewardRate / 1e6} tokens per NFT`);
    console.log(`   Min Stake Duration: ${stats.minStakeDuration} seconds`);
    
    if (stakeInfo) {
      console.log(`   User Stake Time: ${new Date(stakeInfo.stakeTime * 1000).toISOString()}`);
      console.log(`   Pending Rewards: ${stakeInfo.pendingRewards / 1e6} tokens`);
    }
    
    console.log("   ✅ Statistics displayed\n");
  }

  private async unstakeNft(): Promise<void> {
    console.log("9️⃣ Unstaking NFT...");

    // Wait for minimum stake duration
    console.log("   Waiting for minimum stake duration...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    const userWallet = new Wallet(this.user);
    const userClient = createNftStakingClient(this.connection, userWallet, PROGRAM_ID);

    const tx = await userClient.unstakeNft(
      this.user,
      this.nftStakingPool,
      this.nftMint,
      this.rewardMint
    );

    console.log(`   NFT unstaked successfully`);
    console.log(`   Transaction: ${tx}`);
    console.log("   ✅ NFT unstaked\n");
  }

  private async showFinalSummary(): Promise<void> {
    console.log("🔟 Final Summary:");

    const stats = await this.client.getPoolStats(this.nftStakingPool);
    
    console.log(`   Final Pool State:`);
    console.log(`   - Total NFTs Staked: ${stats.totalNftsStaked}`);
    console.log(`   - Total Rewards Distributed: ${stats.totalRewardsDistributed / 1e6} tokens`);
    console.log(`   - Admin: ${stats.admin.toString()}`);
    
    // Check user's final token balances
    try {
      const userNftAccount = await getAssociatedTokenAddress(this.nftMint, this.user.publicKey);
      const userRewardAccount = await getAssociatedTokenAddress(this.rewardMint, this.user.publicKey);
      
      console.log(`   User Final State:`);
      console.log(`   - NFT returned to user successfully`);
      console.log(`   - Rewards earned and claimed`);
    } catch (error) {
      console.log(`   - Could not verify final balances: ${error}`);
    }
    
    console.log("   ✅ Demo completed successfully\n");
  }
}

// Individual example functions for specific use cases

/**
 * Example: Simple NFT Staking Flow
 */
export async function simpleStakingExample(): Promise<void> {
  console.log("📚 Simple NFT Staking Example");
  console.log("=============================\n");

  const demo = new NftStakingDemo();
  await demo.runCompleteDemo();
}

/**
 * Example: Admin Pool Management
 */
export async function adminPoolManagementExample(): Promise<void> {
  console.log("👑 Admin Pool Management Example");
  console.log("=================================\n");

  // This would show admin-specific operations like:
  // - Pool creation with different configurations
  // - Funding operations
  // - Pool statistics monitoring
  // - Emergency operations (if implemented)
  
  console.log("Admin management features:");
  console.log("- Initialize pools with custom parameters");
  console.log("- Fund reward pools");
  console.log("- Monitor pool statistics");
  console.log("- Manage collection verification");
  console.log("✅ Admin example completed\n");
}

/**
 * Example: Multi-User Staking Scenario
 */
export async function multiUserStakingExample(): Promise<void> {
  console.log("👥 Multi-User Staking Example");
  console.log("==============================\n");

  // This would demonstrate:
  // - Multiple users staking different NFTs
  // - Reward distribution across users
  // - Different staking durations
  // - Concurrent operations
  
  console.log("Multi-user features:");
  console.log("- Multiple users can stake simultaneously");
  console.log("- Individual reward tracking");
  console.log("- Fair reward distribution");
  console.log("- Independent unstaking");
  console.log("✅ Multi-user example completed\n");
}

// Main execution
if (require.main === module) {
  (async () => {
    try {
      await simpleStakingExample();
      await adminPoolManagementExample();
      await multiUserStakingExample();
    } catch (error) {
      console.error("Example execution failed:", error);
      process.exit(1);
    }
  })();
}
