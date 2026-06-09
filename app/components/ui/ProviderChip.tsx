// app/components/ui/ProviderChip.tsx
"use client";

import Image from "next/image";
import React from "react";
import { providerLogoUrl } from "@/lib/providerLogos";

export function ProviderChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const src = providerLogoUrl(label);

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-2.5 rounded-xl border px-3 py-2 transition",
        selected
          ? "border-cyan-400 bg-cyan-400/10 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10",
      ].join(" ")}
    >
      {src ? (
        <span className="relative inline-flex h-7 w-7 shrink-0 overflow-hidden rounded-md">
          <Image
            src={src}
            alt=""
            width={28}
            height={28}
            className="h-full w-full object-cover"
            unoptimized
          />
        </span>
      ) : (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/20 text-xs font-bold">
          {label.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
