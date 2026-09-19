"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import QuickAdd from "@/components/QuickAdd";
import { api, ApiError, localToday } from "@/lib/client/api";
import { BAR_COLOR, formatINR, shortDate, styleFor } from "@/lib/client/format";

interface Usage { category: string; limit: number; spent: number; percent: number; status: string }
interface Summary { total: number; income: number; budgetUsage: Usage[]; healthScore: number; healthReason: string; insight: { body: string } | null }
interface Expense { id: string; amount: number; category: string; merchant: string; spent_on: string }
interface Goal { id: string; title: string; target_amount: number; saved_amount: number; deadline: string }
interface Profile { name: string }

// Chip anchor positions taken from the Stitch hero panel.
const CHIP_POS = [
  "top-[48%] left-[8%] sm:left-[11%]",
  "top-[22%] left-[28%] sm:left-[30%]",
  "top-[18%] right-[32%] sm:right-[34%]",
  "bottom-[20%] left-[32%] sm:left-[36%]",
  "bottom-[20%] left-[8%] sm:left-[11%]",
  "top-[40%] right-[12%] sm:right-[15%]",
];

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const month = localToday().slice(0, 7);
    try {
      const [s, e, g, p] = await Promise.all([
        api<Summary>(`/api/summary?month=${month}`),
        api<{ expenses: Expense[] }>(`/api/expenses?month=${month}`),
        api<{ goals: Goal[] }>("/api/goals"),
        api<{ profile: Profile | null }>("/api/profile"),
      ]);
      setSummary(s);
      setExpenses(e.expenses);
      setGoals(g.goals);
      setProfile(p.profile);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your data");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  const loadDemo = async () => {
    setSeeding(true);
    try {
      // The canonical seed needs a profile. Onboarding screen is not built yet, so create one with the
      // demo persona's income (45,000) only if none exists.
      if (!profile) await api("/api/profile", { method: "PUT", body: { name: "Meera", income: 45000 } });
      await api("/api/demo/seed", { method: "POST" });
      await api("/api/insights/refresh", { method: "POST" }).catch(() => undefined);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  const name = profile?.name || "there";
  const usage = summary?.budgetUsage ?? [];
  const empty = loaded && !error && (!profile || (expenses.length === 0 && usage.length === 0 && goals.length === 0));

  return (
    <main className="max-w-[1100px] mx-auto p-4 sm:p-8 flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold text-brand-navy tracking-tight leading-tight flex items-center gap-2">Good morning, {name}! ☀️</h1>
          <p className="text-[14px] text-brand-muted mt-0.5">Every rupee builds a brighter you.</p>
        </div>
        <div className="flex items-center gap-3">
          {summary && (
            <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 bg-white border border-brand-border rounded-full text-brand-navInactive text-[12px] font-medium shadow-sm">
              <span className="w-2 h-2 rounded-full bg-brand-emerald animate-pulse" />
              <span>
                City Flourishing: <strong className="text-brand-navy font-semibold">{summary.healthScore}%</strong>
              </span>
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="Avatar" className="w-10 h-10 rounded-full object-cover ring-2 ring-brand-border" src="/stitch/avatar.jpg" />
        </div>
      </div>

      <QuickAdd onSaved={load} />

      {error && <p className="text-[13px] text-brand-coral">{error}</p>}
      {empty && (
        <div className="bg-white rounded-[20px] border border-brand-border p-5 shadow-card flex items-center justify-between gap-4">
          <p className="text-[13px] text-brand-navInactive">No data yet. Load demo data to see MoneyCity with 3 months of transactions, a budget and goals.</p>
          <button type="button" onClick={loadDemo} disabled={seeding} className="h-9 px-4 bg-brand-violet text-white rounded-full text-[12px] font-semibold hover:opacity-90 shrink-0">
            {seeding ? "Loading..." : "Load demo data"}
          </button>
        </div>
      )}

      <section className="relative w-full h-[400px] rounded-[24px] bg-white border border-brand-border shadow-card overflow-hidden select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="MoneyCity 3D Isometric Pastel Map" className="w-full h-full object-cover object-center" src="/stitch/city.jpg" />
        <div className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3.5 py-1.5 bg-white/95 backdrop-blur-md border border-brand-border rounded-full shadow-floating">
          <span className="material-symbols-outlined text-[16px] text-brand-emerald">park</span>
          <span className="text-[12px] font-semibold text-brand-navy">Better Choices, Brighter Tomorrows</span>
        </div>
        {usage.slice(0, CHIP_POS.length).map((u, i) => {
          const dot = styleFor(u.category).dot;
          return (
            <div key={u.category} className={`absolute ${CHIP_POS[i]} z-20`}>
              <div className="flex items-center gap-1.5 px-3 py-1 bg-white/95 backdrop-blur-md rounded-full border border-brand-border shadow-floating hover:scale-105 transition-transform cursor-pointer">
                <span className={`w-2.5 h-2.5 rounded-full ${dot} shrink-0`} />
                <span className="text-[12px] font-bold text-brand-navy">{u.category.split(" ")[0]}</span>
                <span className="text-[12px] font-semibold text-brand-navy">{formatINR(u.spent)}</span>
                <span className="text-[11px] text-brand-muted">/ {formatINR(u.limit)}</span>
              </div>
            </div>
          );
        })}
        {summary && (
          <div className="absolute top-[55%] left-[50%] -translate-x-1/2 z-20">
            <div className="flex items-center gap-1.5 px-3 py-1 bg-white/95 backdrop-blur-md rounded-full border border-brand-border shadow-floating hover:scale-105 transition-transform cursor-pointer">
              <span className="material-symbols-outlined text-[15px] text-brand-emerald">energy_savings_leaf</span>
              <span className="text-[12px] font-bold text-brand-navy">Left</span>
              <span className="text-[12px] font-semibold text-brand-emerald">{formatINR(Math.max(0, summary.income - summary.total))}</span>
            </div>
          </div>
        )}
        <div className="absolute bottom-4 right-4 z-30 max-w-[270px] bg-white/95 backdrop-blur-md border border-brand-border rounded-[20px] p-4 shadow-floating flex flex-col gap-2.5">
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-full bg-brand-violetLight border border-brand-violet/20 flex items-center justify-center shrink-0 text-brand-violet">
              <span className="material-symbols-outlined text-[22px]">smart_toy</span>
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-bold text-brand-navy">MoneyBot</span>
                <span className="text-[9px] uppercase tracking-wider font-bold text-brand-violet bg-brand-violetLight px-1.5 py-0.5 rounded-full">Advisor</span>
              </div>
              <p className="text-[12px] text-brand-navy leading-snug mt-1 font-medium">{summary?.insight?.body ?? summary?.healthReason ?? "Ask me anything about your money."}</p>
            </div>
          </div>
          <Link href="/ai-advisor" className="w-full h-8 px-3 bg-brand-violet text-white rounded-full text-[12px] font-semibold flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity shadow-sm">
            <span>Ask MoneyBot</span>
            <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
          </Link>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 w-full items-stretch">
        <div className="bg-white rounded-[20px] border border-brand-border p-5 shadow-card flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-brand-border/60 mb-2">
              <h2 className="text-[16px] font-bold text-brand-navy flex items-center gap-2">
                <span className="material-symbols-outlined text-brand-violet text-[18px]">receipt_long</span>
                Recent Transactions
              </h2>
            </div>
            <div className="flex flex-col divide-y divide-brand-border/40">
              {expenses.slice(0, 4).map((e) => {
                const st = styleFor(e.category);
                return (
                  <div key={e.id} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-xl ${st.bg} ${st.fg} flex items-center justify-center shrink-0`}>
                        <span className="material-symbols-outlined text-[18px]">{st.icon}</span>
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[13px] font-semibold text-brand-navy truncate">{e.merchant || e.category}</span>
                        <span className="text-[11px] text-brand-muted truncate">
                          {shortDate(e.spent_on)} · {e.category}
                        </span>
                      </div>
                    </div>
                    <span className="text-[13px] font-bold text-brand-coral shrink-0 pl-2">- {formatINR(e.amount)}</span>
                  </div>
                );
              })}
              {loaded && expenses.length === 0 && <p className="text-[12px] text-brand-muted py-3">No transactions this month.</p>}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-[20px] border border-brand-border p-5 shadow-card flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-brand-border/60 mb-2">
              <h2 className="text-[16px] font-bold text-brand-navy flex items-center gap-2">
                <span className="material-symbols-outlined text-brand-violet text-[18px]">pie_chart</span>
                Budget Overview
              </h2>
            </div>
            <div className="flex flex-col gap-3 pt-1">
              {usage.slice(0, 4).map((u) => {
                const st = styleFor(u.category);
                return (
                  <div key={u.category} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-medium text-brand-navy flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                        {u.category}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-brand-muted text-[11px]">
                          {formatINR(u.spent)} / {formatINR(u.limit)}
                        </span>
                        <span className={`font-bold ${st.fg} text-[12px]`}>{Math.round(u.percent)}%</span>
                      </div>
                    </div>
                    <div className="w-full h-2 rounded-full bg-brand-track overflow-hidden">
                      <div className={`h-full rounded-full ${BAR_COLOR[st.fg] ?? "bg-brand-violet"} transition-all duration-500`} style={{ width: `${Math.min(100, u.percent)}%` }} />
                    </div>
                  </div>
                );
              })}
              {loaded && usage.length === 0 && <p className="text-[12px] text-brand-muted">No budget set for this month.</p>}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-[20px] border border-brand-border p-5 shadow-card flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-brand-border/60 mb-2">
              <h2 className="text-[16px] font-bold text-brand-navy flex items-center gap-2">
                <span className="material-symbols-outlined text-brand-violet text-[18px]">flag</span>
                Savings Goals
              </h2>
            </div>
            <div className="flex flex-col gap-3 pt-1">
              {goals.slice(0, 2).map((g, i) => {
                const pct = Math.min(100, Math.round((g.saved_amount / g.target_amount) * 100));
                const green = i % 2 === 0;
                return (
                  <div key={g.id} className="p-3 bg-brand-cream/70 rounded-xl border border-brand-border/60 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-lg ${green ? "bg-brand-mintBg text-brand-emerald" : "bg-brand-violetLight text-brand-violet"} flex items-center justify-center shrink-0`}>
                          <span className="material-symbols-outlined text-[18px]">{green ? "laptop_mac" : "beach_access"}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[13px] font-bold text-brand-navy">{g.title}</span>
                          <span className="text-[11px] text-brand-muted">Target: {shortDate(g.deadline)}</span>
                        </div>
                      </div>
                      <span className={`text-[13px] font-bold ${green ? "text-brand-emerald" : "text-brand-violet"}`}>{pct}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-brand-track overflow-hidden">
                      <div className={`h-full rounded-full ${green ? "bg-brand-emerald" : "bg-brand-violet"} transition-all duration-500`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-brand-muted">
                      <span>
                        Saved: <strong className="text-brand-navy font-semibold">{formatINR(g.saved_amount)}</strong>
                      </span>
                      <span>Goal: {formatINR(g.target_amount)}</span>
                    </div>
                  </div>
                );
              })}
              {loaded && goals.length === 0 && <p className="text-[12px] text-brand-muted">No goals yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
