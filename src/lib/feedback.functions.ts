/**
 * Feedback server functions — Zod-validated insert plus admin notice and a
 * thank-you confirmation to the submitter.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const FEEDBACK_CATEGORIES = ["bug", "feature", "data", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "Bug",
  feature: "Feature request",
  data: "Data accuracy",
  other: "Other",
};

export interface FeedbackRow {
  id: string;
  category: string;
  message: string;
  contact_email: string | null;
  status: string;
  created_at: string;
}

const feedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  message: z
    .string()
    .trim()
    .min(10, "Please add at least 10 characters")
    .max(2000, "Keep it under 2000 characters"),
  contactEmail: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(255)
    .optional()
    .or(z.literal("")),
});

export const submitFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => feedbackSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const claimEmail =
      typeof context.claims["email"] === "string" ? (context.claims["email"] as string) : null;
    const contactEmail =
      data.contactEmail && data.contactEmail.length > 0 ? data.contactEmail : claimEmail;

    const { data: inserted, error } = await context.supabase
      .from("feedback" as never)
      .insert({
        user_id: context.userId,
        category: data.category,
        message: data.message,
        contact_email: contactEmail,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const id = (inserted as { id: string }).id;
    const label = FEEDBACK_CATEGORY_LABELS[data.category];

    try {
      const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
      await sendTemplateEmail("feedback-received", "", {
        templateData: {
          category: label,
          message: data.message,
          reporterEmail: contactEmail ?? "not provided",
          userId: context.userId,
          submittedAt: new Date().toISOString(),
        },
        idempotencyKey: `feedback-admin-${id}`,
        ...(contactEmail ? { replyTo: contactEmail } : {}),
      });
      if (contactEmail) {
        await sendTemplateEmail("feedback-thank-you", contactEmail, {
          templateData: { category: label, message: data.message },
          idempotencyKey: `feedback-thanks-${id}`,
        });
      }
    } catch (err) {
      console.error("[submitFeedback] email failed", err);
    }

    return { id };
  });

export const listMyFeedback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FeedbackRow[]> => {
    const { data, error } = await context.supabase
      .from("feedback" as never)
      .select("id, category, message, contact_email, status, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as FeedbackRow[];
  });
