'use client';

import * as React from 'react';
import AppleSignInButton from './AppleSignInButton';

export default function LoginCard() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? 'Kunde inte logga in');
        return;
      }
      window.location.href = '/swipe';
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Nätverksfel';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative z-10 w-full max-w-md mx-auto rounded-2xl border border-white/10 bg-neutral-900/60 backdrop-blur p-6 shadow-xl">
      <h2 className="text-xl font-semibold mb-4">Logga in</h2>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="text-sm text-neutral-300">E-post</label>
          <input
            type="email"
            className="w-full rounded-lg bg-neutral-800/80 border border-white/10 p-2 outline-none focus:ring-2 focus:ring-cyan-500/50"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-sm text-neutral-300">Lösenord</label>
            <a href="/auth/forgot" className="text-xs text-neutral-400 underline hover:text-neutral-200">
              Glömt lösenord?
            </a>
          </div>
          <input
            type="password"
            className="w-full rounded-lg bg-neutral-800/80 border border-white/10 p-2 outline-none focus:ring-2 focus:ring-cyan-500/50"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl py-2 font-medium bg-cyan-500 hover:bg-cyan-400 text-black disabled:opacity-60"
        >
          {loading ? 'Loggar in…' : 'Logga in'}
        </button>
      </form>

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/10" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-neutral-900/60 px-2 text-neutral-500">eller</span>
        </div>
      </div>

      <AppleSignInButton />

      <div className="mt-4 text-sm text-neutral-400">
        Har du inget lösenord? <a className="underline" href="/onboarding">Skapa konto</a>
      </div>
    </div>
  );
}
