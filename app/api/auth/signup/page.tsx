"use client";

import { useState } from "react";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const res = await fetch("/api/auth/request-verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name }),
    });
    const data = await res.json().catch(() => null);
    if (data?.ok) setSent(true);
    else setError(data?.message || data?.error || "Något gick fel.");
  };

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Skapa konto</h1>

      {sent ? (
        <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-neutral-200">
          Kolla din inbox — vi skickade ett aktiveringsmail.
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <div className="mb-1 text-sm text-neutral-300">Namn</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none"
              placeholder="För- och efternamn"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-sm text-neutral-300">E-post</div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none"
              placeholder="namn@example.se"
            />
          </label>
          {error && <div className="text-sm text-red-400">{error}</div>}
          <button
            onClick={submit}
            className="w-full rounded-md bg-white px-3 py-2 font-medium text-neutral-900"
          >
            Skicka aktiveringsmail
          </button>
        </div>
      )}
    </main>
  );
}
