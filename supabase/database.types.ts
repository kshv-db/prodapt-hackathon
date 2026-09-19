// Hand-authored to match supabase/migrations/*.sql exactly.
//
// This repo has no package.json / Supabase CLI project link yet, so this is
// NOT the output of `supabase gen types typescript`. Once a Next.js (or
// other TS) app and a linked Supabase project exist, regenerate this file
// for real and delete this comment:
//   supabase gen types typescript --linked > supabase/database.types.ts

export type ExpenseCategory =
  | "Food & Dining"
  | "Groceries"
  | "Transport"
  | "Shopping"
  | "Bills & Utilities"
  | "Rent & EMI"
  | "Entertainment"
  | "Health"
  | "Education"
  | "Travel"
  | "Subscriptions"
  | "Other";

export type Persona = "friendly" | "roast" | "coach";
export type ExpenseSource = "manual" | "nl" | "csv" | "seed";
export type ChatRole = "user" | "assistant";

export interface FixedCost {
  label: string;
  amount: number;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          monthly_income: number;
          fixed_costs: FixedCost[];
          persona: Persona;
          created_at: string;
        };
        Insert: {
          id: string;
          name: string;
          monthly_income?: number;
          fixed_costs?: FixedCost[];
          persona?: Persona;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      expenses: {
        Row: {
          id: string;
          user_id: string;
          amount: number;
          category: ExpenseCategory;
          merchant: string | null;
          note: string | null;
          spent_on: string;
          spent_at: string | null;
          source: ExpenseSource;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          amount: number;
          category: ExpenseCategory;
          merchant?: string | null;
          note?: string | null;
          spent_on: string;
          spent_at?: string | null;
          source?: ExpenseSource;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["expenses"]["Insert"]>;
      };
      budgets: {
        Row: {
          id: string;
          user_id: string;
          month: string; // always the 1st of the month, e.g. "2026-09-01"
          category: ExpenseCategory;
          limit_amount: number;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          month: string;
          category: ExpenseCategory;
          limit_amount?: number;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["budgets"]["Insert"]>;
      };
      goals: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          target_amount: number;
          saved_amount: number;
          deadline: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          target_amount: number;
          saved_amount?: number;
          deadline: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["goals"]["Insert"]>;
      };
      insights: {
        Row: {
          id: string;
          user_id: string;
          kind: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          kind: string;
          body: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["insights"]["Insert"]>;
      };
      chat_messages: {
        Row: {
          id: string;
          user_id: string;
          role: ChatRole;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role: ChatRole;
          content: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["chat_messages"]["Insert"]>;
      };
    };
    Functions: {
      seed_demo_data: {
        Args: Record<string, never>;
        Returns: {
          expenses_inserted: number;
          budgets_upserted: number;
          goals_inserted: number;
          seeded_for: string;
        };
      };
    };
  };
}
