"use client";

// Förvärmer posters för kort längre fram i kortleken. Bara topp + 2 kort
// renderas, så kort 4+ började tidigare ladda sin bild först när de klev in i
// stacken — synlig pop-in efter varje swipe på långsammare nät.
//
// Viktigt: next/image hämtar via /_next/image-optimeraren, så det räcker INTE
// att värma den råa TMDB-URL:en — det är en annan resurs. getImageProps ger
// exakt samma src/srcSet som <Image> kommer begära, förutsatt samma `sizes`,
// och <link rel="preload"> låter browsern välja samma variant ur srcset.

import { getImageProps } from "next/image";

/** Hur många kommande kort som förvärms. Topp + 2 syns redan; 3..N+2 värms. */
const PRELOAD_AHEAD = 5;

export default function DeckPosterPreload({
  posters,
  sizes,
  ahead = PRELOAD_AHEAD,
}: {
  /** Poster-URL:er i deck-ordning, EXKLUSIVE de kort som redan renderas. */
  posters: (string | null | undefined)[];
  /** Måste matcha `sizes` på kortens <Image> — annars värms fel variant. */
  sizes: string;
  ahead?: number;
}) {
  const urls = posters.filter((p): p is string => Boolean(p)).slice(0, ahead);
  return (
    <>
      {urls.map((src) => {
        const { props } = getImageProps({ alt: "", src, fill: true, sizes });
        return (
          <link
            key={src}
            rel="preload"
            as="image"
            // Med srcset väljer browsern variant själv; href är bara fallback.
            href={props.src}
            imageSrcSet={props.srcSet}
            imageSizes={props.sizes}
          />
        );
      })}
    </>
  );
}
