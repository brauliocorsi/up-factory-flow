import { formatDistanceToNow, format } from "date-fns";
import { pt } from "date-fns/locale";

export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return formatDistanceToNow(new Date(date), { addSuffix: false, locale: pt });
}

export function formatDatePT(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "dd/MM/yyyy", { locale: pt });
}

export const STAGE_LABELS: Record<string, string> = {
  estrutura: "Estrutura",
  corte: "Corte",
  costura: "Costura",
  branco: "Branco",
  estofagem: "Estofagem",
  qualidade: "Qualidade",
  embalagem: "Embalagem",
  picagem: "Picagem",
};

export const STAGES_ORDER = [
  "estrutura",
  "corte",
  "costura",
  "branco",
  "estofagem",
  "qualidade",
  "embalagem",
  "picagem",
] as const;

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_producao: "Em produção",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export const STAGE_STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_curso: "Em curso",
  concluida: "Concluída",
  bloqueada: "Bloqueada",
};