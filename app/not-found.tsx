import Link from "next/link";
import { Mountain } from "lucide-react";

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="flex items-center gap-2 text-amber-400 mb-6">
        <Mountain size={28} />
        <span className="font-display font-bold text-xl">YatraAI</span>
      </div>
      <h1 className="text-2xl font-display font-bold text-foreground mb-2">
        Page not found
      </h1>
      <p className="text-muted-foreground text-center max-w-md mb-8 font-body text-sm">
        This route doesn&apos;t exist in our map of Nepal. Head back to the dashboard to plan your journey.
      </p>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl font-medium text-sm hover:bg-amber-500/20 transition-colors"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
