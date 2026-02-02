/**
 * Noir API Client for Psephos - Dual Backend Architecture
 *
 * This module provides a unified interface for ZK proof generation with two backends:
 * 1. Server-side (Sunspot/gnark) - Default, faster, lighter on-chain verification
 * 2. Browser-side (Barretenberg/bb.js) - Optional, fully client-side, enables recursion
 *
 * The dual-backend approach addresses the sponsor's requirement:
 * "Extra points if you get a Sunspot -> Barretenberg recursively verifier built,
 *  then bb.js in browser hehe"
 */

import {
  generateVoteProofInBrowser,
  isBrowserProvingAvailable,
  getEstimatedProvingTime,
} from './browser-proving';

const API_URL = import.meta.env.VITE_PROOF_API_URL || 'http://localhost:3001';

/**
 * Proving backend selection
 */
export enum ProvingBackend {
  SERVER = 'server', // Sunspot (default)
  BROWSER = 'browser', // Barretenberg
  AUTO = 'auto', // Try server first, fallback to browser
}

let currentBackend: ProvingBackend = ProvingBackend.SERVER;

/**
 * Input data for generating a voting proof
 */
export interface VoteProofInput {
  // Private inputs (not revealed)
  tokenBalance: bigint;
  voterSecret: bigint;
  voteChoice: number;
  
  // Public inputs (revealed in proof)
  minTokenThreshold: bigint;
  proposalId: bigint;
}

/**
 * Output from proof generation
 */
export interface VoteProofOutput {
  proof: Uint8Array;
  publicInputs: {
    minTokenThreshold: bigint;
    proposalId: bigint;
    voteCommitment: Uint8Array;
    nullifier: Uint8Array;
  };
}

/**
 * Set the proving backend (server or browser).
 */
export function setProvingBackend(backend: ProvingBackend): void {
  currentBackend = backend;
  console.log(`🔧 Proving backend set to: ${backend}`);
}

/**
 * Get the current proving backend.
 */
export function getProvingBackend(): ProvingBackend {
  return currentBackend;
}

/**
 * Generate a ZK proof for a vote using the selected backend.
 *
 * Backends:
 * - SERVER: Uses Sunspot (gnark/groth16) via API - faster, lighter verification
 * - BROWSER: Uses Barretenberg (bb.js) in browser - slower, full client-side privacy
 * - AUTO: Try server first, fallback to browser if unavailable
 *
 * @param input The vote proof inputs
 * @param backend Optional backend override (defaults to current backend)
 * @returns The proof and public inputs
 */
export async function generateVoteProof(
  input: VoteProofInput,
  backend?: ProvingBackend
): Promise<VoteProofOutput> {
  const selectedBackend = backend || currentBackend;

  // Handle AUTO mode
  if (selectedBackend === ProvingBackend.AUTO) {
    // Try server first
    const serverHealthy = await checkProofServerHealth();
    if (serverHealthy) {
      console.log("🚀 Using server-side proving (Sunspot)");
      return generateVoteProofServer(input);
    }

    // Fallback to browser
    console.log("⚠️ Server unavailable, falling back to browser proving (Barretenberg)");
    const browserAvailable = await isBrowserProvingAvailable();
    if (!browserAvailable) {
      throw new Error('Neither server nor browser proving is available');
    }
    return generateVoteProofInBrowser(input);
  }

  // Use specific backend
  if (selectedBackend === ProvingBackend.BROWSER) {
    console.log("🌐 Using browser-side proving (Barretenberg/bb.js)");
    return generateVoteProofInBrowser(input);
  }

  console.log("🚀 Using server-side proving (Sunspot/gnark)");
  return generateVoteProofServer(input);
}

/**
 * Generate a ZK proof using the server API (Sunspot backend).
 *
 * @param input The vote proof inputs
 * @returns The proof and public inputs
 */
