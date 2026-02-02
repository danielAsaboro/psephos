import { useState, useEffect } from "react";
import { useWalletConnection, useSendTransaction } from "@solana/react-hooks";
import { revealVoteInstruction, type ProposalData } from "../lib/psephos";
import { phraseToVoterSecret } from "../lib/noir-api";

interface RevealVoteProps {
  proposal: ProposalData;
  onSuccess: () => void;
}

interface StoredVoteData {
  choice: number;
  secret: string;
  nullifier: number[];
  commitment: number[];
}

export function RevealVote({ proposal, onSuccess }: RevealVoteProps) {
  const { wallet, status } = useWalletConnection();
  const { send, isSending } = useSendTransaction();

  const [storedVote, setStoredVote] = useState<StoredVoteData | null>(null);
  const [manualSecret, setManualSecret] = useState("");
  const [manualChoice, setManualChoice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [useManual, setUseManual] = useState(false);

  // Load stored vote from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`vote-${proposal.id}`);
    if (stored) {
      try {
        setStoredVote(JSON.parse(stored));
      } catch {
        console.error("Failed to parse stored vote");
      }
    }
  }, [proposal.id]);

  const now = Date.now() / 1000;
  const hasEnded = now > Number(proposal.endTime);
  const canReveal = hasEnded && !proposal.isFinalized;

  async function handleReveal() {
    setError(null);

    if (!wallet) {
      setError("Wallet not connected");
      return;
    }

    if (!canReveal) {
      setError("Cannot reveal: voting hasn't ended or proposal is finalized");
      return;
    }

    let voteChoice: number;
    let voterSecretPhrase: string;
    let nullifier: number[];

    if (useManual) {
      if (manualChoice === null) {
        setError("Please select your vote choice");
        return;
      }
      if (!manualSecret.trim()) {
        setError("Please enter your secret phrase");
        return;
      }
      voteChoice = manualChoice;
      voterSecretPhrase = manualSecret;
      // For manual mode, we need the nullifier from somewhere
      // This is a limitation - we can't reveal without knowing the nullifier
      setError("Manual reveal requires the nullifier from your original vote. Please check your vote confirmation.");
      return;
    } else {
      if (!storedVote) {
        setError("No stored vote found. Use manual entry.");
        setUseManual(true);
        return;
      }
      voteChoice = storedVote.choice;
      voterSecretPhrase = storedVote.secret;
      nullifier = storedVote.nullifier;
    }

    try {
      setTxStatus("Preparing reveal transaction...");

      // Convert secret phrase to 32-byte array
      const voterSecretBigint = await phraseToVoterSecret(voterSecretPhrase);
      const voterSecretBytes = bigintToBytes32(voterSecretBigint);

      const instruction = await revealVoteInstruction({
        revealer: wallet.account.address,
        proposalId: proposal.id,
        nullifier,
        voteChoice,
        voterSecret: voterSecretBytes,
      });

      setTxStatus("Awaiting signature...");

      const signature = await send({
        instructions: [instruction],
      });

      setTxStatus(`Vote revealed! Signature: ${signature?.slice(0, 20)}...`);
      
      // Clear stored vote after successful reveal
      localStorage.removeItem(`vote-${proposal.id}`);
      
      setTimeout(() => {
        onSuccess();
      }, 2000);
    } catch (err) {
      console.error("Failed to reveal vote:", err);
      setError(err instanceof Error ? err.message : "Failed to reveal vote");
      setTxStatus(null);
    }
  }

  if (status !== "connected") {
    return (
      <div className="rounded-lg bg-cream/50 p-4 text-center text-sm text-muted">
        Connect your wallet to reveal your vote
      </div>
    );
  }

  if (!canReveal) {
    if (!hasEnded) {
      return (
        <div className="rounded-lg bg-cream/50 p-4 text-center">
          <p className="text-muted">Votes can be revealed after voting ends</p>
          <p className="mt-2 text-sm text-muted">
            Ends: {new Date(Number(proposal.endTime) * 1000).toLocaleString()}
          </p>
        </div>
      );
    }
    if (proposal.isFinalized) {
      return (
        <div className="rounded-lg bg-green-50 p-4 text-center">
          <p className="text-green-700">Proposal has been finalized</p>
        </div>
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Reveal Your Vote</h3>
        {storedVote && (
          <button
            onClick={() => setUseManual(!useManual)}
            className="text-xs text-muted hover:text-foreground"
          >
            {useManual ? "Use saved vote" : "Enter manually"}
          </button>
        )}
      </div>

      {!useManual && storedVote ? (
        <div className="rounded-lg border border-border-low bg-cream/30 p-4">
          <p className="text-sm">
            <span className="text-muted">Your vote:</span>{" "}
            <span className="font-medium">{proposal.options[storedVote.choice]}</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            Saved from your voting session. Click reveal to count your vote.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Your Vote Choice</label>
            <div className="space-y-2">
              {proposal.options.map((option, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setManualChoice(index)}
                  className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                    manualChoice === index
                      ? "border-foreground bg-cream/50"
                      : "border-border-low bg-card hover:bg-cream/30"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Secret Phrase</label>
            <input
              type="password"
              value={manualSecret}
              onChange={(e) => setManualSecret(e.target.value)}
              placeholder="Enter your secret phrase from voting"
              className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30"
            />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {txStatus && (
        <div className="rounded-lg border border-border-low bg-cream/50 px-4 py-3 text-sm">
          {txStatus}
        </div>
      )}

      <button
        onClick={handleReveal}
        disabled={isSending || (!storedVote && !useManual)}
        className="w-full rounded-lg bg-foreground px-4 py-3 font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSending ? "Revealing..." : "Reveal Vote"}
      </button>

      <p className="text-center text-xs text-muted">
        Revealing your vote adds it to the final tally. Only you can reveal your vote.
      </p>
    </div>
  );
}

/**
 * Convert a bigint to a 32-byte Uint8Array (big-endian)
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
