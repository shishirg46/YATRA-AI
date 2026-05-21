"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminRootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/dashboard");
  }, [router]);

  return (
    <div className="min-h-screen bg-[#0a0f1d] flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-amber-400 border-r-2" />
    </div>
  );
}
