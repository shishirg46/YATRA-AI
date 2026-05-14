/**
 * FILE: page.tsx
 * LOCATION: /app/verify-email/page.tsx
 * PURPOSE: OTP verification page — user enters 6-digit code sent to their email
 * FLOW: Enter code → verifyEmail() → /onboarding
 * NOTE: useSearchParams requires Suspense boundary — split into VerifyEmailInner + VerifyEmailPage
 */
"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Mountain, Mail, RefreshCw, ArrowRight, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { authClient } from "@/lib/auth-client";

// Inner component uses useSearchParams — must be inside Suspense
function VerifyEmailInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const email        = searchParams.get("email") ?? "";

  const [otp, setOtp]             = useState<string[]>(Array(6).fill(""));
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);

  const inputRefs    = useRef<(HTMLInputElement | null)[]>([]);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCountdown() {
    setCountdown(60);
    setCanResend(false);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(countdownRef.current!); setCanResend(true); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    startCountdown();
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { inputRefs.current[0]?.focus(); }, []);

  function handleInput(index: number, value: string) {
    if (value.length === 6 && /^\d{6}$/.test(value)) {
      setOtp(value.split("")); inputRefs.current[5]?.focus(); return;
    }
    const digit = value.replace(/\D/g, "").slice(-1);
    const next  = [...otp]; next[index] = digit; setOtp(next); setError(null);
    if (digit && index < 5) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otp[index] && index > 0) inputRefs.current[index - 1]?.focus();
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) { setOtp(pasted.split("")); inputRefs.current[5]?.focus(); }
  }

  async function handleVerify() {
    const code = otp.join("");
    if (code.length < 6) { setError("Please enter all 6 digits."); return; }
    setVerifying(true); setError(null);

    const { error } = await authClient.emailOtp.verifyEmail({ email, otp: code });

    if (error) {
      setError(error.message ?? "Invalid or expired code. Please try again.");
      setOtp(Array(6).fill("")); inputRefs.current[0]?.focus();
    } else {
      router.push("/onboarding");
    }
    setVerifying(false);
  }

  async function handleResend() {
    setResending(true); setError(null); setResent(false);
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
    if (error) {
      setError(error.message ?? "Failed to resend. Please try again.");
    } else {
      setResent(true); setOtp(Array(6).fill("")); startCountdown(); inputRefs.current[0]?.focus();
    }
    setResending(false);
  }

  const isComplete = otp.every((d) => d !== "");

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden" style={{ background: "#0a0f1e" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900&family=DM+Sans:wght@300;400;500&display=swap');
        .font-display{font-family:'Playfair Display',Georgia,serif}.font-body{font-family:'DM Sans',system-ui,sans-serif}
        @keyframes fadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
        .anim-1{animation:fadeUp .6s ease both}.anim-2{animation:fadeUp .6s .1s ease both}.anim-4{animation:fadeUp .6s .3s ease both}
        .float{animation:float 3s ease-in-out infinite}.shake{animation:shake .4s ease both}
        .shimmer-text{background:linear-gradient(90deg,#f59e0b,#fde68a,#f59e0b,#fbbf24);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 4s linear infinite}
        .glow-dot{position:absolute;border-radius:9999px;filter:blur(80px);pointer-events:none}
        .auth-card{background:rgba(15,23,42,0.85);border:1px solid rgba(245,158,11,0.15);backdrop-filter:blur(24px);border-radius:24px}
        .mountain-wave{clip-path:polygon(0 40%,10% 25%,22% 38%,35% 10%,48% 30%,60% 5%,72% 22%,85% 12%,95% 28%,100% 18%,100% 100%,0 100%)}
        .otp-input{width:52px;height:64px;background:rgba(255,255,255,0.04);border:2px solid rgba(255,255,255,0.1);border-radius:12px;color:white;font-family:'Playfair Display',Georgia,serif;font-size:26px;font-weight:700;text-align:center;caret-color:#f59e0b;transition:border-color .2s,box-shadow .2s,background .2s;outline:none}
        .otp-input:focus{border-color:rgba(245,158,11,.6);box-shadow:0 0 0 3px rgba(245,158,11,.12);background:rgba(245,158,11,.05)}
        .otp-input.filled{border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.06)}
        .otp-input.error{border-color:rgba(239,68,68,.5);box-shadow:0 0 0 3px rgba(239,68,68,.1)}
        .amber-btn{background:#f59e0b;color:#0a0f1e;font-family:'DM Sans',system-ui,sans-serif;font-weight:600;border-radius:10px;transition:background .2s,box-shadow .2s,transform .15s}
        .amber-btn:hover:not(:disabled){background:#fbbf24!important;box-shadow:0 0 32px rgba(245,158,11,.4);transform:translateY(-1px)}
        .amber-btn:disabled{opacity:.5;cursor:not-allowed}
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

        <div className="anim-2 auth-card p-8 md:p-10 text-center">
          <div className="float inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-400/10 border border-amber-400/20 mb-6">
            <Mail className="text-amber-400" size={28} />
          </div>

          <Badge className="mb-4 bg-amber-400/10 text-amber-400 border-amber-400/20 font-body text-xs uppercase tracking-widest px-4 py-1">
            Enter your code
          </Badge>

          <h1 className="font-display text-3xl font-bold text-white mb-2">
            Verify your <em className="shimmer-text not-italic">email</em>
          </h1>
          <p className="font-body text-slate-400 text-sm leading-relaxed mb-1">We sent a 6-digit code to</p>
          {email && <p className="font-body font-semibold text-amber-400 text-sm mb-8 truncate px-4">{email}</p>}

          <div className={`flex items-center justify-center gap-2 mb-6 ${error ? "shake" : ""}`} onPaste={handlePaste}>
            {otp.map((digit, i) => (
              <input key={i} ref={(el) => { inputRefs.current[i] = el; }}
                type="text" inputMode="numeric" maxLength={6} value={digit}
                onChange={(e) => handleInput(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className={`otp-input ${digit ? "filled" : ""} ${error ? "error" : ""}`}
              />
            ))}
          </div>

          {error && (
            <Alert className="mb-4 bg-red-500/10 border-red-500/20 text-red-400">
              <AlertDescription className="font-body text-sm">{error}</AlertDescription>
            </Alert>
          )}
          {resent && (
            <Alert className="mb-4 bg-emerald-500/10 border-emerald-500/20">
              <CheckCircle2 className="text-emerald-400" size={14} />
              <AlertDescription className="font-body text-sm text-emerald-400">New code sent — check your inbox.</AlertDescription>
            </Alert>
          )}

          <button onClick={handleVerify} disabled={verifying || !isComplete}
            className="amber-btn w-full py-3 flex items-center justify-center gap-2 text-sm mb-4 group">
            {verifying
              ? <RefreshCw size={15} className="animate-spin" />
              : <><span>Verify Email</span><ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" /></>
            }
          </button>

          <div className="flex items-center justify-center gap-2 font-body text-sm">
            <span className="text-slate-500">Didn&apos;t receive it?</span>
            {canResend ? (
              <button onClick={handleResend} disabled={resending}
                className="text-amber-400 hover:text-amber-300 transition-colors font-medium inline-flex items-center gap-1">
                <RefreshCw size={13} className={resending ? "animate-spin" : ""} />
                {resending ? "Sending…" : "Resend code"}
              </button>
            ) : (
              <span className="text-slate-600">Resend in <span className="text-amber-500 tabular-nums">{countdown}s</span></span>
            )}
          </div>

          <div className="mt-6 pt-5 border-t border-slate-800 flex items-center justify-center gap-3 font-body text-xs text-slate-500">
            <Link href="/register" className="text-amber-400 hover:text-amber-300 transition-colors">Wrong email?</Link>
            <span className="text-slate-700">·</span>
            <Link href="/sign-in" className="text-amber-400 hover:text-amber-300 transition-colors">Back to sign in</Link>
          </div>
        </div>

        <p className="anim-4 font-body text-center text-xs text-slate-600 mt-6">© 2026 YatraAI · Travel safe across Nepal</p>
      </div>
    </div>
  );
}

// Suspense boundary required because useSearchParams() is used inside
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0f1e" }}>
        <div className="text-slate-400 font-body text-sm animate-pulse">Loading…</div>
      </div>
    }>
      <VerifyEmailInner />
    </Suspense>
  );
}
