import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { isClockSkewError, retryDelay, shouldRetryQuery } from "@/lib/auth/clock-skew";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, retryDelay },
      mutations: { retry: (n, e) => isClockSkewError(e) && n < 2, retryDelay },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
