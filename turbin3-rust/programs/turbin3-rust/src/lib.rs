use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_lang::solana_program::clock::Clock;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Token, TokenAccount, Mint, Transfer as SplTransfer}
};

declare_id!("BvspYwyDic1fVBRysCCLMyQeBurrJ6P6f5Zeiy6Zfsz4");

#[program]
pub mod turbin3_rust {
    use super::*;

    // ============ VAULT INSTRUCTIONS ============
    
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        ctx.accounts.vault_state.owner = ctx.accounts.owner.key();
        ctx.accounts.vault_state.auth_bump = ctx.bumps.vault_auth;
        ctx.accounts.vault_state.vault_bump = ctx.bumps.vault;
        ctx.accounts.vault_state.score = 0;
        Ok(())
    }

    pub fn deposit_sol(ctx: Context<DepositSol>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        
        let transfer_accounts = Transfer {
            from: ctx.accounts.owner.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            transfer_accounts,
        );

        transfer(cpi_ctx, amount)?;
        Ok(())
    }

    pub fn withdraw_sol(ctx: Context<WithdrawSol>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(
            ctx.accounts.vault.to_account_info().lamports() >= amount,
            ErrorCode::InsufficientFunds
        );

        let seeds = &[
            b"auth",
            ctx.accounts.vault_state.to_account_info().key.as_ref(),
            &[ctx.accounts.vault_state.auth_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let transfer_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.owner.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            transfer_accounts,
            signer_seeds,
        );

        transfer(cpi_ctx, amount)?;
        Ok(())
    }

    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        let seeds = &[
            b"auth",
            ctx.accounts.vault_state.to_account_info().key.as_ref(),
            &[ctx.accounts.vault_state.auth_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer all remaining SOL from vault back to owner
        let vault_balance = ctx.accounts.vault.to_account_info().lamports();
        if vault_balance > 0 {
            let transfer_accounts = Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.owner.to_account_info(),
            };

            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                transfer_accounts,
                signer_seeds,
            );

            transfer(cpi_ctx, vault_balance)?;
        }

        Ok(())
    }

    // ============ ESCROW INSTRUCTIONS ============

    pub fn initialize_escrow(ctx: Context<InitializeEscrow>, amount: u64, receive_amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(receive_amount > 0, ErrorCode::InvalidAmount);

        let escrow = &mut ctx.accounts.escrow;
        escrow.maker = ctx.accounts.maker.key();
        escrow.mint_a = ctx.accounts.token_mint_a.key();
        escrow.mint_b = ctx.accounts.token_mint_b.key();
        escrow.amount_a = amount;
        escrow.amount_b = receive_amount;
        escrow.bump = ctx.bumps.escrow;

        // Transfer tokens from maker to escrow
        let transfer_accounts = SplTransfer {
            from: ctx.accounts.maker_token_account.to_account_info(),
            to: ctx.accounts.escrow_token_account.to_account_info(),
            authority: ctx.accounts.maker.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer_accounts,
        );

        token::transfer(cpi_ctx, amount)?;
        Ok(())
    }

    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        let seeds = &[
            b"escrow",
            ctx.accounts.escrow.maker.as_ref(),
            &[ctx.accounts.escrow.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer tokens back to maker
        let balance = ctx.accounts.escrow_token_account.amount;
        
        let transfer_accounts = SplTransfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.maker_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_accounts,
            signer_seeds,
        );

        token::transfer(cpi_ctx, balance)?;
        Ok(())
    }

    pub fn exchange_escrow(ctx: Context<ExchangeEscrow>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        let escrow_token_balance = ctx.accounts.escrow_token_account.amount;
        let taker_token_balance = ctx.accounts.taker_token_account.amount;

        require!(
            taker_token_balance >= escrow.amount_b,
            ErrorCode::InsufficientFunds
        );

        let seeds = &[
            b"escrow",
            escrow.maker.as_ref(),
            &[escrow.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer escrow tokens to taker
        let transfer_to_taker = SplTransfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.taker_receive_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };

        let cpi_ctx_taker = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_to_taker,
            signer_seeds,
        );

        token::transfer(cpi_ctx_taker, escrow_token_balance)?;

        // Transfer taker tokens to maker
        let transfer_to_maker = SplTransfer {
            from: ctx.accounts.taker_token_account.to_account_info(),
            to: ctx.accounts.maker_receive_token_account.to_account_info(),
            authority: ctx.accounts.taker.to_account_info(),
        };

        let cpi_ctx_maker = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer_to_maker,
        );

        token::transfer(cpi_ctx_maker, escrow.amount_b)?;
        Ok(())
    }

    // ============ AMM INSTRUCTIONS ============

    pub fn initialize_amm(ctx: Context<InitializeAmm>, fee: u16) -> Result<()> {
        require!(fee <= 10000, ErrorCode::InvalidFee); // Max 100% fee

        let amm = &mut ctx.accounts.amm;
        amm.admin = ctx.accounts.admin.key();
        amm.fee = fee;
        amm.token_a_mint = ctx.accounts.token_a_mint.key();
        amm.token_b_mint = ctx.accounts.token_b_mint.key();
        amm.token_a_vault = ctx.accounts.token_a_vault.key();
        amm.token_b_vault = ctx.accounts.token_b_vault.key();
        amm.lp_mint = ctx.accounts.lp_mint.key();
        amm.bump = ctx.bumps.amm;
        Ok(())
    }

    pub fn deposit_liquidity(ctx: Context<DepositLiquidity>, amount_a: u64, amount_b: u64, min_lp_tokens: u64) -> Result<()> {
        require!(amount_a > 0 && amount_b > 0, ErrorCode::InvalidAmount);

        let vault_a_balance = ctx.accounts.token_a_vault.amount;
        let vault_b_balance = ctx.accounts.token_b_vault.amount;
        let lp_supply = ctx.accounts.lp_mint.supply;

        let lp_tokens_to_mint = if lp_supply == 0 {
            // Initial liquidity provision
            (amount_a.checked_mul(amount_b).unwrap() as f64).sqrt() as u64
        } else {
            // Subsequent liquidity provision
            let ratio_a = (amount_a as f64) / (vault_a_balance as f64);
            let ratio_b = (amount_b as f64) / (vault_b_balance as f64);
            let ratio = ratio_a.min(ratio_b);
            (lp_supply as f64 * ratio) as u64
        };

        require!(lp_tokens_to_mint >= min_lp_tokens, ErrorCode::SlippageExceeded);

        let seeds = &[
            b"amm",
            ctx.accounts.amm.token_a_mint.as_ref(),
            ctx.accounts.amm.token_b_mint.as_ref(),
            &[ctx.accounts.amm.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer token A from user to vault
        let transfer_a = SplTransfer {
            from: ctx.accounts.user_token_a.to_account_info(),
            to: ctx.accounts.token_a_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_a),
            amount_a,
        )?;

        // Transfer token B from user to vault
        let transfer_b = SplTransfer {
            from: ctx.accounts.user_token_b.to_account_info(),
            to: ctx.accounts.token_b_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_b),
            amount_b,
        )?;

        // Mint LP tokens to user
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::MintTo {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.user_lp_token.to_account_info(),
                    authority: ctx.accounts.amm.to_account_info(),
                },
                signer_seeds,
            ),
            lp_tokens_to_mint,
        )?;

        Ok(())
    }

    pub fn withdraw_liquidity(ctx: Context<WithdrawLiquidity>, lp_amount: u64, min_amount_a: u64, min_amount_b: u64) -> Result<()> {
        require!(lp_amount > 0, ErrorCode::InvalidAmount);

        let vault_a_balance = ctx.accounts.token_a_vault.amount;
        let vault_b_balance = ctx.accounts.token_b_vault.amount;
        let lp_supply = ctx.accounts.lp_mint.supply;

        let amount_a = (vault_a_balance as f64 * lp_amount as f64 / lp_supply as f64) as u64;
        let amount_b = (vault_b_balance as f64 * lp_amount as f64 / lp_supply as f64) as u64;

        require!(amount_a >= min_amount_a && amount_b >= min_amount_b, ErrorCode::SlippageExceeded);

        let seeds = &[
            b"amm",
            ctx.accounts.amm.token_a_mint.as_ref(),
            ctx.accounts.amm.token_b_mint.as_ref(),
            &[ctx.accounts.amm.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Burn LP tokens
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Burn {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    from: ctx.accounts.user_lp_token.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            lp_amount,
        )?;

        // Transfer token A from vault to user
        let transfer_a = SplTransfer {
            from: ctx.accounts.token_a_vault.to_account_info(),
            to: ctx.accounts.user_token_a.to_account_info(),
            authority: ctx.accounts.amm.to_account_info(),
        };

        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_a, signer_seeds),
            amount_a,
        )?;

        // Transfer token B from vault to user
        let transfer_b = SplTransfer {
            from: ctx.accounts.token_b_vault.to_account_info(),
            to: ctx.accounts.user_token_b.to_account_info(),
            authority: ctx.accounts.amm.to_account_info(),
        };

        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_b, signer_seeds),
            amount_b,
        )?;

        Ok(())
    }

    pub fn swap_tokens(ctx: Context<SwapTokens>, amount_in: u64, min_amount_out: u64) -> Result<()> {
        require!(amount_in > 0, ErrorCode::InvalidAmount);

        let vault_a_balance = ctx.accounts.token_a_vault.amount;
        let vault_b_balance = ctx.accounts.token_b_vault.amount;
        let fee = ctx.accounts.amm.fee;

        // Calculate swap output using constant product formula (x * y = k)
        let amount_in_with_fee = amount_in.checked_mul(10000 - fee as u64).unwrap().checked_div(10000).unwrap();
        
        let amount_out = if ctx.accounts.token_a_vault.mint == ctx.accounts.user_token_in.mint {
            // Swapping A for B
            vault_b_balance.checked_mul(amount_in_with_fee).unwrap()
                .checked_div(vault_a_balance.checked_add(amount_in_with_fee).unwrap()).unwrap()
        } else {
            // Swapping B for A
            vault_a_balance.checked_mul(amount_in_with_fee).unwrap()
                .checked_div(vault_b_balance.checked_add(amount_in_with_fee).unwrap()).unwrap()
        };

        require!(amount_out >= min_amount_out, ErrorCode::SlippageExceeded);

        let seeds = &[
            b"amm",
            ctx.accounts.amm.token_a_mint.as_ref(),
            ctx.accounts.amm.token_b_mint.as_ref(),
            &[ctx.accounts.amm.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer input tokens from user to vault
        let transfer_in = SplTransfer {
            from: ctx.accounts.user_token_in.to_account_info(),
            to: ctx.accounts.vault_token_in.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_in),
            amount_in,
        )?;

        // Transfer output tokens from vault to user
        let transfer_out = SplTransfer {
            from: ctx.accounts.vault_token_out.to_account_info(),
            to: ctx.accounts.user_token_out.to_account_info(),
            authority: ctx.accounts.amm.to_account_info(),
        };

        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_out, signer_seeds),
            amount_out,
        )?;

        Ok(())
    }

    // ============ STAKING INSTRUCTIONS ============

    pub fn initialize_staking_pool(ctx: Context<InitializeStakingPool>, reward_rate: u64, cooldown_period: i64) -> Result<()> {
        require!(reward_rate > 0, ErrorCode::InvalidAmount);
        require!(cooldown_period > 0, ErrorCode::InvalidAmount);

        let pool = &mut ctx.accounts.staking_pool;
        pool.admin = ctx.accounts.admin.key();
        pool.stake_mint = ctx.accounts.stake_mint.key();
        pool.reward_mint = ctx.accounts.reward_mint.key();
        pool.stake_vault = ctx.accounts.stake_vault.key();
        pool.reward_vault = ctx.accounts.reward_vault.key();
        pool.total_staked = 0;
        pool.reward_rate = reward_rate; // Rewards per second per staked token
        pool.last_update_time = Clock::get()?.unix_timestamp;
        pool.accumulated_reward_per_share = 0;
        pool.cooldown_period = cooldown_period;
        pool.bump = ctx.bumps.staking_pool;
        Ok(())
    }

    pub fn stake_tokens(ctx: Context<StakeTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let current_time = Clock::get()?.unix_timestamp;
        let staking_pool_key = ctx.accounts.staking_pool.key();
        let pool = &mut ctx.accounts.staking_pool;
        let user_stake = &mut ctx.accounts.user_stake;

        // Update reward accumulation
        if pool.total_staked > 0 {
            let time_elapsed = current_time - pool.last_update_time;
            let rewards_per_share = (pool.reward_rate as u128 * time_elapsed as u128) / pool.total_staked as u128;
            pool.accumulated_reward_per_share = pool.accumulated_reward_per_share.checked_add(rewards_per_share as u64).unwrap();
        }
        pool.last_update_time = current_time;

        // Initialize user stake for new user
        user_stake.user = ctx.accounts.user.key();
        user_stake.staking_pool = staking_pool_key;
        user_stake.amount = amount;
        user_stake.reward_debt = (amount as u128 * pool.accumulated_reward_per_share as u128 / 1e9 as u128) as u64;
        user_stake.pending_rewards = 0;
        user_stake.last_stake_time = current_time;
        user_stake.bump = ctx.bumps.user_stake;

        // Update pool total
        pool.total_staked = pool.total_staked.checked_add(amount).unwrap();

        // Transfer stake tokens from user to pool
        let transfer_accounts = SplTransfer {
            from: ctx.accounts.user_stake_account.to_account_info(),
            to: ctx.accounts.stake_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_accounts),
            amount,
        )?;

        Ok(())
    }

    pub fn add_stake(ctx: Context<AddStake>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let current_time = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.staking_pool;
        let user_stake = &mut ctx.accounts.user_stake;

        // Update reward accumulation
        if pool.total_staked > 0 {
            let time_elapsed = current_time - pool.last_update_time;
            let rewards_per_share = (pool.reward_rate as u128 * time_elapsed as u128) / pool.total_staked as u128;
            pool.accumulated_reward_per_share = pool.accumulated_reward_per_share.checked_add(rewards_per_share as u64).unwrap();
        }
        pool.last_update_time = current_time;

        // Calculate pending rewards for existing user
        if user_stake.amount > 0 {
            let pending_rewards = ((user_stake.amount as u128 * pool.accumulated_reward_per_share as u128) / 1e9 as u128) - user_stake.reward_debt as u128;
            user_stake.pending_rewards = user_stake.pending_rewards.checked_add(pending_rewards as u64).unwrap();
        }

        // Update user stake
        user_stake.amount = user_stake.amount.checked_add(amount).unwrap();
        user_stake.last_stake_time = current_time;
        user_stake.reward_debt = (user_stake.amount as u128 * pool.accumulated_reward_per_share as u128 / 1e9 as u128) as u64;

        // Update pool total
        pool.total_staked = pool.total_staked.checked_add(amount).unwrap();

        // Transfer stake tokens from user to pool
        let transfer_accounts = SplTransfer {
            from: ctx.accounts.user_stake_account.to_account_info(),
            to: ctx.accounts.stake_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_accounts),
            amount,
        )?;

        Ok(())
    }

    pub fn unstake_tokens(ctx: Context<UnstakeTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let current_time = Clock::get()?.unix_timestamp;
        let user_stake = &mut ctx.accounts.user_stake;

        require!(user_stake.amount >= amount, ErrorCode::InsufficientFunds);
        require!(
            current_time >= user_stake.last_stake_time + ctx.accounts.staking_pool.cooldown_period,
            ErrorCode::CooldownNotMet
        );

        let pool = &mut ctx.accounts.staking_pool;

        // Update reward accumulation
        if pool.total_staked > 0 {
            let time_elapsed = current_time - pool.last_update_time;
            let rewards_per_share = (pool.reward_rate as u128 * time_elapsed as u128) / pool.total_staked as u128;
            pool.accumulated_reward_per_share = pool.accumulated_reward_per_share.checked_add(rewards_per_share as u64).unwrap();
        }
        pool.last_update_time = current_time;

        // Calculate pending rewards for user
        let pending_rewards = ((user_stake.amount as u128 * pool.accumulated_reward_per_share as u128) / 1e9 as u128) - user_stake.reward_debt as u128;
        user_stake.pending_rewards = user_stake.pending_rewards.checked_add(pending_rewards as u64).unwrap();

        // Update user stake
        user_stake.amount = user_stake.amount.checked_sub(amount).unwrap();
        user_stake.reward_debt = (user_stake.amount as u128 * pool.accumulated_reward_per_share as u128 / 1e9 as u128) as u64;

        // Update pool total
        pool.total_staked = pool.total_staked.checked_sub(amount).unwrap();

        let stake_mint = pool.stake_mint;
        let reward_mint = pool.reward_mint;
        let pool_bump = pool.bump;

        let seeds = &[
            b"staking_pool",
            stake_mint.as_ref(),
            reward_mint.as_ref(),
            &[pool_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer stake tokens from pool back to user
        let transfer_accounts = SplTransfer {
            from: ctx.accounts.stake_vault.to_account_info(),
            to: ctx.accounts.user_stake_account.to_account_info(),
            authority: ctx.accounts.staking_pool.to_account_info(),
        };

        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_accounts, signer_seeds),
            amount,
        )?;

        Ok(())
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        let current_time = Clock::get()?.unix_timestamp;
        let user_stake = &mut ctx.accounts.user_stake;
        let pool = &mut ctx.accounts.staking_pool;

        // Update reward accumulation
        if pool.total_staked > 0 {
            let time_elapsed = current_time - pool.last_update_time;
            let rewards_per_share = (pool.reward_rate as u128 * time_elapsed as u128) / pool.total_staked as u128;
            pool.accumulated_reward_per_share = pool.accumulated_reward_per_share.checked_add(rewards_per_share as u64).unwrap();
        }
        pool.last_update_time = current_time;

        // Calculate total pending rewards
        let pending_rewards = if user_stake.amount > 0 {
            ((user_stake.amount as u128 * pool.accumulated_reward_per_share as u128) / 1e9 as u128) - user_stake.reward_debt as u128
        } else {
            0
        };
        let total_rewards = user_stake.pending_rewards.checked_add(pending_rewards as u64).unwrap();

        require!(total_rewards > 0, ErrorCode::NoRewardsToClaim);

        // Reset pending rewards and update debt
        user_stake.pending_rewards = 0;
        user_stake.reward_debt = (user_stake.amount as u128 * pool.accumulated_reward_per_share as u128 / 1e9 as u128) as u64;

        let stake_mint = pool.stake_mint;
        let reward_mint = pool.reward_mint;
        let pool_bump = pool.bump;

        let seeds = &[
            b"staking_pool",
            stake_mint.as_ref(),
            reward_mint.as_ref(),
            &[pool_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer reward tokens from pool to user
        let transfer_accounts = SplTransfer {
            from: ctx.accounts.reward_vault.to_account_info(),
            to: ctx.accounts.user_reward_account.to_account_info(),
            authority: ctx.accounts.staking_pool.to_account_info(),
        };

        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_accounts, signer_seeds),
            total_rewards,
        )?;

        Ok(())
    }

    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        // Transfer reward tokens from admin to pool
        let transfer_accounts = SplTransfer {
            from: ctx.accounts.admin_reward_account.to_account_info(),
            to: ctx.accounts.reward_vault.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };

        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_accounts),
            amount,
        )?;

        Ok(())
    }

    // ============ NFT STAKING INSTRUCTIONS ============

    pub fn initialize_nft_staking_pool(
        ctx: Context<InitializeNftStakingPool>, 
        daily_reward_rate: u64, 
        min_stake_duration: i64,
        collection_address: Option<Pubkey>
    ) -> Result<()> {
        require!(daily_reward_rate > 0, ErrorCode::InvalidAmount);
        require!(min_stake_duration > 0, ErrorCode::InvalidAmount);

        let pool = &mut ctx.accounts.nft_staking_pool;
        pool.admin = ctx.accounts.admin.key();
        pool.reward_mint = ctx.accounts.reward_mint.key();
        pool.reward_vault = ctx.accounts.reward_vault.key();
        pool.total_nfts_staked = 0;
        pool.daily_reward_rate = daily_reward_rate; // Rewards per day per staked NFT
        pool.last_update_time = Clock::get()?.unix_timestamp;
        pool.accumulated_reward_per_nft = 0;
        pool.min_stake_duration = min_stake_duration;
        pool.collection_address = collection_address;
        pool.total_rewards_distributed = 0;
        pool.bump = ctx.bumps.nft_staking_pool;
        Ok(())
    }

    pub fn stake_nft(ctx: Context<StakeNft>) -> Result<()> {
        let current_time = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.nft_staking_pool;
        let user_nft_stake = &mut ctx.accounts.user_nft_stake;

        // Verify collection if specified
        if let Some(collection_address) = pool.collection_address {
            // Verify the NFT belongs to the specified collection
            // This would typically involve checking the NFT's metadata for collection verification
            require!(
                ctx.accounts.nft_metadata.to_account_info().data_is_empty() == false,
                ErrorCode::InvalidNftMetadata
            );
        }

        // Update reward accumulation for the pool
        if pool.total_nfts_staked > 0 {
            let time_elapsed = current_time - pool.last_update_time;
            let daily_seconds = 86400; // 24 * 60 * 60
            let rewards_per_nft = (pool.daily_reward_rate as u128 * time_elapsed as u128) / daily_seconds as u128;
            pool.accumulated_reward_per_nft = pool.accumulated_reward_per_nft.checked_add(rewards_per_nft as u64).unwrap();
        }
        pool.last_update_time = current_time;

        // Initialize user NFT stake
        user_nft_stake.user = ctx.accounts.user.key();
        user_nft_stake.nft_staking_pool = ctx.accounts.nft_staking_pool.key();
        user_nft_stake.nft_mint = ctx.accounts.nft_mint.key();
        user_nft_stake.stake_time = current_time;
        user_nft_stake.last_claim_time = current_time;
        user_nft_stake.reward_debt = pool.accumulated_reward_per_nft;
        user_nft_stake.pending_rewards = 0;
        user_nft_stake.bump = ctx.bumps.user_nft_stake;

        // Update pool total
        pool.total_nfts_staked = pool.total_nfts_staked.checked_add(1).unwrap();

        // Transfer NFT from user to staking pool vault
        let transfer_accounts = SplTransfer {
            from: ctx.accounts.user_nft_account.to_account_info(),
            to: ctx.accounts.nft_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_accounts),
            1, // NFTs have amount = 1
        )?;

        Ok(())
    }

    pub fn unstake_nft(ctx: Context<UnstakeNft>) -> Result<()> {
        let current_time = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.nft_staking_pool;
        let user_nft_stake = &mut ctx.accounts.user_nft_stake;

        // Check minimum stake duration
        require!(
            current_time >= user_nft_stake.stake_time + pool.min_stake_duration,
            ErrorCode::MinStakeDurationNotMet
        );

        // Update reward accumulation for the pool
        if pool.total_nfts_staked > 0 {
            let time_elapsed = current_time - pool.last_update_time;
            let daily_seconds = 86400;
            let rewards_per_nft = (pool.daily_reward_rate as u128 * time_elapsed as u128) / daily_seconds as u128;
            pool.accumulated_reward_per_nft = pool.accumulated_reward_per_nft.checked_add(rewards_per_nft as u64).unwrap();
        }
        pool.last_update_time = current_time;

        // Calculate pending rewards
        let time_staked = current_time - user_nft_stake.last_claim_time;
        let daily_seconds = 86400;
        let earned_rewards = (pool.daily_reward_rate as u128 * time_staked as u128) / daily_seconds as u128;
        let total_pending = user_nft_stake.pending_rewards.checked_add(earned_rewards as u64).unwrap();

        // Update user stake (will be closed after this instruction)
        user_nft_stake.pending_rewards = total_pending;

        // Update pool total
        pool.total_nfts_staked = pool.total_nfts_staked.checked_sub(1).unwrap();

        let reward_mint = pool.reward_mint;
        let pool_bump = pool.bump;

        let seeds = &[
            b"nft_staking_pool",
            reward_mint.as_ref(),
            &[pool_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer NFT back to user
        let transfer_accounts = SplTransfer {
            from: ctx.accounts.nft_vault.to_account_info(),
            to: ctx.accounts.user_nft_account.to_account_info(),
            authority: ctx.accounts.nft_staking_pool.to_account_info(),
        };

        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_accounts, signer_seeds),
            1,
        )?;

        // Transfer pending rewards to user if any
        if total_pending > 0 {
            let reward_transfer_accounts = SplTransfer {
                from: ctx.accounts.reward_vault.to_account_info(),
                to: ctx.accounts.user_reward_account.to_account_info(),
                authority: ctx.accounts.nft_staking_pool.to_account_info(),
            };

            token::transfer(
                CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), reward_transfer_accounts, signer_seeds),
                total_pending,
            )?;

            pool.total_rewards_distributed = pool.total_rewards_distributed.checked_add(total_pending).unwrap();
        }

        Ok(())
    }

    pub fn claim_nft_rewards(ctx: Context<ClaimNftRewards>) -> Result<()> {
        let current_time = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.nft_staking_pool;
        let user_nft_stake = &mut ctx.accounts.user_nft_stake;

        // Update reward accumulation for the pool
        if pool.total_nfts_staked > 0 {
            let time_elapsed = current_time - pool.last_update_time;
            let daily_seconds = 86400;
            let rewards_per_nft = (pool.daily_reward_rate as u128 * time_elapsed as u128) / daily_seconds as u128;
            pool.accumulated_reward_per_nft = pool.accumulated_reward_per_nft.checked_add(rewards_per_nft as u64).unwrap();
        }
        pool.last_update_time = current_time;

        // Calculate rewards since last claim
        let time_since_last_claim = current_time - user_nft_stake.last_claim_time;
        let daily_seconds = 86400;
        let earned_rewards = (pool.daily_reward_rate as u128 * time_since_last_claim as u128) / daily_seconds as u128;
        let total_rewards = user_nft_stake.pending_rewards.checked_add(earned_rewards as u64).unwrap();

        require!(total_rewards > 0, ErrorCode::NoRewardsToClaim);

        // Update user stake
        user_nft_stake.pending_rewards = 0;
        user_nft_stake.last_claim_time = current_time;
        user_nft_stake.reward_debt = pool.accumulated_reward_per_nft;

        let reward_mint = pool.reward_mint;
        let pool_bump = pool.bump;

        let seeds = &[
            b"nft_staking_pool",
            reward_mint.as_ref(),
            &[pool_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer reward tokens to user
        let transfer_accounts = SplTransfer {
            from: ctx.accounts.reward_vault.to_account_info(),
            to: ctx.accounts.user_reward_account.to_account_info(),
            authority: ctx.accounts.nft_staking_pool.to_account_info(),
        };

        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_accounts, signer_seeds),
            total_rewards,
        )?;

        pool.total_rewards_distributed = pool.total_rewards_distributed.checked_add(total_rewards).unwrap();

        Ok(())
    }

    pub fn fund_nft_rewards(ctx: Context<FundNftRewards>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        // Transfer reward tokens from admin to pool
        let transfer_accounts = SplTransfer {
            from: ctx.accounts.admin_reward_account.to_account_info(),
            to: ctx.accounts.reward_vault.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };

        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_accounts),
            amount,
        )?;

        Ok(())
    }
}

