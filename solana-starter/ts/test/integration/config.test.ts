/**
 * Integration tests for configuration management
 * Ensures configuration system follows best practices
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';

describe('Configuration Integration Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Environment Variable Loading', () => {
    it('should load default configuration when no env vars set', () => {
      // Clear relevant env vars
      delete process.env.SOLANA_NETWORK;
      delete process.env.SOLANA_RPC_URL;
      delete process.env.SOLANA_COMMITMENT;

      // Re-require config to test fresh load
      delete require.cache[require.resolve('../../config/index')];
      const { appConfig } = require('../../config/index');

      expect(appConfig.solana.network).to.equal('devnet');
      expect(appConfig.solana.commitment).to.equal('confirmed');
      expect(appConfig.solana.rpcUrl).to.include('devnet.solana.com');
    });

    it('should use environment variables when set', () => {
      process.env.SOLANA_NETWORK = 'testnet';
      process.env.SOLANA_COMMITMENT = 'finalized';
      process.env.TEST_AIRDROP_AMOUNT = '5';

      delete require.cache[require.resolve('../../config/index')];
      const { appConfig } = require('../../config/index');

      expect(appConfig.solana.network).to.equal('testnet');
      expect(appConfig.solana.commitment).to.equal('finalized');
      expect(appConfig.test.airdropAmount).to.equal(5);
    });

    it('should reject invalid network values', () => {
      process.env.SOLANA_NETWORK = 'invalid-network';

      delete require.cache[require.resolve('../../config/index')];
      
      expect(() => {
        require('../../config/index');
      }).to.throw();
    });

    it('should reject placeholder values in program IDs', () => {
      process.env.TURBIN3_VAULT_PROGRAM_ID = 'your_program_id_here';

      delete require.cache[require.resolve('../../config/index')];
      
      expect(() => {
        require('../../config/index');
      }).to.throw();
    });
  });

  describe('Public Key Validation', () => {
    it('should handle valid public keys', () => {
      process.env.VAULT_STATE_ADDRESS = '11111111111111111111111111111112';

      delete require.cache[require.resolve('../../config/index')];
      const { appConfig } = require('../../config/index');

      expect(appConfig.vault.vaultStateAddress).to.not.be.undefined;
      expect(appConfig.vault.vaultStateAddress!.toBase58()).to.equal('11111111111111111111111111111112');
    });

    it('should reject invalid public key format', () => {
      process.env.VAULT_STATE_ADDRESS = 'invalid-public-key';

      delete require.cache[require.resolve('../../config/index')];
      
      expect(() => {
        require('../../config/index');
      }).to.throw();
    });
  });

  describe('Configuration Utilities', () => {
    it('should handle wallet path fallback', () => {
      delete require.cache[require.resolve('../../config/index')];
      
      // Temporarily modify environment to point to non-existent wallet
      const originalWalletPath = process.env.WALLET_PATH;
      const originalExamplePath = process.env.EXAMPLE_WALLET_PATH;
      
      process.env.WALLET_PATH = './non-existent-wallet.json';
      process.env.EXAMPLE_WALLET_PATH = './also-non-existent.json';
      
      try {
        const { getWalletPath } = require('../../config/index');
        
        expect(() => {
          getWalletPath();
        }).to.throw(/No wallet file found/);
      } finally {
        // Restore original environment
        if (originalWalletPath) process.env.WALLET_PATH = originalWalletPath;
        if (originalExamplePath) process.env.EXAMPLE_WALLET_PATH = originalExamplePath;
        delete require.cache[require.resolve('../../config/index')];
      }
    });

    it('should check vault configuration status', () => {
      process.env.VAULT_STATE_ADDRESS = '11111111111111111111111111111112';
      process.env.VAULT_AUTH_ADDRESS = '11111111111111111111111111111112';
      process.env.VAULT_ADDRESS = '11111111111111111111111111111112';

      delete require.cache[require.resolve('../../config/index')];
      const { isVaultConfigured } = require('../../config/index');

      expect(isVaultConfigured()).to.be.true;
    });

    it('should display configuration safely', () => {
      delete require.cache[require.resolve('../../config/index')];
      const { displayConfig } = require('../../config/index');

      // Should not throw
      expect(() => {
        displayConfig();
      }).to.not.throw();
    });
  });

  describe('Security Validation', () => {
    it('should validate RPC URLs', () => {
      const originalRpcUrl = process.env.SOLANA_RPC_URL;
      process.env.SOLANA_RPC_URL = 'invalid-url';

      delete require.cache[require.resolve('../../config/index')];
      
      try {
        expect(() => {
          require('../../config/index');
        }).to.throw(/Invalid SOLANA_RPC_URL/);
      } finally {
        // Restore original environment
        if (originalRpcUrl) {
          process.env.SOLANA_RPC_URL = originalRpcUrl;
        } else {
          delete process.env.SOLANA_RPC_URL;
        }
        delete require.cache[require.resolve('../../config/index')];
      }
    });

    it('should validate commitment levels', () => {
      process.env.SOLANA_COMMITMENT = 'invalid-commitment';

      delete require.cache[require.resolve('../../config/index')];
      
      expect(() => {
        require('../../config/index');
      }).to.throw(/Invalid SOLANA_COMMITMENT/);
    });

    it('should validate numeric values', () => {
      process.env.TEST_AIRDROP_AMOUNT = 'not-a-number';

      delete require.cache[require.resolve('../../config/index')];
      
      expect(() => {
        require('../../config/index');
      }).to.throw(/must be a valid number/);
    });
  });
});
