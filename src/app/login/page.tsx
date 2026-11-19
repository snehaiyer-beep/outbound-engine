"use client";
import { useState } from "react";

export default function Login() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.ok) window.location.href = "/";
    else setError("That token is not valid.");
  }
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="card p-6 w-full max-w-sm space-y-3">
        <h1 className="text-lg font-semibold">Outbound Engine</h1>
        <p className="text-sm text-gray-600">Enter the API_TOKEN from .env.local.</p>
        <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="API token" autoFocus />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn btn-primary w-full" type="submit">Sign in</button>
      </form>
    </main>
  );
}
