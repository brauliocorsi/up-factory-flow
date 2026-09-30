import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/integrations/erp/orders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleErpOrderRequest } = await import("@/lib/erpIngest.server");
        return handleErpOrderRequest(request);
      },
    },
  },
});
