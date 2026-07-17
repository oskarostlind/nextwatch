"use client";

// Avatar med initial-fallback. SVG:erna är lokala statiska filer i
// public/avatars/ — vanlig <img> med flit: next/image-optimeraren vägrar SVG
// utan dangerouslyAllowSVG, och det finns inget att optimera i en 1 kB-vektor.

import { avatarUrl } from "@/lib/avatars";

export default function Avatar({
  avatarId,
  name,
  size = 40,
  className = "",
}: {
  avatarId?: string | null;
  name?: string | null;
  /** Kvadratens sida i px. */
  size?: number;
  className?: string;
}) {
  const url = avatarUrl(avatarId);
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-xl ${className}`}
        draggable={false}
      />
    );
  }

  const initial = (name ?? "").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className={`flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 font-bold text-white/70 ${className}`}
    >
      {initial}
    </div>
  );
}
