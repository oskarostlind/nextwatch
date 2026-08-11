"use client";

// Delad UI-kit i onboarding-språket (cyan primär + emerald/rose för smak).
// Målet: en enhetlig, enkel look över hela appen. Alla sidor bör använda
// dessa primitiver istället för egna ad-hoc-klasser.

import * as React from "react";
import { motion } from "framer-motion";

export function cx(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

/** Delad input/select-stil (matchar onboarding: mörk bg + cyan focus-ring). */
export const fieldClass =
  "w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-white outline-none transition placeholder:text-neutral-500 focus:ring-2 focus:ring-cyan-500/40";

/** Datumfält — WebKit date inputs behöver explicit begränsning på iOS. */
export const dateFieldClass =
  "nw-date block w-full min-w-0 max-w-full appearance-none box-border rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-white outline-none transition placeholder:text-neutral-500 focus:ring-2 focus:ring-cyan-500/40 [color-scheme:dark]";

/** Sidhuvud: liten cyan versal-etikett + titel + undertitel, med valfri höger-slot. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  right,
  center = false,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  center?: boolean;
}) {
  return (
    <div className={cx("mb-6 flex gap-3", right ? "items-start justify-between" : center && "flex-col items-center text-center")}>
      <div className={cx(center && !right && "text-center")}>
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-widest text-cyan-400/80">{eyebrow}</p>
        )}
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** Kort-container (matchar onboarding). */
export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cx("rounded-2xl border border-white/10 bg-neutral-900/60 p-5 shadow-xl backdrop-blur", className)}>
      {children}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-cyan-500 text-black hover:bg-cyan-400 disabled:hover:bg-cyan-500",
  secondary: "border border-white/10 bg-white/5 text-white hover:bg-white/10",
  ghost: "text-neutral-300 hover:text-white",
  danger: "border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15",
};

export function Button({
  variant = "primary",
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
        BUTTON_VARIANTS[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

type ChipTone = "default" | "like" | "dislike";

/** Rundad chip för genrer m.m. tone styr markerad färg (neutral/emerald/rose). */
export function Chip({
  selected,
  tone = "default",
  children,
  onClick,
  className,
}: {
  selected?: boolean;
  tone?: ChipTone;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const on =
    tone === "like"
      ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
      : tone === "dislike"
      ? "border-rose-400 bg-rose-400/10 text-rose-300"
      : "border-cyan-400 bg-cyan-400/10 text-cyan-300";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "relative rounded-full border px-3 py-1.5 text-sm transition after:absolute after:-inset-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40",
        selected ? on : "border-white/10 bg-white/5 text-neutral-200 hover:bg-white/10",
        className
      )}
    >
      {children}
    </button>
  );
}

/** Segmenterad pill-flikrad (vit aktiv pill, animerad). */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  layoutId = "segmented-tabs",
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  layoutId?: string;
}) {
  return (
    <div className="flex w-full items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className="relative flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
        >
          {value === t.id && (
            <motion.div
              layoutId={layoutId}
              className="absolute inset-0 rounded-full bg-white"
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            />
          )}
          <span className={cx("relative z-10", value === t.id ? "text-black" : "text-white/60 hover:text-white")}>
            {t.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Diskret info/feedback-rad. */
export function Note({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: React.ReactNode }) {
  const cls =
    tone === "error"
      ? "border-rose-500/20 bg-rose-500/10 text-rose-300"
      : tone === "success"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : "border-white/10 bg-white/5 text-neutral-300";
  return <div className={cx("rounded-lg border px-3 py-2 text-sm", cls)}>{children}</div>;
}
