/**
 * FILE: page.tsx
 * LOCATION: /app/register/page.tsx
 * PURPOSE: Registration — collects username, creates account, sends OTP
 * FLOW: Fill form → signUp.email() → sendVerificationOtp() → /verify-email?email=...
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mountain, ArrowRight, Eye, EyeOff, CheckCircle2, AtSign } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading]             = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword]   = useState(false);
  const [showConfirm, setShowConfirm]     = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [passwordStrength, setPasswordStrength] = useState(0);

  function checkStrength(val: string) {
    let score = 0;
    if (val.length >= 8) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;
    setPasswordStrength(score);
  }

  const strengthLabel = ["", "Weak", "Fair", "Good", "Strong"][passwordStrength];
  const strengthColor = ["", "bg-red-500", "bg-amber-500", "bg-yellow-400", "bg-emerald-500"][passwordStrength];

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData        = new FormData(e.currentTarget);
    const name            = formData.get("name") as string;
    const username        = formData.get("username") as string;
    const email           = formData.get("email") as string;
    const password        = formData.get("password") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    // Basic username validation
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      setError("Username must be 3–20 characters, lowercase letters, numbers and underscores only.");
      return;
    }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    if (passwordStrength < 2)         { setError("Please choose a stronger password."); return; }

    setLoading(true);

    // Set temporary sign up cookie
    document.cookie = "is_signing_up=true; path=/; max-age=1800; SameSite=Lax";

    // Step 1: Create account
    const { error: signUpError } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: "/verify-email",
      username,
    });

    if (signUpError) {
      setError(signUpError.message ?? "Failed to create account. Please try again.");
      setLoading(false);
      return;
    }

    // Step 2: Send OTP
    const { error: otpError } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "email-verification",
    });

    if (otpError) {
      setError(otpError.message ?? "Account created but failed to send OTP. Try signing in.");
      setLoading(false);
      return;
    }

    // Step 3: Go to OTP entry
    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
    setLoading(false);
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    // Set temporary sign up cookie
    document.cookie = "is_signing_up=true; path=/; max-age=1800; SameSite=Lax";
    await authClient.signIn.social({
      provider:    "google",
      callbackURL: "/api/user/post-oauth-redirect",
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 relative overflow-hidden" style={{ background: "#0a0f1e" }}>
      <style>{`
        .auth-card{background:rgba(15,23,42,0.85);border:1px solid rgba(245,158,11,0.15);backdrop-filter:blur(24px);border-radius:24px}
        .auth-input{background:rgba(255,255,255,0.04)!important;border:1px solid rgba(255,255,255,0.1)!important;color:white!important;font-family:'DM Sans',system-ui,sans-serif;border-radius:10px!important;transition:border-color .2s,box-shadow .2s}
        .auth-input:focus{border-color:rgba(245,158,11,.5)!important;box-shadow:0 0 0 3px rgba(245,158,11,.1)!important;outline:none!important}
        .auth-input::placeholder{color:rgba(255,255,255,0.25)!important}
        .username-prefix{background:rgba(245,158,11,.08);border:1px solid rgba(255,255,255,0.1);border-right:none;border-radius:10px 0 0 10px;color:rgba(245,158,11,.7);padding:0 12px;display:flex;align-items:center;font-size:14px;font-family:'DM Sans',system-ui,sans-serif}
        .username-input{border-radius:0 10px 10px 0!important;border-left:none!important}
        .amber-btn{background:#f59e0b;color:#0a0f1e;font-family:'DM Sans',system-ui,sans-serif;font-weight:600;border-radius:10px;transition:background .2s,box-shadow .2s,transform .15s}
        .amber-btn:hover:not(:disabled){background:#fbbf24;box-shadow:0 0 32px rgba(245,158,11,.4);transform:translateY(-1px)}
        .amber-btn:disabled{opacity:.6;cursor:not-allowed}
        .outline-btn{background:transparent;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,.75);font-family:'DM Sans',system-ui,sans-serif;border-radius:10px;transition:border-color .2s,background .2s}
        .outline-btn:hover:not(:disabled){border-color:rgba(255,255,255,.3);background:rgba(255,255,255,.05)}
        .outline-btn:disabled{opacity:.6;cursor:not-allowed}
        .divider-line{flex:1;height:1px;background:rgba(255,255,255,0.08)}
        .strength-bar{height:3px;border-radius:99px;transition:width .4s ease,background .4s ease}
      `}</style>

      <div className="glow-dot w-96 h-96 bg-amber-500/15 -top-24 -right-24" />
      <div className="glow-dot w-80 h-80 bg-sky-500/10 bottom-0 -left-24" />
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
              Start your <em className="shimmer-text not-italic">journey</em>
            </h1>
            <p className="font-body text-slate-400 text-sm">Create a free account to travel safely across Nepal.</p>
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

          <form onSubmit={handleSubmit} className="anim-3 flex flex-col gap-5">

            {/* Full name */}
            <div className="grid gap-2">
              <Label htmlFor="name" className="font-body text-xs text-slate-400 uppercase tracking-widest">Full Name</Label>
              <Input id="name" name="name" type="text" placeholder="Jane Doe" required className="auth-input h-11" />
            </div>

            {/* Username */}
            <div className="grid gap-2">
              <Label htmlFor="username" className="font-body text-xs text-slate-400 uppercase tracking-widest">Username</Label>
              <div className="flex h-11">
                <div className="username-prefix">
                  <AtSign size={14} />
                </div>
                <Input
                  id="username"
                  name="username"
                  type="text"
                  placeholder="your_username"
                  required
                  autoComplete="username"
                  onChange={(e) => {
                    // auto lowercase
                    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                  }}
                  className="auth-input username-input flex-1 h-full"
                />
              </div>
              <p className="font-body text-xs text-slate-600">3–20 chars, lowercase letters, numbers and _ only</p>
            </div>

            {/* Email */}
            <div className="grid gap-2">
              <Label htmlFor="email" className="font-body text-xs text-slate-400 uppercase tracking-widest">Email</Label>
              <Input id="email" name="email" type="email" placeholder="you@example.com" required className="auth-input h-11" />
            </div>

            {/* Password */}
            <div className="grid gap-2">
              <Label htmlFor="password" className="font-body text-xs text-slate-400 uppercase tracking-widest">Password</Label>
              <div className="relative">
                <Input id="password" name="password" type={showPassword ? "text" : "password"} required
                  onChange={(e) => checkStrength(e.target.value)} className="auth-input h-11 pr-11" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordStrength > 0 && (
                <div className="flex items-center gap-3 mt-1">
                  <div className="flex gap-1 flex-1">
                    {[1,2,3,4].map((i) => (
                      <div key={i} className={`strength-bar flex-1 ${i <= passwordStrength ? strengthColor : "bg-slate-700"}`} />
                    ))}
                  </div>
                  <span className={`font-body text-xs ${passwordStrength===4?"text-emerald-400":passwordStrength===3?"text-yellow-400":passwordStrength===2?"text-amber-400":"text-red-400"}`}>
                    {strengthLabel}
                  </span>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div className="grid gap-2">
              <Label htmlFor="confirmPassword" className="font-body text-xs text-slate-400 uppercase tracking-widest">Confirm Password</Label>
              <div className="relative">
                <Input id="confirmPassword" name="confirmPassword" type={showConfirm ? "text" : "password"} required className="auth-input h-11 pr-11" />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <p className="font-body text-xs text-slate-500 leading-relaxed">
              By creating an account you agree to our{" "}
              <Link href="/terms" className="text-amber-400 hover:text-amber-300 transition-colors">Terms of Service</Link>{" "}and{" "}
              <Link href="/privacy" className="text-amber-400 hover:text-amber-300 transition-colors">Privacy Policy</Link>.
            </p>

            <button type="submit" disabled={loading} className="amber-btn w-full py-3 flex items-center justify-center gap-2 text-sm mt-1 group">
              {loading ? "Creating account…" : <><span>Create Account</span><ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" /></>}
            </button>
          </form>

          <div className="anim-4 mt-7 pt-6 border-t border-slate-800 grid grid-cols-2 gap-2">
            {["Free forever","Live safety alerts","AI trip planning","Friends network"].map((perk) => (
              <div key={perk} className="flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                <span className="font-body text-xs text-slate-500">{perk}</span>
              </div>
            ))}
          </div>

          <p className="font-body text-center text-sm text-slate-500 mt-7">
            Already have an account?{" "}
            <Link href="/sign-in" className="text-amber-400 hover:text-amber-300 transition-colors font-medium">Sign in</Link>
          </p>
        </div>
        <p className="font-body text-center text-xs text-slate-600 mt-6">© 2026 YatraAI · Travel safe across Nepal</p>
      </div>
    </div>
  );
}