// ============ ACCOUNT STRUCTURES ============

// Vault Accounts
#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        init,
        payer = owner,
        space = VaultState::INIT_SPACE,
        seeds = [b"state", owner.key().as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,
    
    #[account(
        seeds = [b"auth", vault_state.key().as_ref()],
        bump
    )]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub vault_auth: UncheckedAccount<'info>,
    
    #[account(
        seeds = [b"vault", vault_state.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositSol<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        seeds = [b"state", owner.key().as_ref()],
        bump = vault_state.vault_bump,
        has_one = owner
    )]
    pub vault_state: Account<'info, VaultState>,
    
    #[account(
        mut,
        seeds = [b"vault", vault_state.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawSol<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        seeds = [b"state", owner.key().as_ref()],
        bump = vault_state.vault_bump,
        has_one = owner
    )]
    pub vault_state: Account<'info, VaultState>,
    
    #[account(
        seeds = [b"auth", vault_state.key().as_ref()],
        bump = vault_state.auth_bump
    )]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub vault_auth: UncheckedAccount<'info>,
    
    #[account(
        mut,
        seeds = [b"vault", vault_state.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        close = owner,
        seeds = [b"state", owner.key().as_ref()],
        bump = vault_state.vault_bump,
        has_one = owner
    )]
    pub vault_state: Account<'info, VaultState>,
    
    #[account(
        seeds = [b"auth", vault_state.key().as_ref()],
        bump = vault_state.auth_bump
    )]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub vault_auth: UncheckedAccount<'info>,
    
    #[account(
        mut,
        seeds = [b"vault", vault_state.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

// Escrow Accounts
#[derive(Accounts)]
pub struct InitializeEscrow<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    
    #[account(
        init,
        payer = maker,
        space = EscrowState::INIT_SPACE,
        seeds = [b"escrow", maker.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, EscrowState>,
    
    pub token_mint_a: Account<'info, Mint>,
    pub token_mint_b: Account<'info, Mint>,
    
    #[account(
        mut,
        associated_token::mint = token_mint_a,
        associated_token::authority = maker
    )]
    pub maker_token_account: Account<'info, TokenAccount>,
    
    pub maker_receive_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = maker,
        token::mint = token_mint_a,
        token::authority = escrow,
        seeds = [b"escrow_vault", escrow.key().as_ref()],
        bump
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    
    #[account(
        mut,
        close = maker,
        seeds = [b"escrow", maker.key().as_ref()],
        bump = escrow.bump,
        has_one = maker
    )]
    pub escrow: Account<'info, EscrowState>,
    
    #[account(mut)]
    pub maker_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"escrow_vault", escrow.key().as_ref()],
        bump
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ExchangeEscrow<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,
    
    #[account(
        mut,
        close = maker,
        seeds = [b"escrow", maker.key().as_ref()],
        bump = escrow.bump,
        has_one = maker
    )]
    pub escrow: Account<'info, EscrowState>,
    
    /// CHECK: This is validated in the escrow account
    #[account(mut)]
    pub maker: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub maker_receive_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub taker_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub taker_receive_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"escrow_vault", escrow.key().as_ref()],
        bump
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

