import { createFileRoute, Link } from "@tanstack/react-router";
import { ProposalCard } from "@/components/assistant/ProposalCard";

export const Route = createFileRoute("/_authenticated/approvals/$id")({
  head: () => ({
    meta: [
      { title: "Approve an AI request — P-Trades Hub" },
      {
        name: "description",
        content: "Review and approve or decline a change your AI assistant proposed.",
      },
      { property: "og:title", content: "Approve an AI request — P-Trades Hub" },
      {
        property: "og:description",
        content: "Nothing changes until you approve it here.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ApprovalPage,
});

function ApprovalPage() {
  const { id } = Route.useParams();
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="text-xl font-semibold">Your AI assistant asked for approval</h1>
      <p className="text-sm text-muted-foreground">
        An assistant (in P-Trades, ChatGPT, Claude, Gemini or another AI app) proposed this. It only
        happens if you tap Approve.
      </p>
      <ProposalCard id={id} />
      <Link to="/accounts" className="text-sm text-primary underline">
        Back to accounts
      </Link>
    </div>
  );
}
