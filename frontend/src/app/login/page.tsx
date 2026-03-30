"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import {
  isSiteAuthenticated,
  setSiteAuthenticated,
  verifySiteCredentials,
} from "@/lib/site-auth";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (isSiteAuthenticated()) {
      router.replace("/dashboard");
      return;
    }
    setChecking(false);
  }, [router]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(false);
    if (verifySiteCredentials(username.trim(), password)) {
      setSiteAuthenticated();
      router.replace("/dashboard");
    } else {
      setError(true);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Receipt className="w-6 h-6 text-slate-950" />
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
            QuickYel
          </h1>
          <p className="text-slate-400 text-sm text-center">Sign in to continue</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-4 backdrop-blur-sm"
        >
          <div>
            <label htmlFor="site-user" className="block text-sm font-medium text-slate-300 mb-1.5">
              Username
            </label>
            <input
              id="site-user"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
              placeholder="Username"
            />
          </div>
          <div>
            <label htmlFor="site-pass" className="block text-sm font-medium text-slate-300 mb-1.5">
              Password
            </label>
            <input
              id="site-pass"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
              placeholder="Password"
            />
          </div>
          {error && (
            <p className="text-sm text-red-400" role="alert">
              Invalid username or password.
            </p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 py-2.5 font-semibold text-slate-950 hover:from-amber-400 hover:to-orange-500 transition-colors"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
