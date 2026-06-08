import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useRealtimeOrders(invalidateKeys: string[][]) {
  const qc = useQueryClient();
  const key = JSON.stringify(invalidateKeys);
  useEffect(() => {
    const channel = supabase
      .channel("up-producao-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "production_orders" }, () => {
        invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_stages" }, () => {
        invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, key]);
}