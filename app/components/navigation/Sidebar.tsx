// app/components/navigation/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "../lib/nav";

export default function Sidebar() {
  const pathname = usePathname();

  return (
    // Behåller strukturen
    <aside className="flex h-dvh w-64 flex-col border-r border-neutral-800 bg-neutral-900/60 backdrop-blur">
      <div className="px-6 py-8 text-2xl font-black tracking-tight text-white">
        NextWatch
      </div>
      <nav className="flex-1 space-y-2 px-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            (item.activeStartsWith !== "/" && pathname.startsWith(item.activeStartsWith));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "flex items-center gap-4 rounded-xl px-4 py-3 text-sm font-medium transition-colors",
                active
                  ? "bg-white text-neutral-900"
                  : "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200",
              ].join(" ")}
            >
              <Icon className="h-5 w-5" />
              <span className="text-base">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="px-6 py-4 text-xs font-medium text-neutral-600">
        © 2026 NextWatch
      </div>
    </aside>
  );
}