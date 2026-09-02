import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listUrgentActive, type UrgentOrder } from "@/lib/orders.functions";
import { useServerFn } from "@tanstack/react-start";
import { STAGE_LABELS, formatDatePT } from "@/lib/format";
import { Flame, ChevronUp, ChevronDown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "@tanstack/react-router";

export function UrgentBar() {
  const fetchUrgent = useServerFn(listUrgentActive);
  const { session } = useAuth();
  const { data } = useQuery({
    queryKey: ["urgent-active"],
    queryFn: () => fetchUrgent(),
    refetchInterval: 30000,
    enabled: Boolean(session),
  });
  const [collapsed, setCollapsed] = useState(false);
  const urgent = (data ?? []) as UrgentOrder[];

  if (urgent.length === 0) return null;

  return (
    <div className="rounded-lg border-2 border-red-500 bg-red-50 dark:bg-red-950/30 overflow-hidden">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-red-600 text-white"
      >
        <Flame className="size-4 animate-pulse" />
        <span className="font-bold text-sm uppercase tracking-wide">
          Urgentes em produção ({urgent.length})
        </span>
        <span className="ml-auto">
          {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </span>
      </button>
      {!collapsed && (
        <div className="p-2 flex flex-wrap gap-2">
          {urgent.map((o) => (
            <Link
              key={o.id}
              to="/producao"
              search={{ q: o.order_number, stage: o.stage }}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white dark:bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/40 transition"
            >
              <span className="font-mono font-bold text-red-700 dark:text-red-400">
                {o.customer_order ?? o.order_number}
              </span>
              <span className="text-muted-foreground">· {STAGE_LABELS[o.stage] ?? o.stage}</span>
              <span className="text-muted-foreground">· Saída {formatDatePT(o.due_date)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
