import { useState, useEffect } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { fetchProposals, type ProposalData } from "../lib/psephos";

interface ProposalListProps {
  onSelectProposal: (proposal: ProposalData) => void;
  selectedProposalId?: bigint;
}

export function ProposalList({ onSelectProposal, selectedProposalId }: ProposalListProps) {
  const { status } = useWalletConnection();
  const [proposals, setProposals] = useState<ProposalData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "connected") {
      loadProposals();
    }
  }, [status]);

  async function loadProposals() {
    setLoading(true);
    try {
      const data = await fetchProposals();
      setProposals(data);
    } catch (err) {
      console.error("Failed to load proposals:", err);
    } finally {
      setLoading(false);
    }
  }

  function getStatusBadge(proposal: ProposalData) {
    const now = Date.now() / 1000;
    if (proposal.isFinalized) {
      return <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">Finalized</span>;
    }
    if (now < Number(proposal.startTime)) {
      return <span className="rounded-full bg-yellow-200 px-2 py-0.5 text-xs text-yellow-700">Pending</span>;
    }
    if (now > Number(proposal.endTime)) {
      return <span className="rounded-full bg-orange-200 px-2 py-0.5 text-xs text-orange-700">Ended</span>;
    }
    return <span className="rounded-full bg-green-200 px-2 py-0.5 text-xs text-green-700">Active</span>;
  }

  if (status !== "connected") {
    return (
      <div className="rounded-lg bg-cream/50 p-4 text-center text-sm text-muted">
        Connect your wallet to view proposals
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
      </div>
    );
  }

  if (proposals.length === 0) {
    return (
      <div className="rounded-lg bg-cream/50 p-6 text-center">
        <p className="text-muted">No proposals yet</p>
        <p className="mt-2 text-sm text-muted">Create the first proposal to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {proposals.map((proposal) => (
        <button
          key={proposal.id.toString()}
          onClick={() => onSelectProposal(proposal)}
          className={`w-full rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${
            selectedProposalId === proposal.id
              ? "border-foreground bg-cream/30"
              : "border-border-low bg-card"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-medium">{proposal.title}</h3>
              <p className="mt-1 text-sm text-muted">
                {proposal.options.length} options • {proposal.voteCount.toString()} votes
              </p>
            </div>
            {getStatusBadge(proposal)}
          </div>
        </button>
      ))}
      <button
        onClick={loadProposals}
        className="w-full rounded-lg border border-border-low bg-card px-4 py-2 text-sm text-muted transition hover:bg-cream/50"
      >
        Refresh
      </button>
    </div>
  );
}
