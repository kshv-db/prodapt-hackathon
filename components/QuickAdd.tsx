"use client";

import { useState } from "react";
import { CATEGORIES } from "@/lib/finance/categories";
import { api, localToday } from "@/lib/client/api";

interface Parsed {
  amount: number;
  category: string;
  merchant: string;
  spent_on: string;
  confidence: number;
  needs_clarification?: string;
  spent_at?: string;
}

/**
 * Quick-add pill from the Stitch design. Text -> POST /api/expenses/parse -> editable confirmation row
 * -> POST /api/expenses (source "nl"). The confirmation row is the smallest UI addition the PRD requires (F1).
 */
export default function QuickAdd({ onSaved }: { onSaved: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api<Parsed>("/api/expenses/parse", { method: "POST", body: { text, today: localToday() } });
      setParsed(p);
      if (p.needs_clarification) setError(p.needs_clarification);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!parsed || parsed.amount <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/expenses", {
        method: "POST",
        body: {
          amount: parsed.amount,
          category: parsed.category,
          merchant: parsed.merchant,
          spent_on: parsed.spent_on,
          spent_at: parsed.spent_at,
          source: "nl",
        },
      });
      setParsed(null);
      setText("");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = "h-8 rounded-lg border border-brand-border bg-white px-2 text-[12px] text-brand-navy focus:outline-none focus:border-brand-violet";

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="w-full bg-white rounded-full border border-brand-border shadow-search px-3.5 py-2 flex items-center justify-between gap-3">
        <div className="w-8 h-8 rounded-full bg-brand-violetLight text-brand-violet flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[20px] font-bold">add</span>
        </div>
        <input
          className="flex-1 bg-transparent border-0 outline-none text-brand-navy placeholder:text-[#8A91A3] text-sm px-1 focus:ring-0"
          placeholder="Add an expense... (e.g. coffee 120, Zomato 450)"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button
          aria-label="Submit expense"
          className="w-8 h-8 rounded-full bg-brand-violet text-white flex items-center justify-center shrink-0 hover:opacity-90 transition-opacity shadow-sm"
          type="button"
          onClick={submit}
          disabled={busy}
        >
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>
      </div>

      {(parsed || error) && (
        <div className="bg-white rounded-2xl border border-brand-border shadow-card px-4 py-3 flex flex-col gap-2">
          {parsed && (
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${field} w-24`} type="number" min={0} value={parsed.amount || ""} placeholder="Amount" onChange={(e) => setParsed({ ...parsed, amount: Number(e.target.value) })} />
              <select className={field} value={parsed.category} onChange={(e) => setParsed({ ...parsed, category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input className={`${field} w-32`} value={parsed.merchant} placeholder="Merchant" onChange={(e) => setParsed({ ...parsed, merchant: e.target.value })} />
              <input className={field} type="date" value={parsed.spent_on} onChange={(e) => setParsed({ ...parsed, spent_on: e.target.value })} />
              <button className="h-8 px-4 bg-brand-violet text-white rounded-full text-[12px] font-semibold hover:opacity-90" type="button" onClick={save} disabled={busy || parsed.amount <= 0}>
                Save
              </button>
              <button className="h-8 px-3 text-[12px] font-semibold text-brand-muted hover:text-brand-navy" type="button" onClick={() => { setParsed(null); setError(null); }}>
                Cancel
              </button>
            </div>
          )}
          {error && <p className="text-[12px] text-brand-coral">{error}</p>}
        </div>
      )}
    </div>
  );
}
