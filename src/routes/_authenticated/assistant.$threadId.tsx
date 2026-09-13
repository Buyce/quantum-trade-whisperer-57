import { createFileRoute } from "@tanstack/react-router";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";

export const Route = createFileRoute("/_authenticated/assistant/$threadId")({
  component: AssistantThreadPage,
});

function AssistantThreadPage() {
  const { threadId } = Route.useParams();
  return <AssistantPanel threadId={threadId} />;
}