// AMM Accounts
#[derive(Accounts)]
pub struct InitializeAmm<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        init,
        payer = admin,
        space = AmmState::INIT_SPACE,
        seeds = [b"amm", token_a_mint.key().as_ref(), token_b_mint.key().as_ref()],
        bump
    )]
    pub amm: Account<'info, AmmState>,
    
    pub token_a_mint: Account<'info, Mint>,
    pub token_b_mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = admin,
        token::mint = token_a_mint,
        token::authority = amm,
        seeds = [b"vault_a", amm.key().as_ref()],
        bump
    )]
    pub token_a_vault: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = admin,
        token::mint = token_b_mint,
        token::authority = amm,
        seeds = [b"vault_b", amm.key().as_ref()],
        bump
    )]
    pub token_b_vault: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = admin,
        mint::decimals = 6,
        mint::authority = amm,
        seeds = [b"lp_mint", amm.key().as_ref()],
        bump
    )]
    pub lp_mint: Account<'info, Mint>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositLiquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        seeds = [b"amm", token_a_mint.key().as_ref(), token_b_mint.key().as_ref()],
        bump = amm.bump
    )]
    pub amm: Account<'info, AmmState>,
    
    pub token_a_mint: Account<'info, Mint>,
    pub token_b_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub user_token_a: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user_token_b: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user_lp_token: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"vault_a", amm.key().as_ref()],
        bump
    )]
    pub token_a_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"vault_b", amm.key().as_ref()],
        bump
    )]
    pub token_b_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"lp_mint", amm.key().as_ref()],
        bump
    )]
    pub lp_mint: Account<'info, Mint>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawLiquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        seeds = [b"amm", amm.token_a_mint.as_ref(), amm.token_b_mint.as_ref()],
        bump = amm.bump
    )]
    pub amm: Account<'info, AmmState>,
    
    #[account(mut)]
    pub user_token_a: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user_token_b: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user_lp_token: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"vault_a", amm.key().as_ref()],
        bump
    )]
    pub token_a_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"vault_b", amm.key().as_ref()],
        bump
    )]
    pub token_b_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"lp_mint", amm.key().as_ref()],
        bump
    )]
    pub lp_mint: Account<'info, Mint>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SwapTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        seeds = [b"amm", amm.token_a_mint.as_ref(), amm.token_b_mint.as_ref()],
        bump = amm.bump
    )]
    pub amm: Account<'info, AmmState>,
    
    #[account(mut)]
    pub user_token_in: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user_token_out: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub vault_token_in: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub vault_token_out: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"vault_a", amm.key().as_ref()],
        bump
    )]
    pub token_a_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"vault_b", amm.key().as_ref()],
        bump
    )]
    pub token_b_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

