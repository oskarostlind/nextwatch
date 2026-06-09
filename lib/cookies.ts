/** Ren cookie-helper utan next/server-imports (undviker Turbopack-exportproblem). */

export function sessionCookieOpts(maxAge: number, httpOnly = true) {
  const secure = process.env.NODE_ENV === "production";
  return { httpOnly, sameSite: "lax" as const, secure, path: "/", maxAge };
}
