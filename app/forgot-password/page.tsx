"use client";

import { useState } from "react";
import Link from "next/link";
import { Mountain, ArrowRight, ArrowLeft, Mail, KeyRound, CheckCircle } from "lucide-react";
import { authClient } from "@/lib/auth-client";

type Step = "email" | "otp";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "forget-password",
      });
      if (err) throw new Error(err.message || "Failed to send OTP");
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await authClient.emailOtp.verifyEmail({ email, otp });
      if (err) throw new Error(err.message || "Invalid or expired OTP");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <CheckCircle size={48} className="text-emerald-400 mx-auto mb-4" />
          <h1 className="text-2xl font-display font-bold text-white mb-2">Password reset</h1>
          <p className="text-slate-400 font-body text-sm mb-6">
            Your password has been reset successfully.
          </p>
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl font-medium text-sm hover:bg-amber-500/20 transition-colors"
          >
            <ArrowRight size={15} />
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 text-amber-400 mb-8 justify-center">
          <Mountain size={24} />
          <span className="font-display font-bold text-lg">YatraAI</span>
        </div>

        {step === "email" ? (
          <form onSubmit={sendOtp} className="space-y-5">
            <h1 className="text-2xl font-display font-bold text-white text-center">Forgot password</h1>
            <p className="text-slate-400 font-body text-sm text-center">
              Enter your email and we&apos;ll send you a reset code.
            </p>

            <div>
              <label htmlFor="email" className="block text-sm font-body text-slate-300 mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500/50 transition-colors"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-sm font-body">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl font-medium text-sm hover:bg-amber-500/20 transition-colors disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send reset code"}
              <ArrowRight size={15} />
            </button>

            <p className="text-center">
              <Link href="/sign-in" className="text-slate-500 text-sm hover:text-slate-300 transition-colors">
                Back to sign in
              </Link>
            </p>
          </form>
        ) : (
          <form onSubmit={resetPassword} className="space-y-5">
            <button
              type="button"
              onClick={() => { setStep("email"); setError(null); }}
              className="flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-300 transition-colors"
            >
              <ArrowLeft size={14} />
              Change email
            </button>

            <h1 className="text-2xl font-display font-bold text-white">Enter reset code</h1>
            <p className="text-slate-400 font-body text-sm">
              A 6-digit code was sent to {email}.
            </p>

            <div>
              <label htmlFor="otp" className="block text-sm font-body text-slate-300 mb-1.5">
                Reset code
              </label>
              <div className="relative">
                <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="otp"
                  type="text"
                  required
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm text-center tracking-[0.5em] font-mono focus:outline-none focus:border-amber-500/50 transition-colors"
                  placeholder="000000"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-body text-slate-300 mb-1.5">
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500/50 transition-colors"
                placeholder="At least 8 characters"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm font-body">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl font-medium text-sm hover:bg-amber-500/20 transition-colors disabled:opacity-50"
            >
              {loading ? "Resetting..." : "Reset password"}
              <ArrowRight size={15} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
