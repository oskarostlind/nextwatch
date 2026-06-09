import RegisterClient from "./page_client";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <main className="mx-auto max-w-lg p-6">
      <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-6 backdrop-blur">
        <h1 className="mb-1 text-2xl font-semibold">Spara ditt konto</h1>
        <p className="mb-6 text-sm text-neutral-400">Valfritt — du kan använda appen utan att registrera dig.</p>
        <RegisterClient />
      </div>
    </main>
  );
}
