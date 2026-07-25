## Objetivo
Permitir vincular cada **Referência de Tecido** (ex.: OPERA) a um **Tipo de Tecido** (ex.: Aveludado). O vínculo aparece:
- Na tab "Refs. Tecido" do catálogo (coluna + edição).
- No formulário de **Nova encomenda** — ao escolher um Tipo de Tecido, o dropdown de Ref. Tecido filtra automaticamente para as refs compatíveis (mais as sem tipo definido).

## Alterações

### 1) Migração — `ref_fabric_refs.fabric_type_id`
- `ALTER TABLE ref_fabric_refs ADD COLUMN fabric_type_id uuid REFERENCES ref_fabric_types(id) ON DELETE SET NULL`.
- Index em `fabric_type_id`.
- Sem impacto em RLS/GRANT (mantém as existentes).

### 2) `src/lib/catalog.functions.ts`
- `RefRow`: adicionar `fabric_type_id?: string | null`.
- `listRef` (kind `fabric_refs`): selecionar `id, code, name, active, fabric_type_id`.
- `upsertSchema` + `upsertRef`: aceitar `fabric_type_id` (nullable) e gravar quando `kind === "fabric_refs"`.
- `getCatalogs`: incluir `fabric_type_id` no select de `ref_fabric_refs`.

### 3) `src/routes/_authenticated/admin.catalogo.tsx`
- Na tab "Refs. Tecido":
  - Nova coluna **Tipo** que mostra o código/nome do fabric_type vinculado.
  - `UpsertDialog`: quando `kind === "fabric_refs"`, mostrar um Select com todos os `fabric_types` ativos (opção "— nenhum —" para desvincular).
- Passar a lista de fabric_types para o diálogo (via `useQuery(["ref","fabric_types"])`) e reutilizar `catById` para mostrar o vínculo na tabela.

### 4) `src/routes/_authenticated/encomendas.nova.tsx`
- Ao renderizar o `RefSelect` da Ref. Tecido, filtrar `cat?.fabric_refs` por `fabric_type_id === form.fabric_type_id` (ou `null` — refs sem tipo continuam disponíveis para não bloquear casos legados).
- Se a ref atualmente escolhida deixar de ser compatível com o novo tipo, limpar `form.fabric_ref_id`.
- Manter o parsing por código (barcode) inalterado.

## Fora de âmbito
- Não altero `product_recipe` (não guarda tecido) nem a semântica das encomendas existentes.
- Não faço backfill automático — deixo o admin definir o tipo em cada ref via UI (é rápido e evita palpites como "OPERA = aveludado").
