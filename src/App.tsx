import { useState } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { ProposalList } from "./components/ProposalList";
import { CreateProposal } from "./components/CreateProposal";
import { VoteForm } from "./components/VoteForm";
import { ResultsView } from "./components/ResultsView";
import { RevealVote } from "./components/RevealVote";
import { type ProposalData } from "./lib/psephos";

type View = "proposals" | "create" | "vote";

export default function App() {
  const { connectors, connect, disconnect, wallet, status } =
    useWalletConnection();

  const [currentView, setCurrentView] = useState<View>("proposals");
  const [selectedProposal, setSelectedProposal] = useState<ProposalData | null>(null);

  const address = wallet?.account.address.toString();

  function handleSelectProposal(proposal: ProposalData) {
    setSelectedProposal(proposal);
    setCurrentView("vote");
  }

  function handleProposalCreated() {
    setCurrentView("proposals");
  }

  function handleVoteSuccess() {
    // Refresh the view
    setSelectedProposal(null);
    setCurrentView("proposals");
  }

  function handleRevealSuccess() {
    // Refresh the proposal list after revealing
    setSelectedProposal(null);
    setCurrentView("proposals");
  }

  function handleFinalized() {
    // Refresh after finalizing
    setSelectedProposal(null);
    setCurrentView("proposals");
  }

  // Helper to check if voting has ended
  const isVotingEnded = selectedProposal ? Date.now() / 1000 > Number(selectedProposal.endTime) : false;

  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg1 text-foreground">
      {/* Greek-inspired decorative header */}
      <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600" />
      
      <main className="relative z-10 mx-auto flex min-h-screen max-w-4xl flex-col gap-8 border-x border-border-low px-6 py-16">
        {/* Header */}
        <header className="space-y-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-100 to-amber-200">
            <span className="text-3xl">🏛️</span>
          </div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight">
              <span className="bg-gradient-to-r from-amber-600 to-amber-800 bg-clip-text text-transparent">
                Psephos
              </span>
            </h1>
            <p className="mt-1 text-sm uppercase tracking-[0.2em] text-muted">
              Private Voting on Solana
            </p>
          </div>
          <p className="mx-auto max-w-xl text-base leading-relaxed text-muted">
            Cast your vote without revealing your identity. Powered by Zero-Knowledge proofs,
            inspired by the ancient Greek tradition of secret pebble voting.
          </p>
        </header>

        {/* Wallet Connection */}
        <section className="rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-lg font-semibold">Wallet</p>
              <p className="text-sm text-muted">
                Connect to participate in private voting
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
              status === "connected" 
                ? "bg-green-100 text-green-700" 
                : "bg-cream text-foreground/80"
            }`}>
              {status === "connected" ? "Connected" : "Not connected"}
            </span>
          </div>

          {status !== "connected" && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {connectors.map((connector) => (
                <button
                  key={connector.id}
                  onClick={() => connect(connector.id)}
                  disabled={status === "connecting"}
                  className="group flex items-center justify-between rounded-xl border border-border-low bg-card px-4 py-3 text-left text-sm font-medium transition hover:-translate-y-0.5 hover:shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex flex-col">
                    <span className="text-base">{connector.name}</span>
                    <span className="text-xs text-muted">
                      {status === "connecting" ? "Connecting…" : "Tap to connect"}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 rounded-full bg-border-low transition group-hover:bg-amber-500"
                  />
                </button>
              ))}
            </div>
          )}

          {status === "connected" && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-low pt-4 text-sm">
              <span className="rounded-lg border border-border-low bg-cream px-3 py-2 font-mono text-xs">
                {address?.slice(0, 8)}...{address?.slice(-8)}
              </span>
              <button
                onClick={() => disconnect()}
                className="inline-flex items-center gap-2 rounded-lg border border-border-low bg-card px-3 py-2 font-medium transition hover:-translate-y-0.5 hover:shadow-sm cursor-pointer"
              >
                Disconnect
              </button>
            </div>
          )}
        </section>

        {/* Navigation Tabs */}
        {status === "connected" && (
          <div className="flex gap-2">
            <button
              onClick={() => { setCurrentView("proposals"); setSelectedProposal(null); }}
              className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition ${
                currentView === "proposals"
                  ? "border-foreground bg-foreground text-background"
                  : "border-border-low bg-card hover:bg-cream/50"
              }`}
            >
              Proposals
            </button>
            <button
              onClick={() => setCurrentView("create")}
              className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition ${
                currentView === "create"
                  ? "border-foreground bg-foreground text-background"
                  : "border-border-low bg-card hover:bg-cream/50"
              }`}
            >
              Create Proposal
            </button>
          </div>
        )}

        {/* Main Content */}
        {status === "connected" && (
          <section className="rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
            {currentView === "proposals" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Active Proposals</h2>
                </div>
                <ProposalList 
                  onSelectProposal={handleSelectProposal}
                  selectedProposalId={undefined}
                />
              </div>
            )}

            {currentView === "vote" && selectedProposal && (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <button
                      onClick={() => { setSelectedProposal(null); setCurrentView("proposals"); }}
                      className="mb-2 text-sm text-muted hover:text-foreground"
                    >
                      ← Back to proposals
                    </button>
                    <h2 className="text-xl font-semibold">{selectedProposal.title}</h2>
                    <p className="mt-1 text-sm text-muted">
                      {selectedProposal.voteCount.toString()} votes cast
                    </p>
                  </div>
                </div>
                
                {/* Show voting form during active voting period */}
                {!isVotingEnded && (
                  <VoteForm proposal={selectedProposal} onSuccess={handleVoteSuccess} />
                )}
                
                {/* Show reveal option after voting ends */}
                {isVotingEnded && !selectedProposal.isFinalized && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <h3 className="font-medium text-amber-800">Voting has ended</h3>
                    <p className="mt-1 text-sm text-amber-700">
                      You can now reveal your vote to add it to the final tally.
                    </p>
                    <div className="mt-4">
                      <RevealVote proposal={selectedProposal} onSuccess={handleRevealSuccess} />
                    </div>
                  </div>
                )}
                
                <div className="border-t border-border-low pt-6">
                  <ResultsView proposal={selectedProposal} onFinalized={handleFinalized} />
                </div>
              </div>
            )}

            {currentView === "create" && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Create New Proposal</h2>
                <CreateProposal onSuccess={handleProposalCreated} />
              </div>
            )}
          </section>
        )}

        {/* Footer */}
        <footer className="mt-auto border-t border-border-low pt-6 text-center text-xs text-muted">
          <p>
            <strong>Psephos</strong> (Ψῆφος) - Greek for "pebble" or "vote"
          </p>
          <p className="mt-1">
            Built for Solana Privacy Hackathon 2026 with Noir ZK Proofs
          </p>
          <div className="mt-4 flex justify-center gap-4">
            <a
              href="https://noir-lang.org/docs"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Noir Docs
            </a>
            <a
              href="https://solana.com/docs"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Solana Docs
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
