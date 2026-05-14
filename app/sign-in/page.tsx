/**
 * FILE: page.tsx
 * LOCATION: /app/sign-in/page.tsx
 * PURPOSE: Sign-in — supports login with email OR username + Google OAuth
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mountain, ArrowRight, Eye, EyeOff, AtSign, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [loginMode, setLoginMode]         = useState<"email" | "username">("email");
  const [loading, setLoading]             = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword]   = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const password = formData.get("password") as string;

    let authError: string | null = null;

    if (loginMode === "email") {
      const email = formData.get("identifier") as string;
      const { error } = await authClient.signIn.email({
        email,
        password,
        callbackURL: "/api/user/post-oauth-redirect",
      });
      authError = error?.message ?? null;
    } else {
      const username = formData.get("identifier") as string;
      const { error } = await authClient.signIn.username({
        username,
        password,
        callbackURL: "/api/user/post-oauth-redirect",
      });
      authError = error?.message ?? null;
    }

    if (authError) {
      setError(authError || "Invalid credentials. Please try again.");
      setLoading(false);
      return;
    }

    router.push("/api/user/post-oauth-redirect");
    setLoading(false);
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    await authClient.signIn.social({
      provider:    "google",
      callbackURL: "/api/user/post-oauth-redirect",
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden" style={{ background: "#0a0f1e" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=DM+Sans:wght@300;400;500&display=swap');
        .font-display{font-family:'Playfair Display',Georgia,serif}.font-body{font-family:'DM Sans',system-ui,sans-serif}
        @keyframes fadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        .anim-1{animation:fadeUp .6s ease both}.anim-2{animation:fadeUp .6s .1s ease both}
        .anim-3{animation:fadeUp .6s .2s ease both}.anim-4{animation:fadeUp .6s .3s ease both}
        .shimmer-text{background:linear-gradient(90deg,#f59e0b,#fde68a,#f59e0b,#fbbf24);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 4s linear infinite}
        .glow-dot{position:absolute;border-radius:9999px;filter:blur(80px);pointer-events:none}
        .auth-card{background:rgba(15,23,42,0.85);border:1px solid rgba(245,158,11,0.15);backdrop-filter:blur(24px);border-radius:24px}
        .auth-input{background:rgba(255,255,255,0.04)!important;border:1px solid rgba(255,255,255,0.1)!important;color:white!important;font-family:'DM Sans',system-ui,sans-serif;border-radius:10px!important;transition:border-color .2s,box-shadow .2s}
        .auth-input:focus{border-color:rgba(245,158,11,.5)!important;box-shadow:0 0 0 3px rgba(245,158,11,.1)!important;outline:none!important}
        .auth-input::placeholder{color:rgba(255,255,255,0.25)!important}
        .amber-btn{background:#f59e0b;color:#0a0f1e;font-family:'DM Sans',system-ui,sans-serif;font-weight:600;border-radius:10px;transition:background .2s,box-shadow .2s,transform .15s}
        .amber-btn:hover:not(:disabled){background:#fbbf24;box-shadow:0 0 32px rgba(245,158,11,.4);transform:translateY(-1px)}
        .amber-btn:disabled{opacity:.6;cursor:not-allowed}
        .outline-btn{background:transparent;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,.75);font-family:'DM Sans',system-ui,sans-serif;border-radius:10px;transition:border-color .2s,background .2s}
        .outline-btn:hover:not(:disabled){border-color:rgba(255,255,255,.3);background:rgba(255,255,255,.05)}
        .outline-btn:disabled{opacity:.6;cursor:not-allowed}
        .divider-line{flex:1;height:1px;background:rgba(255,255,255,0.08)}
        .mountain-wave{clip-path:polygon(0 40%,10% 25%,22% 38%,35% 10%,48% 30%,60% 5%,72% 22%,85% 12%,95% 28%,100% 18%,100% 100%,0 100%)}
        .mode-tab{font-family:'DM Sans',system-ui,sans-serif;font-size:13px;border-radius:8px;padding:6px 14px;transition:all .2s;border:1px solid transparent;cursor:pointer}
        .mode-tab.active{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.35);color:#f59e0b}
        .mode-tab.inactive{color:rgba(255,255,255,.4);background:transparent}
        .mode-tab.inactive:hover{color:rgba(255,255,255,.7);background:rgba(255,255,255,.04)}
      `}</style>

      <div className="glow-dot w-96 h-96 bg-amber-500/15 -top-24 -left-24" />
      <div className="glow-dot w-80 h-80 bg-sky-500/10 bottom-0 right-0" />
      <div className="absolute bottom-0 inset-x-0 h-28 mountain-wave bg-gradient-to-b from-slate-800/30 to-slate-900/50 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        <div className="anim-1 text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 group">
            <Mountain className="text-amber-400 group-hover:scale-110 transition-transform" size={26} />
            <span className="font-display font-bold text-2xl text-white tracking-tight">YatraAI</span>
          </Link>
        </div>

        <div className="anim-2 auth-card p-8 md:p-10">
          <div className="mb-8">
            <h1 className="font-display text-3xl font-bold text-white mb-2">
              Welcome <em className="shimmer-text not-italic">back</em>
            </h1>
            <p className="font-body text-slate-400 text-sm">Sign in to access your travel safety dashboard.</p>
          </div>

          {error && (
            <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-body text-sm">{error}</div>
          )}

          {/* Google */}
          <button type="button" onClick={handleGoogle} disabled={googleLoading}
            className="outline-btn w-full py-3 px-4 flex items-center justify-center gap-3 mb-6 text-sm">
            <svg width="16" height="16" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              <path fill="none" d="M0 0h48v48H0z"/>
            </svg>
            {googleLoading ? "Redirecting…" : "Continue with Google"}
          </button>

          <div className="flex items-center gap-3 mb-6">
            <div className="divider-line" /><span className="font-body text-xs text-slate-500 uppercase tracking-widest">or</span><div className="divider-line" />
          </div>

          {/* Login mode toggle */}
          <div className="flex items-center gap-2 mb-5 p-1 rounded-xl bg-slate-800/50 border border-slate-700/50">
            <button
              type="button"
              onClick={() => { setLoginMode("email"); setError(null); }}
              className={`mode-tab flex-1 flex items-center justify-center gap-1.5 ${loginMode === "email" ? "active" : "inactive"}`}
            >
              <Mail size={13} /> Email
            </button>
            <button
              type="button"
              onClick={() => { setLoginMode("username"); setError(null); }}
              className={`mode-tab flex-1 flex items-center justify-center gap-1.5 ${loginMode === "username" ? "active" : "inactive"}`}
            >
              <AtSign size={13} /> Username
            </button>
          </div>

          <form onSubmit={handleSubmit} className="anim-3 flex flex-col gap-5">

            {/* Dynamic identifier field */}
            <div className="grid gap-2">
              <Label htmlFor="identifier" className="font-body text-xs text-slate-400 uppercase tracking-widest">
                {loginMode === "email" ? "Email" : "Username"}
              </Label>
              <Input
                key={loginMode}
                id="identifier"
                name="identifier"
                type={loginMode === "email" ? "email" : "text"}
                placeholder={loginMode === "email" ? "you@example.com" : "your_username"}
                required
                autoComplete={loginMode === "email" ? "email" : "username"}
                className="auth-input h-11"
              />
            </div>

            {/* Password */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="font-body text-xs text-slate-400 uppercase tracking-widest">Password</Label>
                <Link href="/forgot-password" className="font-body text-xs text-amber-400 hover:text-amber-300 transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input id="password" name="password" type={showPassword ? "text" : "password"} required className="auth-input h-11 pr-11" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="amber-btn w-full py-3 flex items-center justify-center gap-2 text-sm mt-1 group">
              {loading ? "Signing in…" : <><span>Sign In</span><ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" /></>}
            </button>
          </form>

          <p className="anim-4 font-body text-center text-sm text-slate-500 mt-7">
            New to YatraAI?{" "}
            <Link href="/register" className="text-amber-400 hover:text-amber-300 transition-colors font-medium">Create an account</Link>
          </p>
        </div>

        <p className="anim-4 font-body text-center text-xs text-slate-600 mt-6">© 2026 YatraAI · Travel safe across Nepal</p>
      </div>
    </div>
  );
}
