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
      models: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
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
          notes: string | null
          operator_id: string | null
          order_id: string
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
          notes?: string | null
          operator_id?: string | null
          order_id: string
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
          notes?: string | null
          operator_id?: string | null
          order_id?: string
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
          id: string
          measure: string | null
          model_id: string | null
          notes: string | null
          order_number: string
          priority: number
          product_description: string
          status: Database["public"]["Enums"]["order_status"]
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
          id?: string
          measure?: string | null
          model_id?: string | null
          notes?: string | null
          order_number: string
          priority?: number
          product_description: string
          status?: Database["public"]["Enums"]["order_status"]
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
          id?: string
          measure?: string | null
          model_id?: string | null
          notes?: string | null
          order_number?: string
          priority?: number
          product_description?: string
          status?: Database["public"]["Enums"]["order_status"]
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
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
