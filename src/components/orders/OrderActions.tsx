import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function OrderActions({ number, children }: { number: string; children: ReactNode }) {
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" size="icon" className="size-10 shrink-0" aria-label={`Ações da encomenda ${number}`} title="Ações"><MoreHorizontal className="size-5" /></Button></PopoverTrigger>
    <PopoverContent align="end" className="w-56 p-2">
      <div className="px-2 py-2 text-xs font-semibold text-muted-foreground">Encomenda {number}</div>
      <div className="flex flex-col items-stretch gap-1 [&_button]:w-full [&_button]:justify-start [&_button]:text-sm [&_span]:block">{children}</div>
    </PopoverContent>
  </Popover>;
}