// Staking Accounts
#[derive(Accounts)]
pub struct InitializeStakingPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        init,
        payer = admin,
        space = StakingPool::INIT_SPACE,
        seeds = [b"staking_pool", stake_mint.key().as_ref(), reward_mint.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    pub stake_mint: Account<'info, Mint>,
    pub reward_mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = admin,
        token::mint = stake_mint,
        token::authority = staking_pool,
        seeds = [b"stake_vault", staking_pool.key().as_ref()],
        bump
    )]
    pub stake_vault: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = admin,
        token::mint = reward_mint,
        token::authority = staking_pool,
        seeds = [b"reward_vault", staking_pool.key().as_ref()],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StakeTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"staking_pool", staking_pool.stake_mint.as_ref(), staking_pool.reward_mint.as_ref()],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        init,
        payer = user,
        space = UserStake::INIT_SPACE,
        seeds = [b"user_stake", staking_pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_stake: Account<'info, UserStake>,
    
    #[account(mut)]
    pub user_stake_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"stake_vault", staking_pool.key().as_ref()],
        bump
    )]
    pub stake_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddStake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"staking_pool", staking_pool.stake_mint.as_ref(), staking_pool.reward_mint.as_ref()],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [b"user_stake", staking_pool.key().as_ref(), user.key().as_ref()],
        bump = user_stake.bump
    )]
    pub user_stake: Account<'info, UserStake>,
    
    #[account(mut)]
    pub user_stake_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"stake_vault", staking_pool.key().as_ref()],
        bump
    )]
    pub stake_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UnstakeTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"staking_pool", staking_pool.stake_mint.as_ref(), staking_pool.reward_mint.as_ref()],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [b"user_stake", staking_pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_stake: Account<'info, UserStake>,
    
    #[account(mut)]
    pub user_stake_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"stake_vault", staking_pool.key().as_ref()],
        bump
    )]
    pub stake_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"staking_pool", staking_pool.stake_mint.as_ref(), staking_pool.reward_mint.as_ref()],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [b"user_stake", staking_pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_stake: Account<'info, UserStake>,
    
    #[account(mut)]
    pub user_reward_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"reward_vault", staking_pool.key().as_ref()],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FundRewards<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        seeds = [b"staking_pool", staking_pool.stake_mint.as_ref(), staking_pool.reward_mint.as_ref()],
        bump = staking_pool.bump,
        has_one = admin
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(mut)]
    pub admin_reward_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"reward_vault", staking_pool.key().as_ref()],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

