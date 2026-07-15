"use client";

// Trailerspelare i appen. TMDB hostar inga videofiler — bara YouTube-referenser —
// så en egen mediaspelare är inte möjlig. Vi bäddar in YouTube i stället för att
// länka ut, så användaren aldrig lämnar appen.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { youtubeEmbedUrl, type Trailer } from "@/lib/tmdbVideos";

type Props = {
  open: boolean;
  trailer: Trailer | null | undefined;
  title: string;
  onClose: () => void;
};

export default function TrailerModal({ open, trailer, title, onClose }: Props) {
  // Esc stänger — modalen täcker skärmen och har ingen annan väg ut på desktop.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && trailer ? (
        <motion.div
          key="trailer"
          role="dialog"
          aria-modal
          aria-label={`Trailer: ${title}`}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            className="relative w-full max-w-2xl"
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="min-w-0 truncate text-sm font-medium text-white/85">{title}</div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Stäng trailer"
                className="shrink-0 rounded-full bg-white/10 p-2 text-white/70 transition hover:bg-white/20 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-2xl">
              <iframe
                src={youtubeEmbedUrl(trailer.key)}
                title={`Trailer: ${title}`}
                className="absolute inset-0 h-full w-full"
                // allow="autoplay" krävs för att autoplay=1 ska respekteras;
                // fullscreen låter användaren maximera på liggande mobil.
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
