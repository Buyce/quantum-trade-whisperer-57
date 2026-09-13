import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { getAssistantThread } from "@/lib/assistant/threads.functions";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";

export const Route = createFileRoute("/_authenticated/assistant/$threadId")({
  component: AssistantThreadPage,
});

function rowToUIMessage(row: {
  message_id: string;
  role: string;
  parts: unknown;
}): UIMessage {
  return {
    id: row.message_id,
    role: row.role as UIMessage["role"],
    parts: (row.parts ?? []) as UIMessage["parts"],
  };
}

function AssistantThreadPage() {
  const { threadId } = Route.useParams();
  const [history, setHistory] = useState<UIMessage[] | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    void (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!cancelled) setAccessToken(session.session?.access_token ?? null);
      try {
        const loaded = await getAssistantThread({ data: { id: threadId } });
        if (cancelled) return;
        if (!loaded) {
          setError("Conversation not found.");
          setHistory([]);
          return;
        }
        setHistory(loaded.messages.map(rowToUIMessage));
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load the conversation.",
          );
          setHistory([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  if (error) {
    return <div className="p-6 text-sm text-muted-foreground">{error}</div>;
  }
  if (history === null || accessToken === null) {
    return <div className="p-6"><Shimmer>Loading conversation…</Shimmer></div>;
  }
  return (
    <AssistantChat key={threadId} threadId={threadId} initialMessages={history} token={accessToken} />
  );
}

function AssistantChat({
  threadId,
  initialMessages,
  token,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  token: string;
}) {
  const { messages, sendMessage, status, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      headers: { Authorization: `Bearer ${token}` },
      body: { threadId },
    }),
    onError: (chatError) => console.error("[assistant]", chatError),
  });

  const isLoading = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              title="P-Trades Assistant"
              description="Ask about your setups, automatic orders, risk holds, settings or performance — or what's moving the markets right now."
            />
          )}
          {messages.map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent>
                {message.parts.map((part, index) => {
                  if (part.type === "text") {
                    return <MessageResponse key={index}>{part.text}</MessageResponse>;
                  }
                  if (part.type === "source-url") {
                    return (
                      <a
                        key={index}
                        href={part.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-xs text-primary underline"
                      >
                        {part.title ?? part.url}
                      </a>
                    );
                  }
                  if (part.type.startsWith("tool-") && part.type !== "tool-google_search") {
                    const state = "state" in part ? String(part.state) : "";
                    const name = part.type.replace("tool-", "").replaceAll("_", " ");
                    return (
                      <p key={index} className="text-xs text-muted-foreground italic">
                        {state === "output-available" ? "Checked" : "Checking"} {name}…
                      </p>
                    );
                  }
                  return null;
                })}
              </MessageContent>
            </Message>
          ))}
          {status === "submitted" && <Shimmer>Thinking…</Shimmer>}
          {error && (
            <p className="text-sm text-destructive">
              The assistant could not answer. Please try again.
            </p>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="border-t border-border p-3">
        <PromptInput
          onSubmit={async ({ text }) => {
            if (!text.trim() || isLoading) return;
            await sendMessage({ text: text.trim() });
          }}
        >
          <PromptInputTextarea placeholder="Ask about your trading, or the markets…" />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={status} disabled={isLoading} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
