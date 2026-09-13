import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/assistant")({
  component: AssistantLayout,
});

function AssistantLayout() {
  return <Outlet />;
}
