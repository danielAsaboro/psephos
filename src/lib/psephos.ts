import {
  getProgramDerivedAddress,
  getAddressEncoder,
  getBytesEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";

// SPL Token Program ID
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
// Associated Token Program ID
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;
// ZK Verifier Program ID (Sunspot)
const ZK_VERIFIER_PROGRAM_ID = "G616ZLAnrgeb7FrAvavozAyKmgzsuncz1XTvBYiUzh4H" as Address;
import {
  getCreateProposalInstructionDataEncoder,
  getCastVoteInstructionDataEncoder,
  getRevealVoteInstructionDataEncoder,
  getFinalizeProposalInstructionDataEncoder,
  PSEPHOS_PROGRAM_ADDRESS,
  getProposalDecoder,
  getProposalResultsDecoder,
} from "../generated/psephos";

const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111" as Address;

// RPC endpoint - use devnet
const RPC_URL = "https://api.devnet.solana.com";

// Types matching the on-chain structures
export interface ProposalData {
  id: bigint;
  creator: Address;
  title: string;
  options: string[];
  tokenMint: Address;
  minThreshold: bigint;
  startTime: bigint;
  endTime: bigint;
  voteCount: bigint;
  isFinalized: boolean;
  bump: number;
  address: Address;
}

export interface ProposalResultsData {
  proposal: Address;
  tallies: bigint[];
  isFinalized: boolean;
  bump: number;
}

export interface VoteRecordData {
  proposal: Address;
  nullifier: number[];
  voteCommitment: number[];
  timestamp: bigint;
  isRevealed: boolean;
  revealedChoice: number | null;
  bump: number;
}

// Helper to encode u64 as little-endian bytes
function u64ToLeBytes(value: bigint): Uint8Array {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, value, true); // little-endian
  return new Uint8Array(buffer);
}

// Derive proposal PDA
export async function getProposalAddress(proposalId: bigint): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PSEPHOS_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(new TextEncoder().encode("proposal")),
      getBytesEncoder().encode(u64ToLeBytes(proposalId)),
    ],
  });
  return pda;
}

// Derive results PDA
export async function getResultsAddress(proposalId: bigint): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PSEPHOS_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(new TextEncoder().encode("results")),
      getBytesEncoder().encode(u64ToLeBytes(proposalId)),
    ],
  });
  return pda;
}

// Derive vote record PDA
export async function getVoteRecordAddress(
  proposalAddress: Address,
  nullifier: number[]
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PSEPHOS_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(new TextEncoder().encode("vote")),
      getAddressEncoder().encode(proposalAddress),
      getBytesEncoder().encode(new Uint8Array(nullifier)),
    ],
  });
  return pda;
}

// Derive associated token account address
export async function getAssociatedTokenAddress(
  mint: Address,
  owner: Address
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [
      getAddressEncoder().encode(owner),
      getAddressEncoder().encode(TOKEN_PROGRAM_ID),
      getAddressEncoder().encode(mint),
    ],
  });
  return pda;
}

// Create proposal instruction
export async function createProposalInstruction({
  creator,
  proposalId,
  title,
  options,
  minThreshold,
  votingPeriodSeconds,
  tokenMint,
}: {
  creator: Address;
  proposalId: bigint;
  title: string;
  options: string[];
  minThreshold: bigint;
  votingPeriodSeconds: bigint;
  tokenMint?: Address;
}): Promise<Instruction> {
  const proposalAddress = await getProposalAddress(proposalId);
  const resultsAddress = await getResultsAddress(proposalId);

  // Use SOL mint (system program) as default token
  const mint = tokenMint ?? SYSTEM_PROGRAM_ADDRESS;

  const data = getCreateProposalInstructionDataEncoder().encode({
    proposalId,
    title,
    options,
    tokenMint: mint,
    minThreshold,
    votingPeriodSeconds,
  });

  return {
    programAddress: PSEPHOS_PROGRAM_ADDRESS,
    accounts: [
      { address: creator, role: 3 }, // WritableSigner
      { address: proposalAddress, role: 1 }, // Writable
      { address: resultsAddress, role: 1 }, // Writable
      { address: SYSTEM_PROGRAM_ADDRESS, role: 0 }, // Readonly
    ],
    data,
  };
}

