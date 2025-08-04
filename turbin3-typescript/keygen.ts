import { config } from 'dotenv';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

// Load environment variables
config();

// Create a Solana devnet connection
const rpcUrl = process.env.SOLANA_RPC_URL;
if (!rpcUrl) {
    console.error("❌ SOLANA_RPC_URL not set in environment variables");
    console.log("Please set SOLANA_RPC_URL in your .env file");
    process.exit(1);
}
const connection = new Connection(rpcUrl);

// Generate a new keypair
const keypair = Keypair.generate();

console.log("You've generated a new Solana wallet:", keypair.publicKey.toBase58());
console.log("");
console.log("To save your wallet, copy and paste the following into a JSON file:");
console.log(JSON.stringify(Array.from(keypair.secretKey)));

export default keypair;
