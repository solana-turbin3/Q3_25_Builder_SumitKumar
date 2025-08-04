/**
 * Configuration management module
 * Handles environment variables and provides typed configuration access
 * Follows best practices with no hardcoded values
 */

import { config } from 'dotenv';
import { PublicKey, Commitment } from '@solana/web3.js';
import { existsSync } from 'fs';
import { join } from 'path';
import { validateEnvironmentVariable, ApplicationError, ErrorCategory, Validator } from '../utils/errorHandling';

// Load environment variables
config();

export interface SolanaConfig {
  network: 'devnet' | 'testnet' | 'mainnet-beta';
  rpcUrl: string;
  commitment: Commitment;
}

export interface ProgramConfig {
  turbin3VaultProgramId?: PublicKey;
  wbaPrereqProgramId?: PublicKey;
}

export interface WalletConfig {
  walletPath: string;
  exampleWalletPath: string;
}

export interface NFTConfig {
  irysUploadUrl: string;
  defaultSymbol: string;
  defaultCreatorShare: number;
}

export interface VaultConfig {
  vaultStateAddress?: PublicKey;
  vaultAuthAddress?: PublicKey;
  vaultAddress?: PublicKey;
}

export interface TestConfig {
  airdropAmount: number;
  timeoutMs: number;
}

export interface SecurityConfig {
  requireConfirmation: boolean;
  maxRetryAttempts: number;
}

export interface AppConfig {
  solana: SolanaConfig;
  programs: ProgramConfig;
  wallet: WalletConfig;
  nft: NFTConfig;
  vault: VaultConfig;
  test: TestConfig;
  security: SecurityConfig;
  logLevel: string;
  debugMode: boolean;
}

/**
 * Get environment variable with type safety and validation
 */
function getEnvVar(key: string, defaultValue?: string, required: boolean = false): string {
  const value = process.env[key] || defaultValue;
  return validateEnvironmentVariable(key, value, 'getEnvVar', required);
}

/**
 * Get environment variable as number
 */
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new ApplicationError(
      `Environment variable ${key} must be a valid number, got: ${value}`,
      ErrorCategory.CONFIGURATION,
      'getEnvNumber',
      false,
      { envVar: key, value }
    );
  }
  
  return parsed;
}

/**
 * Get environment variable as boolean
 */
function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  
  return value.toLowerCase() === 'true';
}

/**
 * Get PublicKey from environment variable
 */
