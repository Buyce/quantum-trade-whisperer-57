CREATE TABLE public.agent_registrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email_hash text NOT NULL,
  ip_hash text NOT NULL,
  client_label text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX agent_registrations_ip_idx ON public.agent_registrations (ip_hash, created_at DESC);
CREATE INDEX agent_registrations_email_idx ON public.agent_registrations (email_hash, created_at DESC);

GRANT ALL ON public.agent_registrations TO service_role;

ALTER TABLE public.agent_registrations ENABLE ROW LEVEL SECURITY;