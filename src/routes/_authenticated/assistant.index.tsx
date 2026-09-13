import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createAssistantThread,
  deleteAssistantThread,
  listAssistantThreads,
} from "@/lib/assistant/threads.functions";

export const Route = createFileRoute("/_authenticated/assistant/")({
  component: AssistantHome,
});

function AssistantHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const { data: threads = [] } = useQuery({
    queryKey: ["assistant-threads"],
    queryFn: () => listAssistantThreads(),
  });

  const startThread = async () => {
    setCreating(true);
    try {
      const { id } = await createAssistantThread();
      await queryClient.invalidateQueries({ queryKey: ["assistant-threads"] });
      navigate({ to: "/assistant/$threadId", params: { threadId: id } });
    } finally {
      setCreating(false);
    }
  };

  // Jump straight into a fresh conversation when there's nothing to pick from.
  useEffect(() => {
    if (threads.length === 0 && !creating) void startThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads.length]);

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">P-Trades Assistant</h1>
        <Button onClick={startThread} disabled={creating}>
          <MessageSquarePlus className="mr-2 h-4 w-4" /> New conversation
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Ask about your setups, orders, risk holds, settings and performance — or what's
        happening in the markets right now.
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {threads.map((thread) => (
          <li key={thread.id} className="flex items-center justify-between gap-2 p-3">
            <button
              type="button"
              className="flex-1 text-left text-sm hover:underline truncate"
              onClick={() =>
                navigate({ to: "/assistant/$threadId", params: { threadId: thread.id } })
              }
            >
              {thread.title}
            </button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete conversation"
              onClick={async () => {
                await deleteAssistantThread({ data: { id: thread.id } });
                await queryClient.invalidateQueries({ queryKey: ["assistant-threads"] });
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
        {threads.length === 0 && (
          <li className="p-3 text-sm text-muted-foreground">Starting your first conversation…</li>
        )}
      </ul>
    </div>
  );
}
