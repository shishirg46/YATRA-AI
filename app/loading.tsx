import { Mountain } from "lucide-react";

export default function LoadingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="flex items-center gap-2 text-amber-400 mb-6">
        <Mountain size={28} className="animate-pulse" />
        <span className="font-display font-bold text-xl">YatraAI</span>
      </div>
      <div className="flex gap-1.5">
        <span className="w-2 h-2 bg-amber-400/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
        <span className="w-2 h-2 bg-amber-400/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
        <span className="w-2 h-2 bg-amber-400/60 rounded-full animate-bounce" />
      </div>
      <p className="text-muted-foreground text-sm mt-4 font-body">Loading...</p>
    </div>
  );
}
