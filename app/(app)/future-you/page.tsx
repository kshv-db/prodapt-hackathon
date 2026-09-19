"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QuickAdd from "@/components/QuickAdd";
import { api } from "@/lib/client/api";
import { formatCompactINR, formatINR } from "@/lib/client/format";
import { calculateProjection, finalBalance, MAX_MONTHLY_SAVING } from "@/lib/finance/projection";

const YEARS = 5;

interface FutureResponse {
  currentMonthlySaving: number;
  narrative: string;
  assumedAnnualReturn: number;
}

export default function FutureYou() {
  const [saving, setSaving] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const ask = async (monthlySaving: number) => {
    setBusy(true);
    try {
      const r = await api<FutureResponse>("/api/future", { method: "POST", body: { monthlySaving, years: YEARS } });
      setCurrent(r.currentMonthlySaving);
      setNarrative(r.narrative);
      setError(null);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  // First load: start the slider at the user's real average savings (returned by the API).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    ask(0).then((r) => {
      if (!r) return;
      const start = Math.min(MAX_MONTHLY_SAVING, Math.round(r.currentMonthlySaving / 500) * 500);
      setSaving(start);
      if (start !== 0) ask(start);
    });
  }, []);

  // Live chart math runs client-side with the same pure function as the server (no request per tick).
  const chosen = useMemo(() => (saving === null ? 0 : finalBalance(calculateProjection({ monthlySaving: saving, years: YEARS }))), [saving]);
  const currentEnd = useMemo(() => finalBalance(calculateProjection({ monthlySaving: current, years: YEARS })), [current]);
  const value = saving ?? 0;

  return (
    <main className="max-w-[1240px] px-4 sm:px-8 lg:px-12 py-8">
      <div className="mb-8 max-w-lg">
        <QuickAdd onSaved={() => undefined} />
      </div>
      <header className="mb-7">
        <h2 className="text-[28px] font-bold text-brand-navy tracking-tight leading-tight">Future You</h2>
        <p className="text-[14px] text-brand-slate mt-1 font-normal">See how today&apos;s choices shape tomorrow.</p>
      </header>

      <section className="bg-white rounded-[20px] p-6 lg:p-7 border border-brand-border shadow-soft mb-7">
        <span className="text-[14px] font-medium text-brand-slate tracking-normal block">Adjust monthly savings</span>
        <div className="text-[34px] lg:text-[38px] font-bold text-brand-navy my-2 tracking-tight">{formatINR(value)}</div>
        <div className="pt-2">
          <input
            aria-label="Monthly savings slider"
            className="w-full h-2 rounded-full cursor-pointer z-10"
            type="range"
            min={0}
            max={MAX_MONTHLY_SAVING}
            step={500}
            value={value}
            disabled={saving === null}
            onChange={(e) => setSaving(Number(e.target.value))}
            onPointerUp={() => saving !== null && ask(saving)}
            onKeyUp={() => saving !== null && ask(saving)}
          />
          <div className="flex justify-between items-center text-[13px] font-semibold text-brand-slate/80 mt-2 px-1">
            <span>₹0</span>
            <span>{formatINR(MAX_MONTHLY_SAVING)}</span>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-7">
        {[
          { title: "Current Path", amount: currentEnd, green: false },
          { title: "Your Path", amount: chosen, green: true },
        ].map((c) => (
          <article key={c.title} className="relative rounded-[22px] overflow-hidden border border-brand-border shadow-soft bg-white min-h-[350px] flex flex-col justify-between">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={`${c.title} diorama city`} className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none" src="/stitch/city.jpg" />
            <div className="relative z-10 m-5 p-4 rounded-2xl bg-white/95 backdrop-blur-sm shadow-sm border border-brand-border/60 max-w-[200px]">
              <h3 className={`text-[16px] font-bold ${c.green ? "text-brand-emerald" : "text-brand-navy"}`}>{c.title}</h3>
              <p className="text-[12px] text-brand-slate mb-2">In {YEARS} years</p>
              <div className="text-[30px] font-extrabold text-brand-navy leading-none tracking-tight">{formatCompactINR(c.amount)}</div>
              <p className="text-[12px] text-brand-slate mt-1">savings</p>
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-[20px] bg-brand-softLavender border border-brand-violet/10 px-6 py-5 flex items-center gap-4">
        <div className="w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-amber-500 text-[22px]">wb_sunny</span>
        </div>
        <p className="text-[15px] text-brand-navy leading-snug">
          {error ?? (busy && !narrative ? "Writing your future-self message..." : narrative)}
        </p>
      </section>
      <p className="text-[12px] text-brand-slate mt-3">Projection assumes a 7% annual return. It is an assumption, not a promise.</p>
    </main>
  );
}
