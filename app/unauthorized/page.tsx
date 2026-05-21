import Link from "next/link";
import { Mountain, ArrowLeft } from "lucide-react";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden bg-[#0a0f1e]">
      <div className="glow-dot w-96 h-96 bg-red-500/10 -top-24 -left-24 pointer-events-none fixed" />
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 mb-2">
          <Mountain className="text-red-400" size={28} />
        </div>

        <h1 className="font-display text-3xl font-bold text-white">
          Access Denied
        </h1>

        <p className="font-body text-slate-400 text-sm leading-relaxed">
          You do not have the required permissions to access this area.
          If you believe this is a mistake, please contact your administrator.
        </p>

        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-all"
          >
            <ArrowLeft size={15} />
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
