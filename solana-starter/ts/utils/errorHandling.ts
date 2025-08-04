/**
 * Enhanced error handling utilities for production applications
 * Provides robust error management with retry mechanisms
 */

export enum ErrorCategory {
  CONFIGURATION = 'CONFIGURATION',
  NETWORK = 'NETWORK',
  WALLET = 'WALLET',
  TRANSACTION = 'TRANSACTION',
  VALIDATION = 'VALIDATION',
  PROGRAM = 'PROGRAM',
  FILE_SYSTEM = 'FILE_SYSTEM'
}

export interface ErrorContext {
  category: ErrorCategory;
  operation: string;
  details?: Record<string, any>;
  timestamp: Date;
  stack?: string;
}

export class ApplicationError extends Error {
  public readonly category: ErrorCategory;
  public readonly context: ErrorContext;
  public readonly isRetryable: boolean;

  constructor(
    message: string,
    category: ErrorCategory,
    operation: string,
    isRetryable: boolean = false,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ApplicationError';
    this.category = category;
    this.isRetryable = isRetryable;
    this.context = {
      category,
      operation,
      details,
      timestamp: new Date(),
      stack: this.stack
    };
  }
}

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier: number;
  retryableCategories: ErrorCategory[];
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
  retryableCategories: [ErrorCategory.NETWORK, ErrorCategory.TRANSACTION]
};

/**
 * Execute an operation with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | ApplicationError | undefined;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if error is retryable
      const isRetryable = error instanceof ApplicationError
        ? error.isRetryable && opts.retryableCategories.includes(error.category)
        : opts.retryableCategories.includes(ErrorCategory.NETWORK);
      
      if (attempt === opts.maxAttempts || !isRetryable) {
        break;
      }
      
      const delay = opts.delayMs * Math.pow(opts.backoffMultiplier, attempt - 1);
      console.warn(`⚠️  Attempt ${attempt}/${opts.maxAttempts} failed for ${operationName}. Retrying in ${delay}ms...`);
      console.warn(`   Error: ${lastError.message}`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  const finalError = lastError || new Error('Unknown error occurred');
  throw new ApplicationError(
    `Operation '${operationName}' failed after ${opts.maxAttempts} attempts: ${finalError.message}`,
    ErrorCategory.NETWORK,
    operationName,
    false,
    { attempts: opts.maxAttempts, lastError: finalError.message }
  );
}

/**
 * Validate required environment variables
 */
export function validateEnvironmentVariable(
  key: string,
  value: string | undefined,
  operation: string,
  required: boolean = true
): string {
  if (required && (!value || value.trim() === '')) {
    throw new ApplicationError(
      `Required environment variable ${key} is not set or empty`,
      ErrorCategory.CONFIGURATION,
      operation,
      false,
      { envVar: key }
    );
  }
  
  // Check for placeholder values
  const placeholderPatterns = [
    /^your_.*_here$/i,
    /^replace_with_.*$/i,
    /^todo_.*$/i,
    /^example\..*$/i,
    /^.*_public_key_here$/i
  ];
  
  if (value && placeholderPatterns.some(pattern => pattern.test(value))) {
    throw new ApplicationError(
      `Environment variable ${key} contains placeholder value: ${value}`,
      ErrorCategory.CONFIGURATION,
      operation,
      false,
      { envVar: key, value }
    );
  }
  
  return value || '';
}

/**
 * Safely parse JSON with error context
 */
export function safeJsonParse<T>(
  jsonString: string,
  operation: string,
  fallback?: T
): T {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    if (fallback !== undefined) {
      console.warn(`⚠️  JSON parse failed for ${operation}, using fallback`);
      return fallback;
    }
    
    throw new ApplicationError(
      `Failed to parse JSON for ${operation}`,
      ErrorCategory.VALIDATION,
      operation,
      false,
      { jsonString: jsonString.substring(0, 100) + '...' }
    );
  }
}

/**
 * Enhanced console logging with error context
 */
export class Logger {
  private static logLevel: string = process.env.LOG_LEVEL || 'info';
  private static debugMode: boolean = process.env.DEBUG_MODE === 'true';

  static debug(message: string, context?: Record<string, any>): void {
    if (this.debugMode) {
      console.log(`🔍 DEBUG: ${message}`, context ? JSON.stringify(context, null, 2) : '');
    }
  }

  static info(message: string, context?: Record<string, any>): void {
    console.log(`ℹ️  INFO: ${message}`, context ? JSON.stringify(context, null, 2) : '');
  }

  static warn(message: string, context?: Record<string, any>): void {
    console.warn(`⚠️  WARN: ${message}`, context ? JSON.stringify(context, null, 2) : '');
  }

  static error(message: string, error?: Error | ApplicationError, context?: Record<string, any>): void {
    console.error(`❌ ERROR: ${message}`);
    
    if (error instanceof ApplicationError) {
      console.error(`   Category: ${error.category}`);
      console.error(`   Operation: ${error.context.operation}`);
      console.error(`   Retryable: ${error.isRetryable}`);
      console.error(`   Details:`, error.context.details);
    } else if (error) {
      console.error(`   Message: ${error.message}`);
      if (this.debugMode && error.stack) {
        console.error(`   Stack: ${error.stack}`);
      }
    }
    
    if (context) {
      console.error(`   Context:`, JSON.stringify(context, null, 2));
    }
  }

  static success(message: string, context?: Record<string, any>): void {
    console.log(`✅ SUCCESS: ${message}`, context ? JSON.stringify(context, null, 2) : '');
  }
}

/**
 * Graceful process exit with cleanup
 */
export function gracefulExit(
  code: number = 0,
  message?: string,
  error?: Error | ApplicationError
): never {
  if (message) {
    if (code === 0) {
      Logger.success(message);
    } else {
      Logger.error(message, error);
    }
  }
  
  // Add any cleanup logic here if needed
  process.exit(code);
}

/**
 * Input validation utilities
 */
export class Validator {
  static isValidPublicKey(value: string): boolean {
    try {
      // Basic validation - 32 bytes base58 encoded should be 43-44 characters
      return value.length >= 32 && value.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(value);
    } catch {
      return false;
    }
  }

  static isValidUrl(value: string): boolean {
    if (!value) return false;
    
    try {
      const url = new URL(value);
      // Only allow http and https protocols
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  static isValidNetwork(value: string): value is 'devnet' | 'testnet' | 'mainnet-beta' {
    return ['devnet', 'testnet', 'mainnet-beta'].includes(value);
  }

  static isValidCommitment(value: string): boolean {
    return ['processed', 'confirmed', 'finalized'].includes(value);
  }
}
