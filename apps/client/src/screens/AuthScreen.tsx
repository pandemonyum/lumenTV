import { ChangeEvent, FormEvent, useState } from "react";
import { api } from "../lib/api";
import { Brand } from "../components/Brand";

export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await api.login(email, password);
      else await api.register(email, password);
      onAuthenticated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Accesso non riuscito");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-screen__glow auth-screen__glow--one" />
      <div className="auth-screen__glow auth-screen__glow--two" />
      <section className="auth-card">
        <Brand />
        <p className="eyebrow">Catalogo personale multipiattaforma</p>
        <h1>{mode === "login" ? "Bentornato" : "Crea il tuo account"}</h1>
        <p className="auth-card__intro">
          Accedi al catalogo, ai preferiti e alla ripresa degli episodi su tutti i tuoi dispositivi.
        </p>
        <form onSubmit={submit}>
          <label>
            Email
            <input
              data-focusable="true"
              type="email"
              value={email}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              data-focusable="true"
              type="password"
              value={password}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button primary-button--wide" data-focusable="true" disabled={busy}>
            {busy ? "Attendi…" : mode === "login" ? "Accedi" : "Registrati"}
          </button>
        </form>
        <button
          className="text-button"
          data-focusable="true"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "Non hai un account? Registrati" : "Hai già un account? Accedi"}
        </button>
      </section>
    </main>
  );
}
