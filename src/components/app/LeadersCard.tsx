import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

const sb = supabase as any;

export function LeadersCard() {
  const qc = useQueryClient();
  const { data: ops } = useQuery({
    queryKey: ["leaders-ops"],
    queryFn: async () => {
      const { data, error } = await sb.from("operators").select("id, code, name, is_leader").eq("active", true).order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; code: string; name: string; is_leader: boolean }[];
    },
  });
  async function set(id: string, v: boolean) {
    const { error } = await sb.rpc("set_operator_leader", { _operator_id: id, _value: v });
    if (error) { toast.error(error.message); return; }
    toast.success(v ? "Definido como líder de produção" : "Deixou de ser líder");
    qc.invalidateQueries({ queryKey: ["leaders-ops"] });
    qc.invalidateQueries({ queryKey: ["floor-ops"] });
  }
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Crown className="size-5 text-primary" />
        <div>
          <div className="font-semibold">Líderes de produção</div>
          <div className="text-xs text-muted-foreground">Recebem os pedidos «Chamar líder» e podem chamar operadores ou enviar recados.</div>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {(ops ?? []).map((o) => (
          <label key={o.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
            <span className="text-sm"><span className="font-mono text-xs text-muted-foreground mr-2">{o.code}</span>{o.name}</span>
            <Switch checked={o.is_leader} onCheckedChange={(v) => set(o.id, v)} />
          </label>
        ))}
      </div>
    </Card>
  );
}
