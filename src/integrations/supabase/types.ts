export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          id: number
          identification_mode: string
          updated_at: string
        }
        Insert: {
          id?: number
          identification_mode?: string
          updated_at?: string
        }
        Update: {
          id?: number
          identification_mode?: string
          updated_at?: string
        }
        Relationships: []
      }
      covers: {
        Row: {
          active: boolean
          code: string
          color_code: string | null
          created_at: string
          fabric_ref_code: string | null
          fabric_type_code: string | null
          id: string
          location: string | null
          measure_code: string | null
          min_quantity: number
          model_code: string | null
          name: string
          quantity: number
          reserved: number
          structure_code: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          color_code?: string | null
          created_at?: string
          fabric_ref_code?: string | null
          fabric_type_code?: string | null
          id?: string
          location?: string | null
          measure_code?: string | null
          min_quantity?: number
          model_code?: string | null
          name: string
          quantity?: number
          reserved?: number
          structure_code?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          color_code?: string | null
          created_at?: string
          fabric_ref_code?: string | null
          fabric_type_code?: string | null
          id?: string
          location?: string | null
          measure_code?: string | null
          min_quantity?: number
          model_code?: string | null
          name?: string
          quantity?: number
          reserved?: number
          structure_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fabric_rolls: {
        Row: {
          active: boolean
          color_code: string | null
          created_at: string
          fabric_ref_code: string | null
          id: string
          location: string | null
          meters: number
          min_meters: number
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          color_code?: string | null
          created_at?: string
          fabric_ref_code?: string | null
          id?: string
          location?: string | null
          meters?: number
          min_meters?: number
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          color_code?: string | null
          created_at?: string
          fabric_ref_code?: string | null
          id?: string
          location?: string | null
          meters?: number
          min_meters?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_mappings: {
        Row: {
          created_at: string
          id: string
          mapping: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mapping: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mapping?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      model_packages: {
        Row: {
          created_at: string
          id: string
          model_id: string
          package_name: string
          package_number: number
          package_total: number
          structure_type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          model_id: string
          package_name: string
          package_number: number
          package_total: number
          structure_type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          model_id?: string
          package_name?: string
          package_number?: number
          package_total?: number
          structure_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_packages_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
        ]
      }
      models: {
        Row: {
          active: boolean
          category_id: string | null
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_id?: string | null
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "models_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "ref_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_stages: {
        Row: {
          created_at: string
          id: string
          operator_id: string
          stage: Database["public"]["Enums"]["production_stage"]
        }
        Insert: {
          created_at?: string
          id?: string
          operator_id: string
          stage: Database["public"]["Enums"]["production_stage"]
        }
        Update: {
          created_at?: string
          id?: string
          operator_id?: string
          stage?: Database["public"]["Enums"]["production_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "operator_stages_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      operators: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          role: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          role?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          role?: string | null
        }
        Relationships: []
      }
      order_stages: {
        Row: {
          check_valid: boolean
          duration_minutes: number | null
          finished_at: string | null
          id: string
          is_paused: boolean
          notes: string | null
          operator_id: string | null
          order_id: string
          paused_seconds: number
          production_mode: string
          productive_seconds: number
          stage: Database["public"]["Enums"]["production_stage"]
          started_at: string | null
          status: Database["public"]["Enums"]["stage_status"]
          updated_at: string
        }
        Insert: {
          check_valid?: boolean
          duration_minutes?: number | null
          finished_at?: string | null
          id?: string
          is_paused?: boolean
          notes?: string | null
          operator_id?: string | null
          order_id: string
          paused_seconds?: number
          production_mode?: string
          productive_seconds?: number
          stage: Database["public"]["Enums"]["production_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["stage_status"]
          updated_at?: string
        }
        Update: {
          check_valid?: boolean
          duration_minutes?: number | null
          finished_at?: string | null
          id?: string
          is_paused?: boolean
          notes?: string | null
          operator_id?: string | null
          order_id?: string
          paused_seconds?: number
          production_mode?: string
          productive_seconds?: number
          stage?: Database["public"]["Enums"]["production_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["stage_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_stages_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_stages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_recipe: {
        Row: {
          category_code: string
          cover_required: boolean
          created_at: string
          foam_description: string | null
          id: string
          measure_code: string
          meters_per_unit: number | null
          model_code: string
          notes: string | null
          shell_id: string | null
          structure_code: string
          updated_at: string
        }
        Insert: {
          category_code: string
          cover_required?: boolean
          created_at?: string
          foam_description?: string | null
          id?: string
          measure_code: string
          meters_per_unit?: number | null
          model_code: string
          notes?: string | null
          shell_id?: string | null
          structure_code: string
          updated_at?: string
        }
        Update: {
          category_code?: string
          cover_required?: boolean
          created_at?: string
          foam_description?: string | null
          id?: string
          measure_code?: string
          meters_per_unit?: number | null
          model_code?: string
          notes?: string | null
          shell_id?: string | null
          structure_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_recipe_shell_id_fkey"
            columns: ["shell_id"]
            isOneToOne: false
            referencedRelation: "shells"
            referencedColumns: ["id"]
          },
        ]
      }
      production_orders: {
        Row: {
          barcode: string | null
          color: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          entry_date: string
          fabric_ref: string | null
          fabric_type: string | null
          finishing: string | null
          id: string
          is_stock_production: boolean
          measure: string | null
          model_id: string | null
          notes: string | null
          observation: string | null
          order_number: string
          priority: number
          product_description: string
          status: Database["public"]["Enums"]["order_status"]
          stock_item_id: string | null
          stock_item_type: string | null
          stock_quantity: number | null
          structure_type: string | null
        }
        Insert: {
          barcode?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          entry_date?: string
          fabric_ref?: string | null
          fabric_type?: string | null
          finishing?: string | null
          id?: string
          is_stock_production?: boolean
          measure?: string | null
          model_id?: string | null
          notes?: string | null
          observation?: string | null
          order_number: string
          priority?: number
          product_description: string
          status?: Database["public"]["Enums"]["order_status"]
          stock_item_id?: string | null
          stock_item_type?: string | null
          stock_quantity?: number | null
          structure_type?: string | null
        }
        Update: {
          barcode?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          entry_date?: string
          fabric_ref?: string | null
          fabric_type?: string | null
          finishing?: string | null
          id?: string
          is_stock_production?: boolean
          measure?: string | null
          model_id?: string | null
          notes?: string | null
          observation?: string | null
          order_number?: string
          priority?: number
          product_description?: string
          status?: Database["public"]["Enums"]["order_status"]
          stock_item_id?: string | null
          stock_item_type?: string | null
          stock_quantity?: number | null
          structure_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_orders_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
        ]
      }
      ref_categories: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      ref_colors: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      ref_fabric_refs: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      ref_fabric_types: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      ref_measures: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      ref_structures: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      semi_finished_stock: {
        Row: {
          description: string | null
          id: string
          location: string | null
          min_quantity: number
          model_id: string | null
          quantity: number
          stage: Database["public"]["Enums"]["production_stage"]
          updated_at: string
        }
        Insert: {
          description?: string | null
          id?: string
          location?: string | null
          min_quantity?: number
          model_id?: string | null
          quantity?: number
          stage: Database["public"]["Enums"]["production_stage"]
          updated_at?: string
        }
        Update: {
          description?: string | null
          id?: string
          location?: string | null
          min_quantity?: number
          model_id?: string | null
          quantity?: number
          stage?: Database["public"]["Enums"]["production_stage"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "semi_finished_stock_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
        ]
      }
      shell_batch_logs: {
        Row: {
          batch_id: string
          event: string
          event_at: string
          id: string
          operator_id: string | null
        }
        Insert: {
          batch_id: string
          event: string
          event_at?: string
          id?: string
          operator_id?: string | null
        }
        Update: {
          batch_id?: string
          event?: string
          event_at?: string
          id?: string
          operator_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shell_batch_logs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "shell_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shell_batch_logs_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      shell_batches: {
        Row: {
          added_to_stock: number
          assigned_to_orders: number
          created_at: string
          finished_at: string | null
          id: string
          is_paused: boolean
          operator_id: string | null
          paused_seconds: number
          productive_seconds: number
          quantity: number
          seconds_per_unit: number | null
          shell_id: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          added_to_stock?: number
          assigned_to_orders?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          is_paused?: boolean
          operator_id?: string | null
          paused_seconds?: number
          productive_seconds?: number
          quantity: number
          seconds_per_unit?: number | null
          shell_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          added_to_stock?: number
          assigned_to_orders?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          is_paused?: boolean
          operator_id?: string | null
          paused_seconds?: number
          productive_seconds?: number
          quantity?: number
          seconds_per_unit?: number | null
          shell_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shell_batches_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shell_batches_shell_id_fkey"
            columns: ["shell_id"]
            isOneToOne: false
            referencedRelation: "shells"
            referencedColumns: ["id"]
          },
        ]
      }
      shells: {
        Row: {
          active: boolean
          category_code: string | null
          code: string
          created_at: string
          id: string
          location: string | null
          min_quantity: number
          name: string
          quantity: number
          reserved: number
          structure_code: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_code?: string | null
          code: string
          created_at?: string
          id?: string
          location?: string | null
          min_quantity?: number
          name: string
          quantity?: number
          reserved?: number
          structure_code?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_code?: string | null
          code?: string
          created_at?: string
          id?: string
          location?: string | null
          min_quantity?: number
          name?: string
          quantity?: number
          reserved?: number
          structure_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      stage_time_logs: {
        Row: {
          created_at: string
          event: string
          event_at: string
          id: string
          operator_id: string | null
          order_stage_id: string
        }
        Insert: {
          created_at?: string
          event: string
          event_at?: string
          id?: string
          operator_id?: string | null
          order_stage_id: string
        }
        Update: {
          created_at?: string
          event?: string
          event_at?: string
          id?: string
          operator_id?: string | null
          order_stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_time_logs_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_time_logs_order_stage_id_fkey"
            columns: ["order_stage_id"]
            isOneToOne: false
            referencedRelation: "order_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          delta: number
          id: string
          item_id: string
          item_type: string
          reason: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          delta: number
          id?: string
          item_id: string
          item_type: string
          reason?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          delta?: number
          id?: string
          item_id?: string
          item_type?: string
          reason?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cancel_order_with_recovery: { Args: { _order_id: string }; Returns: Json }
      finalize_shell_batch: {
        Args: { _batch_id: string; _operator_code: string }
        Returns: Json
      }
      find_matching_cover: {
        Args: { _order_id: string }
        Returns: {
          active: boolean
          code: string
          color_code: string | null
          created_at: string
          fabric_ref_code: string | null
          fabric_type_code: string | null
          id: string
          location: string | null
          measure_code: string | null
          min_quantity: number
          model_code: string | null
          name: string
          quantity: number
          reserved: number
          structure_code: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "covers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      preview_cancel_order: { Args: { _order_id: string }; Returns: Json }
      record_shell_batch_event: {
        Args: { _batch_id: string; _event: string; _operator_code: string }
        Returns: Json
      }
      record_stage_event: {
        Args: {
          _event: string
          _operator_code: string
          _order_stage_id: string
        }
        Returns: Json
      }
      resolve_order_recipe: {
        Args: { _order_id: string }
        Returns: {
          category_code: string
          cover_required: boolean
          created_at: string
          foam_description: string | null
          id: string
          measure_code: string
          meters_per_unit: number | null
          model_code: string
          notes: string | null
          shell_id: string | null
          structure_code: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "product_recipe"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shell_needs_grouped: {
        Args: never
        Returns: {
          available: number
          gross_need: number
          net_need: number
          quantity: number
          reserved: number
          shell_code: string
          shell_id: string
          shell_name: string
          waiting_orders: Json
        }[]
      }
      start_shell_batch: {
        Args: { _operator_code: string; _quantity: number; _shell_id: string }
        Returns: string
      }
      try_reserve_for_order: { Args: { _order_id: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "operador" | "escritorio"
      order_status: "pendente" | "em_producao" | "concluida" | "cancelada"
      production_stage:
        | "estrutura"
        | "corte"
        | "costura"
        | "branco"
        | "estofagem"
        | "qualidade"
        | "embalagem"
        | "picagem"
      stage_status: "pendente" | "em_curso" | "concluida" | "bloqueada"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operador", "escritorio"],
      order_status: ["pendente", "em_producao", "concluida", "cancelada"],
      production_stage: [
        "estrutura",
        "corte",
        "costura",
        "branco",
        "estofagem",
        "qualidade",
        "embalagem",
        "picagem",
      ],
      stage_status: ["pendente", "em_curso", "concluida", "bloqueada"],
    },
  },
} as const
