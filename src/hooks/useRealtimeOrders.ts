import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RealtimeStatus = "conectando" | "ligado" | "sem-ligacao";

const DEFAULT_TABLES = [
  "production_orders",
  "order_stages",
  "order_colis",
  "order_coli_stages",
  "stage_time_logs",
];

type Options = {
  /** Tables to listen to. Defaults to the core production tables. */
  tables?: string[];
  /** Debounce window (ms) to coalesce bursts of DB events. */
  debounceMs?: number;
  /** Set false to pause the subscription (e.g. no session yet). */
  enabled?: boolean;
};

/**
 * Subscribes to Postgres changes and invalidates the given query keys.
 * - one channel per component instance (no cross-page channel collisions)
 * - events coalesced so a burst of DB writes triggers a single refetch
 * - refetches once on tab focus / reconnect to recover missed events
 */
export function useRealtimeOrders(invalidateKeys: string[][], options: Options = {}) {
  const { tables = DEFAULT_TABLES, debounceMs = 300, enabled = true } = options;
  const qc = useQueryClient();
  const instanceId = useId();
  const [status, setStatus] = useState<RealtimeStatus>("conectando");

  const keysRef = useRef(invalidateKeys);
  keysRef.current = invalidateKeys;

  const keysSignature = JSON.stringify(invalidateKeys);
  const tablesSignature = JSON.stringify(tables);

  useEffect(() => {
    if (!enabled) {
      setStatus("conectando");
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      keysRef.current.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    };
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(flush, debounceMs);
    };

    const channel = supabase.channel(`up-realtime${instanceId}-${tablesSignature.length}`);
    for (const table of tables) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, schedule);
    }

    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") setStatus("ligado");
      else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") setStatus("sem-ligacao");
      else setStatus("conectando");
    });

    // Recover any events missed while the tab was hidden or offline
    const onWake = () => {
      if (document.visibilityState === "visible") schedule();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, keysSignature, tablesSignature, debounceMs, enabled, instanceId]);

  return status;
}