// Cast vote instruction
// Now accepts Gnark proof format with public witness for on-chain validation
export async function castVoteInstruction({
  voter,
  proposalId,
  tokenMint,
  nullifier,
  voteCommitment,
  proof,
  publicWitness,
}: {
  voter: Address;
  proposalId: bigint;
  tokenMint: Address;
  nullifier: number[];
  voteCommitment: number[];
  proof: number[];
  publicWitness: number[];
}): Promise<Instruction> {
  const proposalAddress = await getProposalAddress(proposalId);
  const voteRecordAddress = await getVoteRecordAddress(proposalAddress, nullifier);
  const voterTokenAccount = await getAssociatedTokenAddress(tokenMint, voter);

  const data = getCastVoteInstructionDataEncoder().encode({
    nullifier: new Uint8Array(nullifier),
    voteCommitment: new Uint8Array(voteCommitment),
    proof: new Uint8Array(proof),
    publicWitness: new Uint8Array(publicWitness),
  });

  return {
    programAddress: PSEPHOS_PROGRAM_ADDRESS,
    accounts: [
      { address: voter, role: 3 }, // WritableSigner
      { address: proposalAddress, role: 1 }, // Writable
      { address: voteRecordAddress, role: 1 }, // Writable
      { address: voterTokenAccount, role: 0 }, // Readonly - voter's token account
      { address: ZK_VERIFIER_PROGRAM_ID, role: 0 }, // Readonly - ZK Verifier program
      { address: TOKEN_PROGRAM_ID, role: 0 }, // Readonly - SPL Token program
      { address: SYSTEM_PROGRAM_ADDRESS, role: 0 }, // Readonly
    ],
    data,
  };
}

// Reveal vote instruction - called after voting ends to reveal and tally vote
export async function revealVoteInstruction({
  revealer,
  proposalId,
  nullifier,
  voteChoice,
  voterSecret,
}: {
  revealer: Address;
  proposalId: bigint;
  nullifier: number[];
  voteChoice: number;
  voterSecret: Uint8Array; // 32 bytes
}): Promise<Instruction> {
  const proposalAddress = await getProposalAddress(proposalId);
  const voteRecordAddress = await getVoteRecordAddress(proposalAddress, nullifier);
  const resultsAddress = await getResultsAddress(proposalId);

  const data = getRevealVoteInstructionDataEncoder().encode({
    voteChoice,
    voterSecret,
  });

  return {
    programAddress: PSEPHOS_PROGRAM_ADDRESS,
    accounts: [
      { address: revealer, role: 3 }, // WritableSigner
      { address: proposalAddress, role: 0 }, // Readonly
      { address: voteRecordAddress, role: 1 }, // Writable
      { address: resultsAddress, role: 1 }, // Writable
    ],
    data,
  };
}

// Finalize proposal instruction - called by proposal creator after voting ends
export async function finalizeProposalInstruction({
  authority,
  proposalId,
}: {
  authority: Address;
  proposalId: bigint;
}): Promise<Instruction> {
  const proposalAddress = await getProposalAddress(proposalId);
  const resultsAddress = await getResultsAddress(proposalId);

  const data = getFinalizeProposalInstructionDataEncoder().encode({});

  return {
    programAddress: PSEPHOS_PROGRAM_ADDRESS,
    accounts: [
      { address: proposalAddress, role: 1 }, // Writable
      { address: resultsAddress, role: 1 }, // Writable
      { address: authority, role: 2 }, // ReadonlySigner
    ],
    data,
  };
}

