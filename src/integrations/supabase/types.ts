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
          state: string
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
          state?: string
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
          state?: string
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
      finished_goods: {
        Row: {
          barcode: string | null
          created_at: string
          id: string
          order_id: string | null
          product_code: string | null
          quantity: number
          ready_for_transfer: boolean
          status: string
          transferred_at: string | null
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          product_code?: string | null
          quantity?: number
          ready_for_transfer?: boolean
          status?: string
          transferred_at?: string | null
        }
        Update: {
          barcode?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          product_code?: string | null
          quantity?: number
          ready_for_transfer?: boolean
          status?: string
          transferred_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finished_goods_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
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
          user_id: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          role?: string | null
          user_id?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          role?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      order_coli_stages: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          is_paused: boolean
          last_resume_at: string | null
          notes: string | null
          operator_id: string | null
          order_coli_id: string
          order_id: string
          pause_started_at: string | null
          paused_seconds: number
          productive_seconds: number
          stage: Database["public"]["Enums"]["production_stage"]
          started_at: string | null
          status: Database["public"]["Enums"]["stage_status"]
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          is_paused?: boolean
          last_resume_at?: string | null
          notes?: string | null
          operator_id?: string | null
          order_coli_id: string
          order_id: string
          pause_started_at?: string | null
          paused_seconds?: number
          productive_seconds?: number
          stage: Database["public"]["Enums"]["production_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["stage_status"]
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          is_paused?: boolean
          last_resume_at?: string | null
          notes?: string | null
          operator_id?: string | null
          order_coli_id?: string
          order_id?: string
          pause_started_at?: string | null
          paused_seconds?: number
          productive_seconds?: number
          stage?: Database["public"]["Enums"]["production_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["stage_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_coli_stages_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_coli_stages_order_coli_id_fkey"
            columns: ["order_coli_id"]
            isOneToOne: false
            referencedRelation: "order_colis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_coli_stages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_colis: {
        Row: {
          coli_barcode: string
          coli_name: string
          coli_number: number
          created_at: string
          id: string
          order_id: string
          status: string
        }
        Insert: {
          coli_barcode: string
          coli_name: string
          coli_number: number
          created_at?: string
          id?: string
          order_id: string
          status?: string
        }
        Update: {
          coli_barcode?: string
          coli_name?: string
          coli_number?: number
          created_at?: string
          id?: string
          order_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_colis_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_stages: {
        Row: {
          check_valid: boolean
          duration_minutes: number | null
          finished_at: string | null
          id: string
          is_paused: boolean
          is_rework: boolean
          notes: string | null
          operator_id: string | null
          order_id: string
          paused_seconds: number
          production_mode: string
          productive_seconds: number
          rework_count: number
          rework_seconds: number
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
          is_rework?: boolean
          notes?: string | null
          operator_id?: string | null
          order_id: string
          paused_seconds?: number
          production_mode?: string
          productive_seconds?: number
          rework_count?: number
          rework_seconds?: number
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
          is_rework?: boolean
          notes?: string | null
          operator_id?: string | null
          order_id?: string
          paused_seconds?: number
          production_mode?: string
          productive_seconds?: number
          rework_count?: number
          rework_seconds?: number
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
      picking_dispatches: {
        Row: {
          batch_id: string
          created_at: string
          dispatched_at: string
          id: string
          operator_id: string | null
          order_id: string
          response_body: string | null
          response_code: number | null
          status: string
          updated_at: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          dispatched_at?: string
          id?: string
          operator_id?: string | null
          order_id: string
          response_body?: string | null
          response_code?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          dispatched_at?: string
          id?: string
          operator_id?: string | null
          order_id?: string
          response_body?: string | null
          response_code?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "picking_dispatches_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_dispatches_order_id_fkey"
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
          reserved_cover_id: string | null
          reserved_cover_state: string | null
          reserved_shell_id: string | null
          reserved_shell_state: string | null
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
          reserved_cover_id?: string | null
          reserved_cover_state?: string | null
          reserved_shell_id?: string | null
          reserved_shell_state?: string | null
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
          reserved_cover_id?: string | null
          reserved_cover_state?: string | null
          reserved_shell_id?: string | null
          reserved_shell_state?: string | null
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
          {
            foreignKeyName: "production_orders_reserved_cover_id_fkey"
            columns: ["reserved_cover_id"]
            isOneToOne: false
            referencedRelation: "covers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_reserved_shell_id_fkey"
            columns: ["reserved_shell_id"]
            isOneToOne: false
            referencedRelation: "shells"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_check_items: {
        Row: {
          check_id: string
          created_at: string
          id: string
          label: string
          photo_url: string | null
          status: string
          template_item_id: string | null
        }
        Insert: {
          check_id: string
          created_at?: string
          id?: string
          label: string
          photo_url?: string | null
          status: string
          template_item_id?: string | null
        }
        Update: {
          check_id?: string
          created_at?: string
          id?: string
          label?: string
          photo_url?: string | null
          status?: string
          template_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_check_items_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "quality_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_check_items_template_item_id_fkey"
            columns: ["template_item_id"]
            isOneToOne: false
            referencedRelation: "quality_template_items"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_checks: {
        Row: {
          created_at: string
          has_nok: boolean
          id: string
          notes: string | null
          operator_id: string | null
          order_id: string
          result: string
          template_id: string | null
        }
        Insert: {
          created_at?: string
          has_nok?: boolean
          id?: string
          notes?: string | null
          operator_id?: string | null
          order_id: string
          result: string
          template_id?: string | null
        }
        Update: {
          created_at?: string
          has_nok?: boolean
          id?: string
          notes?: string | null
          operator_id?: string | null
          order_id?: string
          result?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_checks_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_checks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_checks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "quality_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_template_items: {
        Row: {
          created_at: string
          id: string
          label: string
          sort_order: number
          template_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          sort_order?: number
          template_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          sort_order?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quality_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "quality_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_templates: {
        Row: {
          active: boolean
          category_code: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_code: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_code?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
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
          directional: boolean
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          directional?: boolean
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          directional?: boolean
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
      rework_events: {
        Row: {
          created_at: string
          detected_at_stage: Database["public"]["Enums"]["production_stage"]
          id: string
          operator_id: string | null
          order_id: string | null
          reason_id: string | null
          reason_notes: string | null
          resolved_at: string | null
          sent_to_stage: Database["public"]["Enums"]["production_stage"]
          status: string
        }
        Insert: {
          created_at?: string
          detected_at_stage: Database["public"]["Enums"]["production_stage"]
          id?: string
          operator_id?: string | null
          order_id?: string | null
          reason_id?: string | null
          reason_notes?: string | null
          resolved_at?: string | null
          sent_to_stage: Database["public"]["Enums"]["production_stage"]
          status?: string
        }
        Update: {
          created_at?: string
          detected_at_stage?: Database["public"]["Enums"]["production_stage"]
          id?: string
          operator_id?: string | null
          order_id?: string | null
          reason_id?: string | null
          reason_notes?: string | null
          resolved_at?: string | null
          sent_to_stage?: Database["public"]["Enums"]["production_stage"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rework_events_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rework_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rework_events_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "rework_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      rework_reasons: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
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
          state: string
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
          state?: string
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
          state?: string
          structure_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sla_breaches: {
        Row: {
          actual_productive_minutes: number
          created_at: string
          expected_minutes: number
          id: string
          operator_id: string | null
          order_id: string | null
          over_minutes: number
          stage: Database["public"]["Enums"]["production_stage"]
        }
        Insert: {
          actual_productive_minutes: number
          created_at?: string
          expected_minutes: number
          id?: string
          operator_id?: string | null
          order_id?: string | null
          over_minutes: number
          stage: Database["public"]["Enums"]["production_stage"]
        }
        Update: {
          actual_productive_minutes?: number
          created_at?: string
          expected_minutes?: number
          id?: string
          operator_id?: string | null
          order_id?: string | null
          over_minutes?: number
          stage?: Database["public"]["Enums"]["production_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "sla_breaches_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_breaches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_sla_category: {
        Row: {
          category_code: string
          created_at: string
          expected_minutes: number
          id: string
          stage: Database["public"]["Enums"]["production_stage"]
          updated_at: string
        }
        Insert: {
          category_code: string
          created_at?: string
          expected_minutes: number
          id?: string
          stage: Database["public"]["Enums"]["production_stage"]
          updated_at?: string
        }
        Update: {
          category_code?: string
          created_at?: string
          expected_minutes?: number
          id?: string
          stage?: Database["public"]["Enums"]["production_stage"]
          updated_at?: string
        }
        Relationships: []
      }
      stage_sla_model: {
        Row: {
          category_code: string
          created_at: string
          expected_minutes: number
          id: string
          model_code: string
          stage: Database["public"]["Enums"]["production_stage"]
          updated_at: string
        }
        Insert: {
          category_code: string
          created_at?: string
          expected_minutes: number
          id?: string
          model_code: string
          stage: Database["public"]["Enums"]["production_stage"]
          updated_at?: string
        }
        Update: {
          category_code?: string
          created_at?: string
          expected_minutes?: number
          id?: string
          model_code?: string
          stage?: Database["public"]["Enums"]["production_stage"]
          updated_at?: string
        }
        Relationships: []
      }
      stage_sla_product: {
        Row: {
          category_code: string
          created_at: string
          expected_minutes: number
          id: string
          measure_code: string
          model_code: string
          stage: Database["public"]["Enums"]["production_stage"]
          structure_code: string
          updated_at: string
        }
        Insert: {
          category_code: string
          created_at?: string
          expected_minutes: number
          id?: string
          measure_code: string
          model_code: string
          stage: Database["public"]["Enums"]["production_stage"]
          structure_code: string
          updated_at?: string
        }
        Update: {
          category_code?: string
          created_at?: string
          expected_minutes?: number
          id?: string
          measure_code?: string
          model_code?: string
          stage?: Database["public"]["Enums"]["production_stage"]
          structure_code?: string
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
      structure_coli_routes: {
        Row: {
          category_code: string
          coli_name: string
          coli_number: number
          created_at: string
          id: string
          structure_code: string
          updated_at: string
        }
        Insert: {
          category_code: string
          coli_name: string
          coli_number: number
          created_at?: string
          id?: string
          structure_code: string
          updated_at?: string
        }
        Update: {
          category_code?: string
          coli_name?: string
          coli_number?: number
          created_at?: string
          id?: string
          structure_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      structure_coli_stages: {
        Row: {
          id: string
          included: boolean
          route_id: string
          sort_order: number
          stage: Database["public"]["Enums"]["production_stage"]
        }
        Insert: {
          id?: string
          included?: boolean
          route_id: string
          sort_order?: number
          stage: Database["public"]["Enums"]["production_stage"]
        }
        Update: {
          id?: string
          included?: boolean
          route_id?: string
          sort_order?: number
          stage?: Database["public"]["Enums"]["production_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "structure_coli_stages_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "structure_coli_routes"
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
      cancel_order_with_recovery: { Args: { _order_id: string }; Returns: Json }
      create_order_colis: { Args: { _order_id: string }; Returns: Json }
      finalize_shell_batch: {
        Args: { _batch_id: string; _operator_code: string }
        Returns: Json
      }
      finalize_stage_group: {
        Args: { _operator_code: string; _order_stage_ids: string[] }
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
          state: string
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
      find_matching_cover_state: {
        Args: { _order_id: string; _state: string }
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
          state: string
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
      get_expected_minutes: {
        Args: {
          _order_id: string
          _stage: Database["public"]["Enums"]["production_stage"]
        }
        Returns: number
      }
      get_order_route_keys: {
        Args: { _order_id: string }
        Returns: {
          category_code: string
          structure_code: string
        }[]
      }
      get_stage_groups: {
        Args: { _stage: Database["public"]["Enums"]["production_stage"] }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_operator_only: { Args: { _user_id: string }; Returns: boolean }
      preview_cancel_order: { Args: { _order_id: string }; Returns: Json }
      record_coli_stage_event: {
        Args: {
          _event: string
          _operator_code: string
          _order_coli_stage_id: string
        }
        Returns: Json
      }
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
      scan_picking_coli: {
        Args: {
          _operator_code: string
          _order_id: string
          _scanned_code: string
        }
        Returns: Json
      }
      send_to_rework: {
        Args: {
          _detected_stage: Database["public"]["Enums"]["production_stage"]
          _operator_code: string
          _order_id: string
          _reason_id: string
          _reason_notes: string
          _target_stage: Database["public"]["Enums"]["production_stage"]
        }
        Returns: Json
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
      stage_order_index: {
        Args: { _s: Database["public"]["Enums"]["production_stage"] }
        Returns: number
      }
      start_shell_batch: {
        Args: { _operator_code: string; _quantity: number; _shell_id: string }
        Returns: string
      }
      sync_order_stage_from_colis: {
        Args: {
          _order_id: string
          _stage: Database["public"]["Enums"]["production_stage"]
        }
        Returns: undefined
      }
      try_reserve_for_order: { Args: { _order_id: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "operador" | "escritorio" | "picador"
      order_status:
        | "pendente"
        | "em_producao"
        | "concluida"
        | "cancelada"
        | "em_armazem"
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
      app_role: ["admin", "operador", "escritorio", "picador"],
      order_status: [
        "pendente",
        "em_producao",
        "concluida",
        "cancelada",
        "em_armazem",
      ],
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