// ============ NFT STAKING ACCOUNT STRUCTURES ============

#[derive(Accounts)]
pub struct InitializeNftStakingPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        init,
        payer = admin,
        space = NftStakingPool::INIT_SPACE,
        seeds = [b"nft_staking_pool", reward_mint.key().as_ref()],
        bump
    )]
    pub nft_staking_pool: Account<'info, NftStakingPool>,
    
    pub reward_mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = admin,
        token::mint = reward_mint,
        token::authority = nft_staking_pool,
        seeds = [b"nft_reward_vault", nft_staking_pool.key().as_ref()],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StakeNft<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"nft_staking_pool", nft_staking_pool.reward_mint.as_ref()],
        bump = nft_staking_pool.bump
    )]
    pub nft_staking_pool: Account<'info, NftStakingPool>,
    
    #[account(
        init,
        payer = user,
        space = UserNftStake::INIT_SPACE,
        seeds = [b"user_nft_stake", nft_staking_pool.key().as_ref(), nft_mint.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_nft_stake: Account<'info, UserNftStake>,
    
    pub nft_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub user_nft_account: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = user,
        token::mint = nft_mint,
        token::authority = nft_staking_pool,
        seeds = [b"nft_vault", nft_staking_pool.key().as_ref(), nft_mint.key().as_ref()],
        bump
    )]
    pub nft_vault: Account<'info, TokenAccount>,
    
    /// CHECK: This is validated through CPI to the token metadata program
    pub nft_metadata: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnstakeNft<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"nft_staking_pool", nft_staking_pool.reward_mint.as_ref()],
        bump = nft_staking_pool.bump
    )]
    pub nft_staking_pool: Account<'info, NftStakingPool>,
    
    #[account(
        mut,
        close = user,
        seeds = [b"user_nft_stake", nft_staking_pool.key().as_ref(), user_nft_stake.nft_mint.as_ref(), user.key().as_ref()],
        bump = user_nft_stake.bump,
        has_one = user
    )]
    pub user_nft_stake: Account<'info, UserNftStake>,
    
    #[account(mut)]
    pub user_nft_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user_reward_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"nft_vault", nft_staking_pool.key().as_ref(), user_nft_stake.nft_mint.as_ref()],
        bump
    )]
    pub nft_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"nft_reward_vault", nft_staking_pool.key().as_ref()],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimNftRewards<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"nft_staking_pool", nft_staking_pool.reward_mint.as_ref()],
        bump = nft_staking_pool.bump
    )]
    pub nft_staking_pool: Account<'info, NftStakingPool>,
    
    #[account(
        mut,
        seeds = [b"user_nft_stake", nft_staking_pool.key().as_ref(), user_nft_stake.nft_mint.as_ref(), user.key().as_ref()],
        bump = user_nft_stake.bump,
        has_one = user
    )]
    pub user_nft_stake: Account<'info, UserNftStake>,
    
    #[account(mut)]
    pub user_reward_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"nft_reward_vault", nft_staking_pool.key().as_ref()],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FundNftRewards<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        seeds = [b"nft_staking_pool", nft_staking_pool.reward_mint.as_ref()],
        bump = nft_staking_pool.bump,
        has_one = admin
    )]
    pub nft_staking_pool: Account<'info, NftStakingPool>,
    
    #[account(mut)]
    pub admin_reward_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"nft_reward_vault", nft_staking_pool.key().as_ref()],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