// Fetch proposals from the blockchain
export async function fetchProposals(): Promise<ProposalData[]> {
  try {
    // Use fetch directly to query the RPC
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getProgramAccounts",
        params: [
          PSEPHOS_PROGRAM_ADDRESS,
          {
            encoding: "base64",
            filters: [
              {
                memcmp: {
                  offset: 0,
                  bytes: btoa(String.fromCharCode(...[26, 94, 189, 187, 116, 136, 53, 33])),
                  encoding: "base64",
                },
              },
            ],
          },
        ],
      }),
    });

    const json = await response.json();
    if (json.error) {
      console.error("RPC error:", json.error);
      return [];
    }

    const proposals: ProposalData[] = [];
    const decoder = getProposalDecoder();

    for (const account of json.result || []) {
      try {
        // Decode base64 data
        const dataStr = account.account.data[0];
        const dataBytes = Uint8Array.from(atob(dataStr), c => c.charCodeAt(0));
        
        // Skip the 8-byte discriminator
        const proposalData = decoder.decode(dataBytes.slice(8));
        
        proposals.push({
          id: proposalData.id,
          creator: proposalData.creator,
          title: proposalData.title,
          options: proposalData.options,
          tokenMint: proposalData.tokenMint,
          minThreshold: proposalData.minThreshold,
          startTime: proposalData.startTime,
          endTime: proposalData.endTime,
          voteCount: proposalData.voteCount,
          isFinalized: proposalData.isFinalized,
          bump: proposalData.bump,
          address: account.pubkey as Address,
        });
      } catch (err) {
        console.error("Failed to decode proposal:", err);
      }
    }

    // Sort by start time descending (newest first)
    proposals.sort((a, b) => Number(b.startTime - a.startTime));
    
    return proposals;
  } catch (err) {
    console.error("Failed to fetch proposals:", err);
    return [];
  }
}

// Fetch a single proposal by ID
export async function fetchProposal(proposalId: bigint): Promise<ProposalData | null> {
  try {
    const proposalAddress = await getProposalAddress(proposalId);
    
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [proposalAddress, { encoding: "base64" }],
      }),
    });

    const json = await response.json();
    if (!json.result?.value) {
      return null;
    }

    const dataStr = json.result.value.data[0];
    const dataBytes = Uint8Array.from(atob(dataStr), c => c.charCodeAt(0));
    
    const decoder = getProposalDecoder();
    const proposalData = decoder.decode(dataBytes.slice(8));

    return {
      id: proposalData.id,
      creator: proposalData.creator,
      title: proposalData.title,
      options: proposalData.options,
      tokenMint: proposalData.tokenMint,
      minThreshold: proposalData.minThreshold,
      startTime: proposalData.startTime,
      endTime: proposalData.endTime,
      voteCount: proposalData.voteCount,
      isFinalized: proposalData.isFinalized,
      bump: proposalData.bump,
      address: proposalAddress,
    };
  } catch (err) {
    console.error("Failed to fetch proposal:", err);
    return null;
  }
}

// Fetch results for a proposal
export async function fetchProposalResults(proposalId: bigint): Promise<ProposalResultsData | null> {
  try {
    const resultsAddress = await getResultsAddress(proposalId);
    
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [resultsAddress, { encoding: "base64" }],
      }),
    });

    const json = await response.json();
    if (!json.result?.value) {
      return null;
    }

    const dataStr = json.result.value.data[0];
    const dataBytes = Uint8Array.from(atob(dataStr), c => c.charCodeAt(0));
    
    const decoder = getProposalResultsDecoder();
    const resultsData = decoder.decode(dataBytes.slice(8));

    return {
      proposal: resultsData.proposal,
      tallies: resultsData.tallies,
      isFinalized: resultsData.isFinalized,
      bump: resultsData.bump,
    };
  } catch (err) {
    console.error("Failed to fetch results:", err);
    return null;
  }
}
