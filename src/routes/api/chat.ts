/**
 * In-app assistant streaming chat endpoint.
 *
 * Model routing:
 *  - GEMINI_API_KEY set  -> user's own Google Cloud key via @ai-sdk/google,
 *    with Google Search grounding enabled (this is the feature that gives the
 *    assistant live worldwide news/data lookups).
 *  - otherwise           -> Lovable AI gateway, google/gemini-3.5-flash via the
 *    openai-compatible chat path, WITHOUT grounding (the prompt then states it
 *    cannot check outside news).
 *
 * [INVARIANT] Persistence is RLS-scoped through the caller's own token; the
 * route writes only to assistant_threads/assistant_messages (the user's own
 * rows). It never touches broker data, settings, or any trading table — those
 * changes go through update_my_settings tool calls only.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  generateText,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/assistant/system-prompt";
import { buildAssistantTools } from "@/lib/assistant/tools";
import { requireAssistantUser } from "@/lib/assistant/auth.server";

type ChatBody = {
  threadId?: string;
  messages?: UIMessage[];
};

function plainText(message: UIMessage): string {
  return (message.parts ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let supabase: Awaited<ReturnType<typeof requireAssistantUser>>["supabase"];
        let userId: string;
        try {
          const auth = await requireAssistantUser(request);
          supabase = auth.supabase;
          userId = auth.userId;
        } catch (error) {
          if (error instanceof Response) return error;
          return new Response("Sign in to use the assistant.", { status: 401 });
        }

        let body: ChatBody;
        try {
          body = (await request.json()) as ChatBody;
        } catch {
          return new Response("Invalid request.", { status: 400 });
        }
        if (!body.threadId || !Array.isArray(body.messages)) {
          return new Response("threadId and messages are required.", { status: 400 });
        }

        // Confirm the thread belongs to this user (RLS also enforces it, but
        // this gives a clean 404 instead of an empty stream).
        const { data: thread, error: threadError } = await supabase
          .from("assistant_threads")
          .select("id")
          .eq("id", body.threadId)
          .maybeSingle();
        if (threadError) return new Response(threadError.message, { status: 500 });
        if (!thread) return new Response("Conversation not found.", { status: 404 });

        const geminiKey = process.env["GEMINI_API_KEY"];
        const grounded = Boolean(geminiKey);

        const tools = buildAssistantTools(supabase, userId);

        let model;
        let modelTools: Record<string, unknown> = tools;
        if (geminiKey) {
          const google = createGoogleGenerativeAI({ apiKey: geminiKey });
          model = google("gemini-2.5-flash");
          // [INVARIANT] Google Search grounding is a provider-defined tool and
          // Gemini refuses to combine it with our own function tools in one
          // request. So web research runs as its OWN grounded sub-request,
          // exposed to the assistant as an ordinary `search_web` function. Both
          // capabilities stay available and the platform tools keep working.
          modelTools = {
            ...tools,
            search_web: tool({
              description:
                "Search the live web (Google) for current worldwide news, prices, releases or events. Returns a grounded summary with its sources. Use for anything outside P-Trades' own data; always report the source and date. Never use it for the user's own account numbers.",
              inputSchema: z.object({
                query: z.string().describe("What to look up on the web, in plain words."),
              }),
              execute: async ({ query }) => {
                const research = await generateText({
                  model: google("gemini-2.5-flash"),
                  system:
                    "You are a research fetcher. Answer only from the search results. State each fact with its source name and publication date. If the results do not answer the question, say so plainly. Never invent numbers.",
                  prompt: query,
                  tools: { google_search: google.tools.googleSearch({}) },
                });
                return {
                  answer: research.text,
                  sources: research.sources.map((source) =>
                    "url" in source
                      ? { title: source.title ?? source.url, url: source.url }
                      : { title: source.title ?? "source", url: null },
                  ),
                  retrieved_at: new Date().toISOString(),
                };
              },
            }),
          } as Record<string, unknown>;
        } else {
          const lovableKey = process.env["LOVABLE_API_KEY"];
          if (!lovableKey) {
            return new Response("The assistant is not configured yet.", { status: 503 });
          }
          const gateway = createOpenAICompatible({
            name: "lovable",
            baseURL: "https://ai.gateway.lovable.dev/v1",
            headers: { "Lovable-API-Key": lovableKey },
          });
          model = gateway("google/gemini-3.5-flash");
        }

        const system =
          ASSISTANT_SYSTEM_PROMPT +
          `\n\nThe current date and time is ${new Date().toISOString()} (UTC). Use it to work out relative windows such as "the past 2 weeks" — prefer passing days to a tool over computing dates yourself.` +
          (grounded
            ? "\n\nYou have a search_web tool for live worldwide news and data. Use it when the user asks about current events; always name the source and date it returns."
            : "\n\nLive web search is NOT available in this deployment. If the user asks about current news, say plainly that you cannot check outside news right now.");


        const lastUser = [...body.messages].reverse().find((m) => m.role === "user");

        try {
          const result = streamText({
            model,
            system,
            messages: await convertToModelMessages(body.messages),
            tools: modelTools as typeof tools,
            stopWhen: stepCountIs(10),
            abortSignal: request.signal,
          });

          return result.toUIMessageStreamResponse({
            originalMessages: body.messages,
            sendReasoning: true,
            sendSources: true,
            onFinish: async ({ messages: finalMessages }) => {
              // Persist the new turns (user message + assistant reply). Only
              // assistant_messages rows owned by this user — RLS enforces it.
              try {
                const newMessages = finalMessages.slice(body.messages!.length - 1);
                const rows = newMessages
                  .filter((m) => m.role === "user" || m.role === "assistant")
                  .map((m) => ({
                    thread_id: body.threadId!,
                    user_id: userId,
                    message_id: m.id,
                    role: m.role,
                    parts: m.parts as never,
                  }));
                if (rows.length > 0) {
                  await supabase.from("assistant_messages").upsert(rows, {
                    onConflict: "thread_id,message_id",
                  });
                  // First user message becomes the thread title.
                  if (lastUser) {
                    const title = plainText(lastUser).slice(0, 80);
                    if (title) {
                      const { data: current } = await supabase
                        .from("assistant_threads")
                        .select("title")
                        .eq("id", body.threadId!)
                        .maybeSingle();
                      if (current?.title === "New conversation") {
                        await supabase
                          .from("assistant_threads")
                          .update({ title })
                          .eq("id", body.threadId!);
                      }
                    }
                  }
                  await supabase
                    .from("assistant_threads")
                    .update({ updated_at: new Date().toISOString() })
                    .eq("id", body.threadId!);
                }
              } catch (persistError) {
                console.error("[assistant] failed to persist turn", persistError);
              }
            },
          });
        } catch (error) {
          console.error("[assistant] stream failed", error);
          return new Response("The assistant could not answer right now. Please try again.", {
            status: 500,
          });
        }
      },
    },
  },
});