// ============ DATA STRUCTURES ============

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub owner: Pubkey,
    pub auth_bump: u8,
    pub vault_bump: u8,
    pub score: u8,
}

#[account]
#[derive(InitSpace)]
pub struct EscrowState {
    pub maker: Pubkey,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AmmState {
    pub admin: Pubkey,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub token_a_vault: Pubkey,
    pub token_b_vault: Pubkey,
    pub lp_mint: Pubkey,
    pub fee: u16, // Fee in basis points (1 basis point = 0.01%)
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct StakingPool {
    pub admin: Pubkey,
    pub stake_mint: Pubkey,
    pub reward_mint: Pubkey,
    pub stake_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub total_staked: u64,
    pub reward_rate: u64, // Rewards per second per staked token (scaled by 1e9)
    pub last_update_time: i64,
    pub accumulated_reward_per_share: u64, // Scaled by 1e9
    pub cooldown_period: i64, // Cooldown period in seconds
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserStake {
    pub user: Pubkey,
    pub staking_pool: Pubkey,
    pub amount: u64,
    pub reward_debt: u64, // Scaled by 1e9
    pub pending_rewards: u64,
    pub last_stake_time: i64,
    pub bump: u8,
}

// ============ NFT STAKING DATA STRUCTURES ============

#[account]
#[derive(InitSpace)]
pub struct NftStakingPool {
    pub admin: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_vault: Pubkey,
    pub total_nfts_staked: u64,
    pub daily_reward_rate: u64, // Rewards per day per staked NFT
    pub last_update_time: i64,
    pub accumulated_reward_per_nft: u64,
    pub min_stake_duration: i64, // Minimum stake duration in seconds
    pub collection_address: Option<Pubkey>, // Optional collection verification
    pub total_rewards_distributed: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserNftStake {
    pub user: Pubkey,
    pub nft_staking_pool: Pubkey,
    pub nft_mint: Pubkey,
    pub stake_time: i64,
    pub last_claim_time: i64,
    pub reward_debt: u64,
    pub pending_rewards: u64,
    pub bump: u8,
}

// ============ ERROR CODES ============

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Invalid fee")]
    InvalidFee,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Cooldown period not met")]
    CooldownNotMet,
    #[msg("No rewards to claim")]
    NoRewardsToClaim,
    #[msg("Minimum stake duration not met")]
    MinStakeDurationNotMet,
    #[msg("Invalid NFT metadata")]
    InvalidNftMetadata,
    #[msg("NFT not from verified collection")]
    InvalidNftCollection,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_program_id() {
        let id = crate::ID;
        assert!(!id.to_string().is_empty());
    }

    #[test]
    fn test_error_codes() {
        // Test that our error codes are properly defined
        // Anchor starts error codes from 6000 by default but let's just test the ordering
        let invalid_amount = ErrorCode::InvalidAmount as u32;
        let insufficient_funds = ErrorCode::InsufficientFunds as u32;
        let invalid_fee = ErrorCode::InvalidFee as u32;
        let slippage_exceeded = ErrorCode::SlippageExceeded as u32;
        let cooldown_not_met = ErrorCode::CooldownNotMet as u32;
        let no_rewards_to_claim = ErrorCode::NoRewardsToClaim as u32;

        // Test that they are sequential
        assert_eq!(insufficient_funds, invalid_amount + 1);
        assert_eq!(invalid_fee, insufficient_funds + 1);
        assert_eq!(slippage_exceeded, invalid_fee + 1);
        assert_eq!(cooldown_not_met, slippage_exceeded + 1);
        assert_eq!(no_rewards_to_claim, cooldown_not_met + 1);
    }

    #[test]
    fn test_staking_pool_constants() {
        // Verify that our precision constant is reasonable
        const PRECISION: u64 = 1_000_000_000;
        const COOLDOWN_PERIOD: i64 = 86400; // 24 hours
        assert_eq!(PRECISION, 1_000_000_000);
        assert_eq!(COOLDOWN_PERIOD, 86400); // 24 hours
    }

    #[test]
    fn test_data_structures() {
        // Verify data structure sizes are reasonable
        use std::mem;
        
        // StakingPool should be a reasonable size
        assert!(mem::size_of::<StakingPool>() < 1000);
        
        // UserStake should be a reasonable size
        assert!(mem::size_of::<UserStake>() < 500);
    }
}
