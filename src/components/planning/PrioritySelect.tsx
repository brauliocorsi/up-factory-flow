import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { priorityLabel, priorityRank } from "./PriorityBadge";

const OPTIONS = [
  { value: "3", label: "Urgente" },
  { value: "2", label: "Média" },
  { value: "1", label: "Baixa" },
];

export function PrioritySelect({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const rank = String(priorityRank(value));
  return (
    <Select
      value={rank}
      onValueChange={(v) => onChange(Number(v))}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-28 text-xs">
        <SelectValue>{priorityLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