async function generateVoteProofServer(input: VoteProofInput): Promise<VoteProofOutput> {
  console.log("Generating vote proof via server API (Sunspot)...");

  try {
    const response = await fetch(`${API_URL}/generate-proof`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tokenBalance: input.tokenBalance.toString(),
        voterSecret: input.voterSecret.toString(),
        voteChoice: input.voteChoice.toString(),
        minTokenThreshold: input.minTokenThreshold.toString(),
        proposalId: input.proposalId.toString(),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate proof');
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Proof generation failed');
    }

    console.log("Proof generated successfully");
    console.log("Proof size:", result.proof.length, "characters (base64)");
    
    // Convert base64 to Uint8Array
    const proofBytes = base64ToBytes(result.proof);
    // const publicWitnessBytes = base64ToBytes(result.publicWitness); // For future use
    
    return {
      proof: proofBytes,
      publicInputs: {
        minTokenThreshold: input.minTokenThreshold,
        proposalId: input.proposalId,
        voteCommitment: hexToBytes(result.publicInputs.voteCommitment),
        nullifier: hexToBytes(result.publicInputs.nullifier),
      },
    };
  } catch (error) {
    console.error("Failed to generate proof:", error);
    throw error;
  }
}

/**
 * Verify a vote proof locally (for testing/debugging).
 * In production, verification happens on-chain via Sunspot.
 */
export async function verifyVoteProof(proof: Uint8Array, publicWitness: Uint8Array): Promise<boolean> {
  console.log("Verifying proof via API...");
  
  try {
    const response = await fetch(`${API_URL}/verify-proof`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        proof: bytesToBase64(proof),
        publicWitness: bytesToBase64(publicWitness),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to verify proof');
    }

    const result = await response.json();
    console.log("Proof verification result:", result.valid);
    
    return result.valid;
  } catch (error) {
    console.error("Failed to verify proof:", error);
    throw error;
  }
}

/**
 * Generate a cryptographically secure voter secret.
 * This should be stored securely by the user.
 */
export function generateVoterSecret(): bigint {
  const bytes = new Uint8Array(31); // 31 bytes to stay under Field max
  crypto.getRandomValues(bytes);
  
  // Convert to bigint
  let secret = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    secret = (secret << BigInt(8)) | BigInt(bytes[i]);
  }
  
  return secret;
}

/**
 * Convert a secret phrase to a voter secret (deterministic).
 * This allows users to recover their secret from a memorable phrase.
 */
export async function phraseToVoterSecret(phrase: string): Promise<bigint> {
  const encoder = new TextEncoder();
  const data = encoder.encode(phrase);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  
  // Use first 31 bytes to stay under Field max
  let secret = BigInt(0);
  for (let i = 0; i < 31; i++) {
    secret = (secret << BigInt(8)) | BigInt(hashArray[i]);
  }
  
  return secret;
}

/**
 * Check if the proof server is healthy
 */
export async function checkProofServerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/health`);
    if (!response.ok) return false;
    const data = await response.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Get information about available proving backends
 */
export async function getBackendInfo(): Promise<{
  current: ProvingBackend;
  serverAvailable: boolean;
  browserAvailable: boolean;
  estimatedTime: { server: number; browser: number };
}> {
  const [serverAvailable, browserAvailable] = await Promise.all([
    checkProofServerHealth(),
    isBrowserProvingAvailable(),
  ]);

  return {
    current: currentBackend,
    serverAvailable,
    browserAvailable,
    estimatedTime: {
      server: 8, // 5-10 seconds average
      browser: getEstimatedProvingTime(), // 30-60 seconds average
    },
  };
}

// Utility functions

function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binaryString = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}

function hexToBytes(hex: string): Uint8Array {
  // Remove 0x prefix if present
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  // Pad to 64 characters (32 bytes)
  const paddedHex = cleanHex.padStart(64, "0");
  
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(paddedHex.substr(i * 2, 2), 16);
  }
  return bytes;
}