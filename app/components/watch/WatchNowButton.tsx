'use client';

import { useTranslations } from "next-intl";

type Props = {
  url?: string;
  disabledText?: string;
};

export default function WatchNowButton({ url, disabledText }: Props) {
  const t = useTranslations("watch");
  const enabled = Boolean(url);
  return (
    <a
      href={enabled ? url : undefined}
      target={enabled ? '_blank' : undefined}
      rel={enabled ? 'noopener noreferrer' : undefined}
      aria-disabled={!enabled}
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition
        ${enabled ? 'bg-cyan-500 hover:bg-cyan-400 text-black' : 'bg-neutral-700 text-neutral-400 cursor-not-allowed'}
      `}
    >
      {enabled ? t('watchNow') : disabledText ?? t('unavailable')}
    </a>
  );
}
