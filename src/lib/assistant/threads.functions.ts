/**
 * Thread management for the in-app assistant. Every function is behind
 * requireSupabaseAuth and uses context.supabase, so RLS scopes everything to
 * the signed-in user. Message bodies themselves are persisted by the chat
 * route after each streamed turn.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listAssistantThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("assistant_threads")
      .select("id, title, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createAssistantThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("assistant_threads")
      .insert({ user_id: context.userId })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not create conversation");
    return { id: data.id };
  });

export const getAssistantThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { data: thread, error: threadError } = await context.supabase
      .from("assistant_threads")
      .select("id, title, created_at, updated_at")
      .eq("id", data.id)
      .maybeSingle();
    if (threadError) throw new Error(threadError.message);
    if (!thread) return null;
    const { data: messages, error: messagesError } = await context.supabase
      .from("assistant_messages")
      .select("message_id, role, parts, created_at")
      .eq("thread_id", data.id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (messagesError) throw new Error(messagesError.message);
    return { thread, messages: messages ?? [] };
  });

export const deleteAssistantThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("assistant_threads").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
