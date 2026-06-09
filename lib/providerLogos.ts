/** Officiella TMDB-providerlogotyper (region SE). */

const TMDB_IMG = "https://image.tmdb.org/t/p/w92";

const LOGO_PATH: Record<string, string> = {
  netflix: "/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg",
  "disney+": "/97yvRBw1GzX7fXprcF80er19ot.jpg",
  disney: "/97yvRBw1GzX7fXprcF80er19ot.jpg",
  "prime video": "/pvske1MyAoymrs5bguRfVqYiM9a.jpg",
  prime: "/pvske1MyAoymrs5bguRfVqYiM9a.jpg",
  max: "/jbe4gVSfRlbPTdESXhEKpornsfu.jpg",
  viaplay: "/bnoTnLzz2MAhK3Yc6P9KXe5drIz.jpg",
  "apple tv+": "/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg",
  appletv: "/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg",
  skyshowtime: "/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg",
  "svt play": "/oBdaG066fB5O7XYrYKQflOZvd89.jpg",
  svt: "/oBdaG066fB5O7XYrYKQflOZvd89.jpg",
  "tv4 play": "/5lKPs5yrjeKHFrXh9RIvzyJJzSd.jpg",
  tv4: "/5lKPs5yrjeKHFrXh9RIvzyJJzSd.jpg",
};

function keyify(label: string) {
  return label.toLowerCase().replace(/\s+/g, " ").trim();
}

export function providerLogoUrl(label: string): string | null {
  const path = LOGO_PATH[keyify(label)];
  return path ? `${TMDB_IMG}${path}` : null;
}
