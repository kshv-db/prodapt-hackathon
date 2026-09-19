"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { supabaseBrowser } from "@/lib/client/supabase";

const NAV = [
  { href: "/", label: "Home", icon: "home" },
  { href: "#", label: "Transactions", icon: "receipt_long" },
  { href: "#", label: "Budget", icon: "pie_chart" },
  { href: "#", label: "Goals", icon: "flag" },
  { href: "/future-you", label: "Future You", icon: "trending_up" },
  { href: "/ai-advisor", label: "AI Advisor", icon: "auto_awesome" },
];

/** Sidebar + auth guard, styled exactly like the Stitch dashboard shell. */
export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => {
        if (!data.session) router.replace("/login");
        else setReady(true);
      });
  }, [router]);

  if (!ready) return <div className="min-h-screen bg-brand-cream" />;

  return (
    <div className="flex min-h-screen bg-brand-cream">
      <aside className="fixed left-0 top-0 h-screen w-[220px] bg-white border-r border-brand-border z-50 hidden md:flex flex-col justify-between p-4 select-none">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3 px-1.5 pt-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="MoneyCity Logo" className="w-9 h-9 object-contain" src="/stitch/logo.png" />
            <div className="flex flex-col min-w-0 leading-tight">
              <span className="font-bold text-[18px] text-brand-navy tracking-tight truncate">MoneyCity</span>
              <span className="text-[10px] text-brand-muted truncate mt-0.5">Small choices. A brighter tomorrow.</span>
            </div>
          </div>
          <nav className="flex flex-col gap-1.5 pt-1">
            {NAV.map((n) => {
              const active = n.href === path;
              return (
                <Link
                  key={n.label}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "flex items-center gap-3 h-10 px-3.5 rounded-xl transition-all bg-brand-mintBg text-brand-emerald font-semibold"
                      : "flex items-center gap-3 h-10 px-3.5 rounded-xl text-brand-navInactive hover:bg-[#F7F5F0] hover:text-brand-navy transition-all font-medium"
                  }
                >
                  <span className="material-symbols-outlined text-[20px]">{n.icon}</span>
                  <span className="text-[14px]">{n.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="p-3.5 bg-[#F5FAF7] rounded-2xl border border-[#E1F0E8] flex items-start gap-2.5">
          <div className="w-6 h-6 rounded-full bg-brand-mintBg flex items-center justify-center shrink-0 mt-0.5">
            <span className="material-symbols-outlined text-brand-emerald text-[16px]">potted_plant</span>
          </div>
          <p className="text-[11px] text-brand-navInactive leading-snug">Good money habits grow brighter tomorrows.</p>
        </div>
      </aside>
      <div className="md:pl-[220px] w-full min-h-screen bg-brand-cream pb-20 md:pb-0">{children}</div>
      {/* Mobile: bottom navigation bar (design: sidebar becomes a fixed bottom bar under 768px) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-brand-border flex justify-around py-2">
        {NAV.map((n) => {
          const active = n.href === path;
          return (
            <Link key={n.label} href={n.href} className={`flex flex-col items-center gap-0.5 px-2 ${active ? "text-brand-emerald" : "text-brand-navInactive"}`}>
              <span className="material-symbols-outlined text-[22px]">{n.icon}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
