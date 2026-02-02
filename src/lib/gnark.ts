/**
 * Gnark proof generation client for Psephos voting
 * 
 * This module provides functions to generate Gnark ZK proofs
 * either via the proof server (for Gnark proofs) or via Noir.js
 * (for Barretenberg proofs, client-side).
 * 
 * The program now accepts both formats, with structured validation
 * of the proof and public witness.
 */

// Proof server URL - can be configured via environment
const PROOF_SERVER_URL = import.meta.env.VITE_PROOF_SERVER_URL || 'http://localhost:3001';

/**
 * Input data for generating a voting proof
 */
export interface VoteProofInput {
  tokenBalance: bigint;
  voterSecret: bigint;
  voteChoice: number;
  minTokenThreshold: bigint;
  proposalId: bigint;
}

/**
 * Output from proof generation
 */
export interface VoteProofOutput {
  proof: Uint8Array;
  publicWitness: Uint8Array;
  publicInputs: {
    nullifier: Uint8Array;
    voteCommitment: Uint8Array;
    minTokenThreshold: bigint;
    proposalId: bigint;
  };
}

/**
 * Convert a bigint to a 0x-prefixed hex string (32 bytes / 64 chars)
 */
function toFieldHex(value: bigint): string {
  return '0x' + value.toString(16).padStart(64, '0');
}

/**
 * Check if the proof server is available
 */
export async function isProofServerAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${PROOF_SERVER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json();
      return data.status === 'healthy' && data.circuitsCompiled;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Generate a Gnark ZK proof using the proof server
 * 
 * This requires:
 * 1. Pre-computed nullifier and vote commitment (from Noir.js)
 * 2. Running proof server with Sunspot installed
 * 
 * @param input Vote proof input data
 * @param nullifier Pre-computed nullifier (pedersen_hash([voterSecret, proposalId]))
 * @param voteCommitment Pre-computed commitment (pedersen_hash([voteChoice, voterSecret, proposalId]))
 */
export async function generateGnarkProof(
  input: VoteProofInput,
  nullifier: Uint8Array,
  voteCommitment: Uint8Array
): Promise<VoteProofOutput> {
  const response = await fetch(`${PROOF_SERVER_URL}/generate-proof-with-hashes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tokenBalance: input.tokenBalance.toString(),
      voterSecret: toFieldHex(input.voterSecret),
      voteChoice: input.voteChoice.toString(),
      minTokenThreshold: input.minTokenThreshold.toString(),
      proposalId: toFieldHex(input.proposalId),
      nullifier: '0x' + Array.from(nullifier).map(b => b.toString(16).padStart(2, '0')).join(''),
      voteCommitment: '0x' + Array.from(voteCommitment).map(b => b.toString(16).padStart(2, '0')).join(''),
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to generate Gnark proof');
  }
  
  const data = await response.json();
  
  return {
    proof: new Uint8Array(data.proof),
    publicWitness: new Uint8Array(data.publicWitness),
    publicInputs: {
      nullifier: new Uint8Array(data.nullifier),
      voteCommitment: new Uint8Array(data.voteCommitment),
      minTokenThreshold: input.minTokenThreshold,
      proposalId: input.proposalId,
    },
  };
}

/**
 * Build a public witness buffer compatible with Gnark format
 * 
 * Format:
 * - 4 bytes: number of public inputs (big-endian u32)
 * - 4 bytes: size of each element (big-endian u32, always 32)
 * - N x 32 bytes: public inputs
 * 
 * Public inputs order for our circuit:
 * 1. min_token_threshold (u64 as 32-byte field)
 * 2. proposal_id (Field, 32 bytes)
 * 3. vote_commitment (Field, 32 bytes)
 * 4. nullifier (Field, 32 bytes)
 */
export function buildPublicWitness(
  minTokenThreshold: bigint,
  proposalId: bigint,
  voteCommitment: Uint8Array,
  nullifier: Uint8Array
): Uint8Array {
  const NUM_INPUTS = 4;
  const ELEMENT_SIZE = 32;
  const HEADER_SIZE = 8;
  
  const buffer = new Uint8Array(HEADER_SIZE + NUM_INPUTS * ELEMENT_SIZE);
  const view = new DataView(buffer.buffer);
  
  // Header: count (4 bytes) + element size (4 bytes)
  view.setUint32(0, NUM_INPUTS, false); // big-endian
  view.setUint32(4, ELEMENT_SIZE, false); // big-endian
  
  // Public input 1: min_token_threshold (u64 as 32-byte field, last 8 bytes)
  const thresholdOffset = HEADER_SIZE;
  view.setBigUint64(thresholdOffset + 24, minTokenThreshold, false); // big-endian
  
  // Public input 2: proposal_id (Field, 32 bytes)
  const proposalOffset = thresholdOffset + ELEMENT_SIZE;
  const proposalBytes = bigintToBytes32(proposalId);
  buffer.set(proposalBytes, proposalOffset);
  
  // Public input 3: vote_commitment (Field, 32 bytes)
  const commitmentOffset = proposalOffset + ELEMENT_SIZE;
  buffer.set(voteCommitment, commitmentOffset);
  
  // Public input 4: nullifier (Field, 32 bytes)
  const nullifierOffset = commitmentOffset + ELEMENT_SIZE;
  buffer.set(nullifier, nullifierOffset);
  
  return buffer;
}

/**
 * Convert a bigint to a 32-byte big-endian Uint8Array
 */
function bigintToBytes32(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let remaining = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(remaining & 0xFFn);
    remaining = remaining >> 8n;
  }
  return bytes;
}

/**
 * Parse public inputs from a Gnark public witness buffer
 */
export function parsePublicWitness(witness: Uint8Array): {
  minTokenThreshold: bigint;
  proposalId: bigint;
  voteCommitment: Uint8Array;
  nullifier: Uint8Array;
} {
  const view = new DataView(witness.buffer, witness.byteOffset, witness.byteLength);
  
  // Skip header (8 bytes)
  const HEADER_SIZE = 8;
  const ELEMENT_SIZE = 32;
  
  // Extract min_token_threshold (last 8 bytes of first 32-byte element)
  const thresholdOffset = HEADER_SIZE;
  const minTokenThreshold = view.getBigUint64(thresholdOffset + 24, false);
  
  // Extract proposal_id
  const proposalOffset = thresholdOffset + ELEMENT_SIZE;
  const proposalId = bytes32ToBigint(witness.slice(proposalOffset, proposalOffset + ELEMENT_SIZE));
  
  // Extract vote_commitment
  const commitmentOffset = proposalOffset + ELEMENT_SIZE;
  const voteCommitment = witness.slice(commitmentOffset, commitmentOffset + ELEMENT_SIZE);
  
  // Extract nullifier
  const nullifierOffset = commitmentOffset + ELEMENT_SIZE;
  const nullifier = witness.slice(nullifierOffset, nullifierOffset + ELEMENT_SIZE);
  
  return {
    minTokenThreshold,
    proposalId,
    voteCommitment,
    nullifier,
  };
}

/**
 * Convert a 32-byte big-endian Uint8Array to a bigint
 */
function bytes32ToBigint(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < 32; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}
