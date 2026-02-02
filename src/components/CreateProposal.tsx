import { useState } from "react";
import { useWalletConnection, useSendTransaction } from "@solana/react-hooks";
import { createProposalInstruction } from "../lib/psephos";

interface CreateProposalProps {
  onSuccess: () => void;
}

export function CreateProposal({ onSuccess }: CreateProposalProps) {
  const { wallet, status } = useWalletConnection();
  const { send, isSending } = useSendTransaction();

  const [title, setTitle] = useState("");
  const [options, setOptions] = useState(["Yes", "No"]);
  const [minThreshold, setMinThreshold] = useState("1");
  const [votingPeriodHours, setVotingPeriodHours] = useState("24");
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  function addOption() {
    if (options.length < 10) {
      setOptions([...options, ""]);
    }
  }

  function removeOption(index: number) {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index));
    }
  }

  function updateOption(index: number, value: string) {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!wallet) {
      setError("Wallet not connected");
      return;
    }

    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    const validOptions = options.filter((o) => o.trim());
    if (validOptions.length < 2) {
      setError("At least 2 options are required");
      return;
    }

    try {
      setTxStatus("Building transaction...");

      const walletAddress = wallet.account.address;
      const proposalId = BigInt(Date.now()); // Use timestamp as unique ID
      const votingPeriodSeconds = BigInt(parseFloat(votingPeriodHours) * 3600);

      const instruction = await createProposalInstruction({
        creator: walletAddress,
        proposalId,
        title: title.trim(),
        options: validOptions,
        minThreshold: BigInt(minThreshold),
        votingPeriodSeconds,
      });

      setTxStatus("Awaiting signature...");

      const signature = await send({
        instructions: [instruction],
      });

      setTxStatus(`Proposal created! Signature: ${signature?.slice(0, 20)}...`);
      
      // Reset form
      setTitle("");
      setOptions(["Yes", "No"]);
      setMinThreshold("1");
      setVotingPeriodHours("24");
      
      onSuccess();
    } catch (err) {
      console.error("Failed to create proposal:", err);
      setError(err instanceof Error ? err.message : "Failed to create proposal");
      setTxStatus(null);
    }
  }

  if (status !== "connected") {
    return (
      <div className="rounded-lg bg-cream/50 p-4 text-center text-sm text-muted">
        Connect your wallet to create proposals
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What should we decide?"
          maxLength={100}
          className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Options</label>
        <div className="space-y-2">
          {options.map((option, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={option}
                onChange={(e) => updateOption(index, e.target.value)}
                placeholder={`Option ${index + 1}`}
                maxLength={50}
                className="flex-1 rounded-lg border border-border-low bg-card px-4 py-2 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30"
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOption(index)}
                  className="rounded-lg border border-border-low bg-card px-3 py-2 text-sm text-muted transition hover:bg-red-50 hover:text-red-500"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        {options.length < 10 && (
          <button
            type="button"
            onClick={addOption}
            className="mt-2 text-sm text-muted underline underline-offset-2 hover:text-foreground"
          >
            + Add option
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Min Token Threshold</label>
          <input
            type="number"
            min="0"
            value={minThreshold}
            onChange={(e) => setMinThreshold(e.target.value)}
            className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition focus:border-foreground/30"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Voting Period (hours)</label>
          <input
            type="number"
            min="1"
            value={votingPeriodHours}
            onChange={(e) => setVotingPeriodHours(e.target.value)}
            className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition focus:border-foreground/30"
          />
        </div>
      </div>

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
        type="submit"
        disabled={isSending}
        className="w-full rounded-lg bg-foreground px-4 py-3 font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSending ? "Creating..." : "Create Proposal"}
      </button>
    </form>
  );
}
