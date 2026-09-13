/**
 * The single conversation surface for the assistant.
 *
 * [INVARIANT] The full Assistant page and the floating widget both render this
 * component, so streaming, tool calls and the settings-approval prompt behave
 * identically wherever the user asks from — there is no second chat client.
 */
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

function rowToUIMessage(row: { message_id: string; role: string; parts: unknown }): UIMessage {
  return {
    id: row.message_id,
    role: row.role as UIMessage["role"],
    parts: (row.parts ?? []) as UIMessage["parts"],
  };
}

/** Loads the thread's saved messages and the caller's token, then renders the chat. */
export function AssistantPanel({
  threadId,
  className = "h-[calc(100vh-4rem)]",
}: {
  threadId: string;
  className?: string;
}) {
  const [history, setHistory] = useState<UIMessage[] | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setError(null);
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
    return (
      <div className="p-6">
        <Shimmer>Loading conversation…</Shimmer>
      </div>
    );
  }
  return (
    <AssistantChat
      key={threadId}
      threadId={threadId}
      initialMessages={history}
      token={accessToken}
      className={className}
    />
  );
}

function AssistantChat({
  threadId,
  initialMessages,
  token,
  className,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  token: string;
  className: string;
}) {
  const { messages, sendMessage, status, error, addToolApprovalResponse } = useChat({
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
    <div className={`flex min-h-0 flex-col ${className}`}>
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              title="P-Trades Assistant"
              description="Ask about your setups, automatic orders, risk holds, settings or performance — how the grading and brakes work, how you compare to the platform, or what's moving the markets right now."
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
                    if (
                      part.type === "tool-update_my_settings" &&
                      state === "approval-requested" &&
                      "approval" in part
                    ) {
                      const approvalId = (part as { approval: { id: string } }).approval.id;
                      return (
                        <div
                          key={index}
                          className="rounded-md border border-border bg-muted/40 p-3 space-y-2"
                        >
                          <p className="text-sm font-medium">
                            The assistant wants to change your settings:
                          </p>
                          <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify((part as { input?: unknown }).input ?? {}, null, 2)}
                          </pre>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground"
                              onClick={() =>
                                void addToolApprovalResponse({ id: approvalId, approved: true })
                              }
                            >
                              Approve change
                            </button>
                            <button
                              type="button"
                              className="rounded border border-border px-3 py-1 text-xs"
                              onClick={() =>
                                void addToolApprovalResponse({
                                  id: approvalId,
                                  approved: false,
                                  reason: "The user declined the settings change.",
                                })
                              }
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      );
                    }
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
