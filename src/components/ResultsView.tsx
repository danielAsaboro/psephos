import { useState } from "react";
import { useWalletConnection, useSendTransaction } from "@solana/react-hooks";
import { type ProposalData, type ProposalResultsData, finalizeProposalInstruction } from "../lib/psephos";

interface ResultsViewProps {
  proposal: ProposalData;
  results?: ProposalResultsData;
  onFinalized?: () => void;
}

export function ResultsView({ proposal, results, onFinalized }: ResultsViewProps) {
  const { wallet } = useWalletConnection();
  const { send, isSending } = useSendTransaction();
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  const totalVotes = results?.tallies.reduce((sum, t) => sum + Number(t), 0) ?? 0;
  const now = Date.now() / 1000;
  const hasEnded = now > Number(proposal.endTime);
  const isCreator = wallet?.account.address === proposal.creator;
  const canFinalize = hasEnded && !proposal.isFinalized && isCreator;

  async function handleFinalize() {
    if (!wallet || !canFinalize) return;

    setError(null);
    setTxStatus("Preparing finalize transaction...");

    try {
      const instruction = await finalizeProposalInstruction({
        authority: wallet.account.address,
        proposalId: proposal.id,
      });

      setTxStatus("Awaiting signature...");

      const signature = await send({
        instructions: [instruction],
      });

      setTxStatus(`Finalized! Signature: ${signature?.slice(0, 20)}...`);
      
      if (onFinalized) {
        setTimeout(onFinalized, 2000);
      }
    } catch (err) {
      console.error("Failed to finalize:", err);
      setError(err instanceof Error ? err.message : "Failed to finalize");
      setTxStatus(null);
    }
  }

  if (!hasEnded && !proposal.isFinalized) {
    return (
      <div className="rounded-lg bg-cream/50 p-6 text-center">
        <p className="text-muted">Results will be available after voting ends</p>
        <p className="mt-2 text-sm text-muted">
          Ends: {new Date(Number(proposal.endTime) * 1000).toLocaleString()}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Results</h3>
        <span className="text-sm text-muted">{totalVotes} total votes revealed</span>
      </div>

      <div className="space-y-3">
        {proposal.options.map((option, index) => {
          const votes = results ? Number(results.tallies[index] ?? 0) : 0;
          const percentage = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
          const isWinner = totalVotes > 0 && votes === Math.max(...(results?.tallies.map(Number) ?? [0]));

          return (
            <div key={index} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className={isWinner ? "font-medium" : ""}>{option}</span>
                <span className="text-muted">
                  {votes} ({percentage.toFixed(1)}%)
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-cream">
                <div
                  className={`h-full transition-all duration-500 ${
                    isWinner ? "bg-foreground" : "bg-foreground/40"
                  }`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {proposal.isFinalized && (
        <div className="rounded-lg bg-green-50 px-4 py-2 text-center text-sm text-green-700">
          Results finalized
        </div>
      )}

      {hasEnded && !proposal.isFinalized && (
        <div className="space-y-3">
          <p className="text-center text-xs text-muted">
            Results are preliminary. Votes need to be revealed for final tally.
          </p>

          {canFinalize && (
            <div className="border-t border-border-low pt-3">
              {error && (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
                  {error}
                </div>
              )}
              {txStatus && (
                <div className="mb-3 rounded-lg border border-border-low bg-cream/50 px-4 py-2 text-sm">
                  {txStatus}
                </div>
              )}
              <button
                onClick={handleFinalize}
                disabled={isSending}
                className="w-full rounded-lg border border-foreground bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-40"
              >
                {isSending ? "Finalizing..." : "Finalize Results"}
              </button>
              <p className="mt-2 text-center text-xs text-muted">
                As the proposal creator, you can finalize the results.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
