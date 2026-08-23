import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MessageSquare, Send } from "lucide-react";

import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  listMyFeedback,
  submitFeedback,
  type FeedbackCategory,
} from "@/lib/feedback.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function FeedbackSection({ defaultEmail }: { defaultEmail?: string }) {
  const queryClient = useQueryClient();
  const send = useServerFn(submitFeedback);
  const list = useServerFn(listMyFeedback);

  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [contactEmail, setContactEmail] = useState(defaultEmail ?? "");

  const mine = useQuery({
    queryKey: ["my-feedback"],
    queryFn: () => list({ data: undefined }),
  });

  const mutation = useMutation({
    mutationFn: () => send({ data: { category, message, contactEmail: contactEmail.trim() } }),
    onSuccess: async () => {
      setMessage("");
      toast.success("Feedback sent — thank you");
      await queryClient.invalidateQueries({ queryKey: ["my-feedback"] });
    },
    onError: (e) => {
      const raw = e instanceof Error ? e.message : "Could not send feedback";
      toast.error(
        raw.includes("characters") ? raw : "Could not send feedback — check the message length",
      );
    },
  });

  const tooShort = message.trim().length < 10;

  return (
    <section className="space-y-4 rounded-md border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="size-4 text-muted-foreground" />
        <h2 className="label-xs">Feedback</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Report a bug, request a feature or flag a data discrepancy. Every submission is read —
        you&apos;ll get a confirmation email straight away.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label className="text-xs" htmlFor="feedback-category">
            Category
          </Label>
          <Select value={category} onValueChange={(v) => setCategory(v as FeedbackCategory)}>
            <SelectTrigger id="feedback-category" className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEEDBACK_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {FEEDBACK_CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs" htmlFor="feedback-email">
            How can we reach you?
          </Label>
          <Input
            id="feedback-email"
            type="email"
            className="mt-2"
            placeholder="you@example.com"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label className="text-xs" htmlFor="feedback-message">
          Message
        </Label>
        <Textarea
          id="feedback-message"
          className="mt-2 min-h-32"
          maxLength={2000}
          placeholder="Describe what you saw, what you expected, and the instrument or screen involved."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">
          <span className="num">{message.length}</span>/2000
        </p>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate()} disabled={tooShort || mutation.isPending}>
          <Send className="size-4" /> {mutation.isPending ? "Sending…" : "Send feedback"}
        </Button>
      </div>

      {(mine.data?.length ?? 0) > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="label-xs">Your recent submissions</p>
          {mine.data!.map((f) => (
            <div key={f.id} className="rounded border border-border/60 bg-background p-3">
              <p className="num text-xs text-muted-foreground">
                {FEEDBACK_CATEGORY_LABELS[f.category as FeedbackCategory] ?? f.category} ·{" "}
                {new Date(f.created_at).toLocaleString()} · {f.status}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{f.message}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
