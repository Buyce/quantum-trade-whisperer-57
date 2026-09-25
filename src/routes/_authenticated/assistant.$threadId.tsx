import { createFileRoute } from "@tanstack/react-router";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { ExplainSetupSheet } from "@/components/explain/ExplainSetupSheet";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/assistant/$threadId")({
  component: AssistantThreadPage,
});

function AssistantThreadPage() {
  const { threadId } = Route.useParams();
  return (
    <>
      <div className="mb-2 flex justify-end">
        <ExplainSetupSheet
          signalId={null}
          trigger={
            <Button size="sm" variant="outline">
              Explain a setup
            </Button>
          }
        />
      </div>
      <AssistantPanel threadId={threadId} />
    </>
  );
}
