// app/components/ui/PosterImage.tsx
"use client";

// Tunn wrapper kring next/image för postrar: bilden tonar in när den laddats
// klart i stället för att poppa fram. Bara opacity animeras (GPU-komposit),
// så det kostar inget på iPhone. Kortets egen bakgrund fungerar som placeholder.
//
// Klassen tas bort direkt på DOM-noden i onLoad i stället för via state —
// annars skulle varje laddad poster trigga en re-render av hela gridet.

import Image, { type ImageProps } from "next/image";

export default function PosterImage({ alt, className, onLoad, onError, ...rest }: ImageProps) {
  return (
    <Image
      {...rest}
      alt={alt}
      className={[className, "opacity-0 transition-opacity duration-300"].filter(Boolean).join(" ")}
      onLoad={(e) => {
        e.currentTarget.classList.remove("opacity-0");
        onLoad?.(e);
      }}
      onError={(e) => {
        // Trasig poster-URL (TMDB tar bort bilder) ger aldrig onLoad. Utan det
        // här blev rutan permanent osynlig i stället för att visa alt-texten.
        e.currentTarget.classList.remove("opacity-0");
        onError?.(e);
      }}
    />
  );
}
