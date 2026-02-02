import { useState, useEffect } from "react";
import { useWalletConnection, useSendTransaction, useBalance } from "@solana/react-hooks";
import { castVoteInstruction, type ProposalData } from "../lib/psephos";
import {
  generateVoteProof,
  phraseToVoterSecret,
  checkProofServerHealth,
  setProvingBackend,
  getProvingBackend,
  ProvingBackend,
  getBackendInfo
} from "../lib/noir-api";
import { buildPublicWitness, isProofServerAvailable, generateGnarkProof } from "../lib/gnark";

interface VoteFormProps {
  proposal: ProposalData;
  onSuccess: () => void;
}

export function VoteForm({ proposal, onSuccess }: VoteFormProps) {
  const { wallet, status } = useWalletConnection();
  const { send, isSending } = useSendTransaction();
  const balance = useBalance(wallet?.account.address);

  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [voterSecret, setVoterSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [isGeneratingProof, setIsGeneratingProof] = useState(false);
  const [proofServerReady, setProofServerReady] = useState(false);
  const [proofServerAvailable, setProofServerAvailable] = useState(false);
  const [provingBackend, setProvingBackendState] = useState<ProvingBackend>(ProvingBackend.SERVER);
  const [backendInfo, setBackendInfo] = useState<{
    serverAvailable: boolean;
    browserAvailable: boolean;
    estimatedTime: { server: number; browser: number };
  } | null>(null);

  // Check proof server availability on mount
  useEffect(() => {
    checkProofServerHealth()
      .then((isHealthy) => setProofServerReady(isHealthy))
      .catch((err) => {
        console.error("Proof server not available:", err);
        setError("ZK proof server is not available");
      });

    // Check if Gnark proof server is available
    isProofServerAvailable().then(setProofServerAvailable);

    // Get backend availability info
    getBackendInfo().then(info => {
      setBackendInfo(info);
      console.log("Backend info:", info);
    });

    // Set initial backend
    setProvingBackendState(getProvingBackend());
  }, []);

  // Handler to switch proving backend
  const handleBackendChange = (backend: ProvingBackend) => {
    setProvingBackendState(backend);
    setProvingBackend(backend);
    console.log(`🔧 Switched to ${backend} proving backend`);
  };

  const now = Date.now() / 1000;
  const isActive = now >= Number(proposal.startTime) && now <= Number(proposal.endTime) && !proposal.isFinalized;
  const hasEnded = now > Number(proposal.endTime);

  // Get user's token balance (using SOL balance as proxy for now)
  const userBalance = balance?.lamports ? BigInt(balance.lamports) / BigInt(1e9) : BigInt(0);

  async function handleVote(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!wallet) {
      setError("Wallet not connected");
      return;
    }

    if (selectedOption === null) {
      setError("Please select an option");
      return;
    }

    if (!voterSecret.trim()) {
      setError("Please enter a secret phrase (this keeps your vote private)");
      return;
    }

    if (!proofServerReady) {
      setError("ZK proving system not ready. Please wait...");
      return;
    }

    // Check token balance before generating proof
    if (userBalance < proposal.minThreshold) {
      setError(`Insufficient token balance. You have ${userBalance.toString()} tokens but need ${proposal.minThreshold.toString()}`);
      return;
    }

    try {
      setIsGeneratingProof(true);
      setTxStatus("Converting secret phrase...");

      // Convert secret phrase to a voter secret (bigint)
      const voterSecretBigint = await phraseToVoterSecret(voterSecret);

      let proof: Uint8Array;
      let publicWitness: Uint8Array;
      let nullifier: Uint8Array;
      let voteCommitment: Uint8Array;

      // Generate proof with selected backend
      const backendLabel = provingBackend === ProvingBackend.BROWSER
        ? "Barretenberg (browser)"
        : provingBackend === ProvingBackend.SERVER
        ? "Sunspot (server)"
        : "Auto";

      const estimatedTime = provingBackend === ProvingBackend.BROWSER
        ? "30-60 seconds"
        : "10-30 seconds";

      setTxStatus(`Generating ZK proof with ${backendLabel} (this may take ${estimatedTime})...`);
      console.log(`🔐 Generating proof with backend: ${provingBackend}`);

      const noirProofResult = await generateVoteProof(
        {
          tokenBalance: userBalance,
          voterSecret: voterSecretBigint,
          voteChoice: selectedOption,
          minTokenThreshold: proposal.minThreshold,
          proposalId: proposal.id,
        },
        provingBackend // Pass the selected backend
      );

      nullifier = noirProofResult.publicInputs.nullifier;
      voteCommitment = noirProofResult.publicInputs.voteCommitment;

      // Try to generate Gnark proof if server is available
      if (proofServerAvailable) {
        setTxStatus("Upgrading to Gnark proof (faster on-chain verification)...");
        try {
          const gnarkResult = await generateGnarkProof(
            {
              tokenBalance: userBalance,
              voterSecret: voterSecretBigint,
              voteChoice: selectedOption,
              minTokenThreshold: proposal.minThreshold,
              proposalId: proposal.id,
            },
            nullifier,
            voteCommitment
          );
          proof = gnarkResult.proof;
          publicWitness = gnarkResult.publicWitness;
          console.log("Using Gnark proof:", proof.length, "bytes");
        } catch (gnarkErr) {
          console.warn("Gnark proof failed, falling back to Barretenberg:", gnarkErr);
          proof = noirProofResult.proof;
          // Build public witness manually for Barretenberg proof
          publicWitness = buildPublicWitness(
            proposal.minThreshold,
            proposal.id,
            voteCommitment,
            nullifier
          );
        }
      } else {
        // Use Barretenberg proof and build public witness
        proof = noirProofResult.proof;
        publicWitness = buildPublicWitness(
          proposal.minThreshold,
          proposal.id,
          voteCommitment,
          nullifier
        );
        console.log("Using Barretenberg proof:", proof.length, "bytes");
      }

      setTxStatus("Building transaction...");
      setIsGeneratingProof(false);

      const instruction = await castVoteInstruction({
        voter: wallet.account.address,
        proposalId: proposal.id,
        tokenMint: proposal.tokenMint,
        nullifier: Array.from(nullifier),
        voteCommitment: Array.from(voteCommitment),
        proof: Array.from(proof),
        publicWitness: Array.from(publicWitness),
      });

      setTxStatus("Awaiting signature...");

      const signature = await send({
        instructions: [instruction],
      });

      setTxStatus(`Vote cast! Signature: ${signature?.slice(0, 20)}...`);
      
      // Store vote info locally for later reveal
      localStorage.setItem(`vote-${proposal.id}`, JSON.stringify({
        choice: selectedOption,
        secret: voterSecret,
        nullifier: Array.from(nullifier),
        commitment: Array.from(voteCommitment),
      }));

      setSelectedOption(null);
      setVoterSecret("");
      onSuccess();
    } catch (err) {
      console.error("Failed to cast vote:", err);
      setError(err instanceof Error ? err.message : "Failed to cast vote");
      setTxStatus(null);
      setIsGeneratingProof(false);
    }
  }

  if (status !== "connected") {
    return (
      <div className="rounded-lg bg-cream/50 p-4 text-center text-sm text-muted">
        Connect your wallet to vote
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="rounded-lg bg-cream/50 p-6 text-center">
        <p className="font-medium text-muted">
          {hasEnded ? "Voting has ended" : "Voting hasn't started yet"}
        </p>
        {hasEnded && (
          <p className="mt-2 text-sm text-muted">
            Results: {proposal.options.map((opt) => `${opt}: 0`).join(", ")}
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleVote} className="space-y-4">
      {!proofServerReady && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-700">
          Initializing ZK proving system...
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-sm font-medium">Select your vote</label>
        {proposal.options.map((option, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setSelectedOption(index)}
            className={`w-full rounded-lg border p-4 text-left transition ${
              selectedOption === index
                ? "border-foreground bg-cream/50"
                : "border-border-low bg-card hover:bg-cream/30"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`h-4 w-4 rounded-full border-2 ${
                  selectedOption === index
                    ? "border-foreground bg-foreground"
                    : "border-border-low"
                }`}
              />
              <span className="font-medium">{option}</span>
            </div>
          </button>
        ))}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">
          Secret Phrase
          <span className="ml-1 font-normal text-muted">(keep this safe to reveal your vote later)</span>
        </label>
        <input
          type="password"
          value={voterSecret}
          onChange={(e) => setVoterSecret(e.target.value)}
          placeholder="Enter a memorable secret phrase"
          className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30"
        />
        <p className="mt-1 text-xs text-muted">
          This phrase generates your nullifier (prevents double voting) and vote commitment. Never share it.
        </p>
      </div>

      <div className="rounded-lg border border-border-low bg-cream/30 px-4 py-3">
        <p className="text-xs text-muted">
          <strong>Your eligibility:</strong> {userBalance.toString()} tokens (need {proposal.minThreshold.toString()})
        </p>
      </div>

      {/* Backend Selector - NEW! */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">
          🚀 Proving Backend
          <span className="ml-2 font-normal text-muted">(choose your privacy/speed trade-off)</span>
        </label>

        <div className="space-y-2">
          {/* Server Backend Option */}
          <button
            type="button"
            onClick={() => handleBackendChange(ProvingBackend.SERVER)}
            className={`w-full rounded-lg border p-3 text-left transition ${
              provingBackend === ProvingBackend.SERVER
                ? "border-foreground bg-cream/50"
                : "border-border-low bg-card hover:bg-cream/30"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 h-4 w-4 rounded-full border-2 flex-shrink-0 ${
                  provingBackend === ProvingBackend.SERVER
                    ? "border-foreground bg-foreground"
                    : "border-border-low"
                }`}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Server-Side (Sunspot)</span>
                  <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    Fast
                  </span>
                  {backendInfo?.serverAvailable && (
                    <span className="text-xs text-green-600">✓ Available</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted">
                  ~{backendInfo?.estimatedTime.server || 8}s proving time • Production default • Lighter on-chain cost
                </p>
              </div>
            </div>
          </button>

          {/* Browser Backend Option */}
          <button
            type="button"
            onClick={() => handleBackendChange(ProvingBackend.BROWSER)}
            className={`w-full rounded-lg border p-3 text-left transition ${
              provingBackend === ProvingBackend.BROWSER
                ? "border-foreground bg-cream/50"
                : "border-border-low bg-card hover:bg-cream/30"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 h-4 w-4 rounded-full border-2 flex-shrink-0 ${
                  provingBackend === ProvingBackend.BROWSER
                    ? "border-foreground bg-foreground"
                    : "border-border-low"
                }`}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Browser-Side (Barretenberg/bb.js)</span>
                  <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                    Private
                  </span>
                  {backendInfo?.browserAvailable && (
                    <span className="text-xs text-green-600">✓ Available</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted">
                  ~{backendInfo?.estimatedTime.browser || 45}s proving time • Fully client-side • Zero trust
                </p>
              </div>
            </div>
          </button>
        </div>

        {provingBackend === ProvingBackend.BROWSER && (
          <div className="rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-700">
            <strong>🌐 Browser proving enabled!</strong> Your proof will be generated entirely client-side using Barretenberg WASM.
            This may take 30-60 seconds but ensures maximum privacy - the server never sees your vote.
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {txStatus && (
        <div className="rounded-lg border border-border-low bg-cream/50 px-4 py-3 text-sm">
          {isGeneratingProof && (
            <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
          )}
          {txStatus}
        </div>
      )}

      <button
        type="submit"
        disabled={isSending || isGeneratingProof || selectedOption === null || !proofServerReady}
        className="w-full rounded-lg bg-foreground px-4 py-3 font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSending ? "Submitting..." : isGeneratingProof ? "Generating ZK Proof..." : "Cast Private Vote"}
      </button>

      <p className="text-center text-xs text-muted">
        Your vote is private. The ZK proof verifies your eligibility without revealing your identity.
      </p>
    </form>
  );
}
