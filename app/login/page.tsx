"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/client/supabase";

/** Login / sign-up, styled after the Stitch login card (one form, toggled between the two modes). */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = supabaseBrowser();
    const { data, error: err } =
      mode === "login" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (err) return setError(err.message);
    if (data.session) router.replace("/");
    else setNotice("Check your email to confirm your account, then log in.");
  };

  const input =
    "w-full h-12 rounded-[12px] border border-[#E4E0F5] bg-white px-4 text-sm text-[#1F2A44] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#8577f0]/40 focus:border-[#8577f0] transition-colors";

  return (
    <main className="w-full min-h-screen flex flex-col lg:flex-row">
      <section className="relative hidden lg:flex lg:w-1/2 min-h-screen illustration-panel-bg p-12 flex-col items-center justify-center overflow-hidden select-none">
        <div className="w-full max-w-lg bg-white/80 backdrop-blur-md rounded-3xl border border-white/80 p-8 shadow-2xl flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/stitch/login.jpg" alt="MoneyCity Logo Illustration" className="w-full h-auto max-h-[300px] object-contain rounded-2xl" />
        </div>
        <p className="mt-6 text-sm text-slate-600/90 text-center font-medium max-w-xs leading-relaxed">Every budget category builds a building. Every smart saving shapes your town.</p>
      </section>
      <section className="w-full lg:w-1/2 min-h-screen bg-[#FAF7F2] flex flex-col items-center justify-center p-6 sm:p-8 lg:p-12">
        <div className="w-full max-w-[440px] bg-white rounded-[20px] border border-[#EFEBE4] p-8 sm:p-10 auth-card-shadow">
          <div className="text-center mb-6">
            <h2 className="text-[28px] font-bold text-[#1F2A44] leading-tight tracking-tight">{mode === "login" ? "Welcome back" : "Create your city"}</h2>
            <p className="text-sm text-[#6B7280] mt-1.5">{mode === "login" ? "Log in to check on your city." : "Sign up to start building your brighter tomorrow."}</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-[13px] font-medium text-[#1F2A44] mb-1.5">Email</label>
              <input id="email" type="email" required autoComplete="email" placeholder="you@example.com" className={input} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label htmlFor="password" className="block text-[13px] font-medium text-[#1F2A44] mb-1.5">Password</label>
              <input id="password" type="password" required minLength={6} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="Enter your password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-[13px] text-[#F26D6D]">{error}</p>}
            {notice && <p className="text-[13px] text-[#2E9E70]">{notice}</p>}
            <button type="submit" disabled={busy} className="mt-2 w-full h-12 rounded-full bg-[#8577F0] hover:bg-[#7465E0] text-white font-semibold text-[15px] shadow-[0_4px_14px_rgba(133,119,240,0.35)] transition-all duration-200 active:scale-[0.99] flex items-center justify-center">
              {busy ? "..." : mode === "login" ? "Log in" : "Sign up"}
            </button>
          </form>
          <div className="mt-6 text-center text-sm">
            <span className="text-[#6B7280]">{mode === "login" ? "New to MoneyCity? " : "Already have an account? "}</span>
            <button type="button" className="text-[#8577F0] font-semibold hover:underline" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
              {mode === "login" ? "Sign up" : "Log in"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
