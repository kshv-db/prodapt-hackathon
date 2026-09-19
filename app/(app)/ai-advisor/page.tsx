"use client";

import { useEffect, useRef, useState } from "react";
import QuickAdd from "@/components/QuickAdd";
import { api, streamText } from "@/lib/client/api";

interface Msg { role: "user" | "assistant"; content: string }

const PROMPTS = ["Where can I save?", "Summarize this month", "When can I afford a bike?", "Am I on track?"];
const PERSONAS = ["friendly", "roast", "coach"] as const;

/**
 * MoneyBot chat, styled after the Stitch AI Advisor page. Uses the existing streamed POST /api/chat.
 * (The /api/agent/* SSE endpoints and streamAgent() from feature/ai are not on this branch yet.)
 */
export default function AiAdvisor() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("there");
  const [persona, setPersona] = useState<(typeof PERSONAS)[number]>("friendly");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ messages: Msg[] }>("/api/chat").then((r) => setMessages(r.messages)).catch(() => undefined);
    api<{ profile: { name: string; persona: (typeof PERSONAS)[number] } | null }>("/api/profile")
      .then((r) => {
        if (r.profile?.name) setName(r.profile.name);
        if (r.profile?.persona) setPersona(r.profile.persona);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages]);

  const send = async (message: string) => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    setMessages((m) => [...m, { role: "user", content: message }, { role: "assistant", content: "" }]);
    try {
      await streamText("/api/chat", { message }, (chunk) =>
        setMessages((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, content: x.content + chunk } : x))),
      );
    } catch (e) {
      setError((e as Error).message);
      setMessages((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
    }
  };

  const changePersona = async (p: (typeof PERSONAS)[number]) => {
    setPersona(p);
    await api("/api/profile", { method: "PUT", body: { persona: p } }).catch((e) => setError((e as Error).message));
  };

  return (
    <main className="px-4 sm:px-8 py-8 max-w-[1240px] flex flex-col min-h-screen">
      <div className="mb-6 max-w-lg">
        <QuickAdd onSaved={() => undefined} />
      </div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-[28px] font-bold text-brand-navy tracking-tight leading-tight">MoneyBot</h2>
          <p className="text-[14px] text-brand-muted">Your personal financial companion</p>
        </div>
        <select
          value={persona}
          onChange={(e) => changePersona(e.target.value as (typeof PERSONAS)[number])}
          className="h-9 rounded-full bg-white border border-brand-border shadow-subtle px-4 text-[13px] font-semibold text-brand-navy capitalize focus:outline-none"
        >
          {PERSONAS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <section className="bg-white rounded-[24px] border border-brand-border shadow-card p-4 sm:p-8 flex-1 flex flex-col gap-5 min-h-[520px]">
        <div className="flex-1 flex flex-col gap-5 overflow-y-auto">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-[#E4EEFC] flex items-center justify-center shrink-0 text-brand-violet">
              <span className="material-symbols-outlined text-[20px]">smart_toy</span>
            </div>
            <div className="bg-brand-botBubble rounded-2xl px-5 py-3 text-[15px] text-brand-navy">👋 Hey {name}! How can I help you today?</div>
          </div>
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2 pl-12">
              {PROMPTS.map((p) => (
                <button key={p} type="button" onClick={() => send(p)} className="px-4 py-2 rounded-full bg-brand-violetLight border border-brand-violetBorder text-brand-violet text-[13px] font-semibold hover:opacity-90">
                  {p}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="self-end max-w-[80%] bg-brand-userBubble rounded-2xl px-5 py-3 text-[15px] text-brand-navy">
                {m.content}
              </div>
            ) : (
              <div key={i} className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-[#E4EEFC] flex items-center justify-center shrink-0 text-brand-violet">
                  <span className="material-symbols-outlined text-[20px]">smart_toy</span>
                </div>
                <div className="max-w-[80%] bg-white border border-brand-border shadow-subtle rounded-2xl px-5 py-4 text-[15px] text-brand-navy whitespace-pre-wrap">
                  {m.content || (busy ? "..." : "")}
                </div>
              </div>
            ),
          )}
          <div ref={end} />
        </div>
        {error && <p className="text-[13px] text-brand-coral">{error}</p>}
        <div className="w-full bg-white rounded-full border border-brand-border shadow-subtle px-3.5 py-2 flex items-center gap-3">
          <input
            className="flex-1 bg-transparent border-0 outline-none text-brand-navy placeholder:text-brand-muted text-sm px-1 focus:ring-0"
            placeholder="Ask me anything about your finances..."
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(text)}
          />
          <button type="button" aria-label="Send" onClick={() => send(text)} disabled={busy} className="w-9 h-9 rounded-full bg-brand-violet text-white flex items-center justify-center shrink-0 hover:opacity-90">
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </div>
      </section>
    </main>
  );
}
