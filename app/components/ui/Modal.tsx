'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
};

export default function Modal({ open, onClose, children, labelledBy }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Elementet som hade fokus innan modalen öppnades — fokus ska tillbaka dit.
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    // Lås bakgrundsscroll medan modalen är öppen (iOS scrollar annars sidan bakom).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = prevOverflow;
      lastFocusedRef.current?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div key="modal" className="fixed inset-0 z-[1000] flex items-center justify-center p-3">
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className="relative max-h-[85vh] w-[min(900px,94vw)] overflow-auto overscroll-contain rounded-2xl border border-white/10 bg-neutral-900 p-4 shadow-xl outline-none"
            initial={{ scale: 0.94, y: 8, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            {/* after:-inset-1.5 ger 44pt effektiv träffyta utan synlig förändring.
                Knappen är redan absolut positionerad, så ingen `relative` behövs
                (och den skulle dessutom flytta knappen). */}
            <button
              type="button"
              aria-label="Stäng"
              onClick={onClose}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-neutral-400 transition after:absolute after:-inset-1.5 hover:bg-white/10 hover:text-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
