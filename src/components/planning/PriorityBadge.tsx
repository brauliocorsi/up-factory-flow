import { Badge } from "@/components/ui/badge";
import { Flame, ArrowUp, ArrowDown } from "lucide-react";

export const PRIORITY_LEVELS = {
  3: { label: "Urgente", className: "bg-red-600 text-white", icon: Flame },
  2: { label: "Média", className: "bg-amber-500 text-white", icon: ArrowUp },
  1: { label: "Baixa", className: "bg-slate-400 text-white", icon: ArrowDown },
} as const;

export function priorityLabel(p: number): string {
  return PRIORITY_LEVELS[p as keyof typeof PRIORITY_LEVELS]?.label ?? "Baixa";
}

export function priorityRank(p: number): number {
  if (p >= 3) return 3;
  if (p <= 1) return 1;
  return 2;
}

export function PriorityBadge({ priority, size = "sm" }: { priority: number; size?: "sm" | "xs" }) {
  const level = PRIORITY_LEVELS[priorityRank(priority) as keyof typeof PRIORITY_LEVELS] ?? PRIORITY_LEVELS[1];
  const Icon = level.icon;
  const cls = size === "xs" ? "text-[10px] px-1.5 py-0 gap-0.5" : "text-xs px-2 py-0.5 gap-1";
  return (
    <Badge className={`${level.className} ${cls} gap-1 inline-flex items-center`}>
      <Icon className={size === "xs" ? "size-2.5" : "size-3"} />
      {level.label}
    </Badge>
  );
}
