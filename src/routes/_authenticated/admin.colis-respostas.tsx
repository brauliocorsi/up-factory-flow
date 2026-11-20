import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/colis-respostas")({
  head: () => ({
    meta: [
      { title: "Respostas de volumes — UP Fábrica" },
      { name: "description", content: "Compare os volumes indicados pelos colaboradores com os registados." },
      { property: "og:title", content: "Respostas de volumes — UP Fábrica" },
      { property: "og:description", content: "Compare os volumes indicados pelos colaboradores com os registados." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { data, isLoading } = useQuery({
    queryKey: ["colis-respostas"],
    queryFn: async () => {
      const [{ data: models }, { data: pk }, { data: decls }, { data: ops }] = await Promise.all([
        supabase.from("models").select("id, code, name").eq("active", true).order("name").range(0, 1999),
        supabase.from("model_packages").select("model_id, package_number").range(0, 9999),
        supabase.from("coli_count_declarations").select("model_id, operator_id, colis, names, note").range(0, 9999),
        supabase.from("operators").select("id, name"),
      ]);
      const opName = new Map((ops ?? []).map((o: { id: string; name: string }) => [o.id, o.name]));
      const official = new Map<string, number>();
      for (const p of pk ?? []) official.set(p.model_id, Math.max(official.get(p.model_id) ?? 0, p.package_number));
      return (models ?? []).map((m) => {
        const ds = (decls ?? []).filter((d) => d.model_id === m.id);
        return { ...m, official: official.get(m.id) ?? 0, ds: ds.map((d) => ({ ...d, who: (d.operator_id && opName.get(d.operator_id)) || "—" })) };
      });
    },
  });
  const link = typeof window !== "undefined" ? `${window.location.origin}/colis` : "/colis";
  const answered = (data ?? []).filter((r) => r.ds.length).length;
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Volumes indicados pelos colaboradores</h1>
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm">Link para enviar:</span>
        <code className="rounded bg-muted px-2 py-1 text-sm">{link}</code>
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(link); toast.success("Link copiado"); }}>
          <Copy className="mr-1 h-4 w-4" />Copiar
        </Button>
        <span className="ml-auto text-sm text-muted-foreground">{answered}/{data?.length ?? 0} produtos com resposta</span>
      </Card>
      {isLoading ? <p>A carregar…</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Registado</TableHead><TableHead>Respostas</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((r) => {
              const diff = r.ds.some((d) => d.colis !== r.official);
              return (
                <TableRow key={r.id} className={diff ? "bg-destructive/10" : undefined}>
                  <TableCell><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.code}</div></TableCell>
                  <TableCell>{r.official || "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.ds.length === 0 ? <span className="text-muted-foreground">Sem resposta</span> :
                      r.ds.map((d, i) => <div key={i}><b>{d.colis}</b> — {d.who}{d.names ? ` · ${d.names}` : ""}{d.note ? ` · ${d.note}` : ""}</div>)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
