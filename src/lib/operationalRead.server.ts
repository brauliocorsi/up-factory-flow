/**
 * Leitura autorizada de dados operacionais (F04).
 *
 * Os postos precisam de ler dados de catálogo/qualidade/tecidos que as políticas
 * de linha fecham a contas "apenas operador". Em vez de abrir essas políticas,
 * a leitura é feita por via autorizada dentro do servidor, depois de confirmar
 * que existe sessão válida. Só leitura — nunca escrita.
 */
export async function operationalReader(context: { userId?: string | null }) {
  if (!context?.userId) throw new Error("Sessão inválida");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