function getEnvPublicKey(key: string): PublicKey | undefined {
  const value = process.env[key];
  if (!value) {
    return undefined;
  }
  
  // Validate that it's not a placeholder
  validateEnvironmentVariable(key, value, 'getEnvPublicKey', false);
  
  if (!Validator.isValidPublicKey(value)) {
    throw new ApplicationError(
      `Invalid PublicKey format in environment variable ${key}: ${value}`,
      ErrorCategory.CONFIGURATION,
      'getEnvPublicKey',
      false,
      { envVar: key, value }
    );
  }
  
  try {
    return new PublicKey(value);
  } catch (error) {
    throw new ApplicationError(
      `Failed to create PublicKey from environment variable ${key}: ${value}`,
      ErrorCategory.CONFIGURATION,
      'getEnvPublicKey',
      false,
      { envVar: key, value, error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Validate that required files exist
 */
function validateFilePaths(config: AppConfig): void {
  const walletPath = join(process.cwd(), config.wallet.walletPath);
  const exampleWalletPath = join(process.cwd(), config.wallet.exampleWalletPath);
  
  if (!existsSync(walletPath) && !existsSync(exampleWalletPath)) {
    console.warn(`Warning: Neither wallet file exists: ${walletPath} or ${exampleWalletPath}`);
    console.warn('You may need to run "npm run keygen" to create a wallet');
  }
}

/**
 * Get RPC URL based on network with validation
 */
function getRpcUrl(network: string): string {
  if (!Validator.isValidNetwork(network)) {
    throw new ApplicationError(
      `Invalid network: ${network}. Must be one of: devnet, testnet, mainnet-beta`,
      ErrorCategory.CONFIGURATION,
      'getRpcUrl',
      false,
      { network }
    );
  }

  let rpcUrl: string;
  switch (network) {
    case 'devnet':
      rpcUrl = getEnvVar('DEVNET_RPC_URL', undefined, true);
      break;
    case 'testnet':
      rpcUrl = getEnvVar('TESTNET_RPC_URL', undefined, true);
      break;
    case 'mainnet-beta':
      rpcUrl = getEnvVar('MAINNET_RPC_URL', undefined, true);
      break;
    default:
      throw new ApplicationError(
        `Unsupported network: ${network}`,
        ErrorCategory.CONFIGURATION,
        'getRpcUrl',
        false,
        { network }
      );
  }

  if (!Validator.isValidUrl(rpcUrl)) {
    throw new ApplicationError(
      `Invalid RPC URL for network ${network}: ${rpcUrl}`,
      ErrorCategory.CONFIGURATION,
      'getRpcUrl',
      false,
      { network, rpcUrl }
    );
  }

  return rpcUrl;
}

/**
 * Create and validate application configuration
 */
function createConfig(): AppConfig {
  const network = getEnvVar('SOLANA_NETWORK', 'devnet');
  if (!Validator.isValidNetwork(network)) {
    throw new ApplicationError(
      `Invalid SOLANA_NETWORK: ${network}. Must be one of: devnet, testnet, mainnet-beta`,
      ErrorCategory.CONFIGURATION,
      'createConfig',
      false,
      { network }
    );
  }

  const rpcUrl = getEnvVar('SOLANA_RPC_URL') || getRpcUrl(network);
  
  // Always validate the final RPC URL
  if (!Validator.isValidUrl(rpcUrl)) {
    throw new ApplicationError(
      `Invalid SOLANA_RPC_URL: ${rpcUrl}`,
      ErrorCategory.CONFIGURATION,
      'createConfig',
      false,
      { rpcUrl }
    );
  }
  
  const commitment = getEnvVar('SOLANA_COMMITMENT', 'confirmed') as Commitment;
  
  if (!Validator.isValidCommitment(commitment)) {
    throw new ApplicationError(
      `Invalid SOLANA_COMMITMENT: ${commitment}. Must be one of: processed, confirmed, finalized`,
      ErrorCategory.CONFIGURATION,
      'createConfig',
      false,
      { commitment }
    );
  }
  
  const config: AppConfig = {
    solana: {
      network,
      rpcUrl,
      commitment,
    },
    programs: {
      turbin3VaultProgramId: getEnvPublicKey('TURBIN3_VAULT_PROGRAM_ID'),
      wbaPrereqProgramId: getEnvPublicKey('WBA_PREREQ_PROGRAM_ID'),
    },
    wallet: {
      walletPath: getEnvVar('WALLET_PATH', undefined, true),
      exampleWalletPath: getEnvVar('EXAMPLE_WALLET_PATH', undefined, true),
    },
    nft: {
      irysUploadUrl: getEnvVar('IRYS_UPLOAD_URL', undefined, true),
      defaultSymbol: getEnvVar('DEFAULT_NFT_SYMBOL', undefined, true),
      defaultCreatorShare: getEnvNumber('DEFAULT_NFT_CREATOR_SHARE', 100),
    },
    vault: {
      vaultStateAddress: getEnvPublicKey('VAULT_STATE_ADDRESS'),
      vaultAuthAddress: getEnvPublicKey('VAULT_AUTH_ADDRESS'),
      vaultAddress: getEnvPublicKey('VAULT_ADDRESS'),
    },
    test: {
      airdropAmount: getEnvNumber('TEST_AIRDROP_AMOUNT', 10),
      timeoutMs: getEnvNumber('TEST_TIMEOUT_MS', 30000),
    },
    security: {
      requireConfirmation: getEnvBoolean('REQUIRE_CONFIRMATION', true),
      maxRetryAttempts: getEnvNumber('MAX_RETRY_ATTEMPTS', 3),
    },
    logLevel: getEnvVar('LOG_LEVEL', 'info'),
    debugMode: getEnvBoolean('DEBUG_MODE', false),
  };
  
  validateFilePaths(config);
  
  return config;
}

// Export singleton configuration instance
export const appConfig = createConfig();

/**
 * Utility function to get wallet path with fallback
 */
export function getWalletPath(): string {
  const primaryPath = join(process.cwd(), appConfig.wallet.walletPath);
  const fallbackPath = join(process.cwd(), appConfig.wallet.exampleWalletPath);
  
  if (existsSync(primaryPath)) {
    return primaryPath;
  } else if (existsSync(fallbackPath)) {
    console.warn(`Using fallback wallet: ${fallbackPath}`);
    return fallbackPath;
  } else {
    throw new Error(`No wallet file found. Please create ${primaryPath} or run "npm run keygen"`);
  }
}

/**
 * Utility function to check if vault addresses are configured
 */
export function isVaultConfigured(): boolean {
  return !!(appConfig.vault.vaultStateAddress && 
           appConfig.vault.vaultAuthAddress && 
           appConfig.vault.vaultAddress);
}

/**
 * Display current configuration (safe for logging)
 */
export function displayConfig(): void {
  console.log('Current Configuration:');
  console.log(`  Network: ${appConfig.solana.network}`);
  console.log(`  RPC URL: ${appConfig.solana.rpcUrl}`);
  console.log(`  Commitment: ${appConfig.solana.commitment}`);
  console.log(`  Wallet Path: ${appConfig.wallet.walletPath}`);
  console.log(`  Vault Configured: ${isVaultConfigured()}`);
  console.log(`  Debug Mode: ${appConfig.debugMode}`);
}
