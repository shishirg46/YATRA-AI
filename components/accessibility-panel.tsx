"use client";

import { Shield, MapPin, AlertTriangle, CheckCircle, XCircle, Navigation } from "lucide-react";
import { formatDistance } from "@/lib/map-utils";
import type { RouteAccessibilityResult, AccessibilityStatus } from "@/lib/accessibility/types";

interface Props {
  result: RouteAccessibilityResult | null;
  loading: boolean;
  error: string | null;
}

const statusConfig: Record<AccessibilityStatus, { label: string; color: string; bg: string; icon: typeof CheckCircle }> = {
  fully_accessible: { label: "Fully Accessible", color: "text-green-600", bg: "bg-green-50 border-green-200", icon: CheckCircle },
  partially_accessible: { label: "Partially Accessible", color: "text-amber-600", bg: "bg-amber-50 border-amber-200", icon: AlertTriangle },
  not_accessible: { label: "Not Accessible", color: "text-red-600", bg: "bg-red-50 border-red-200", icon: XCircle },
};

export default function AccessibilityPanel({ result, loading, error }: Props) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border p-4 space-y-3 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2" />
        <div className="h-4 bg-gray-200 rounded w-3/4" />
        <div className="h-4 bg-gray-200 rounded w-2/3" />
        <div className="h-20 bg-gray-200 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <div className="flex items-center gap-2 text-red-700 font-medium mb-1">
          <XCircle className="w-4 h-4" />
          Analysis Failed
        </div>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="bg-white rounded-xl border p-6 text-center text-gray-500">
        <Navigation className="w-10 h-10 mx-auto mb-2 text-gray-300" />
        <p className="text-sm">Select a destination to check route accessibility</p>
      </div>
    );
  }

  const cfg = statusConfig[result.status];
  const StatusIcon = cfg.icon;

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div className={`rounded-xl border p-4 ${cfg.bg}`}>
        <div className="flex items-center gap-2 mb-1">
          <StatusIcon className={`w-5 h-5 ${cfg.color}`} />
          <span className={`font-semibold ${cfg.color}`}>{cfg.label}</span>
        </div>
        <p className="text-sm text-gray-700 mt-1">{result.reason}</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border p-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <MapPin className="w-3.5 h-3.5" />
            Total Distance
          </div>
          <p className="text-lg font-bold">{formatDistance(result.totalDistance)}</p>
        </div>

        <div className="bg-white rounded-xl border p-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Shield className="w-3.5 h-3.5" />
            Safety Score
          </div>
          <p className="text-lg font-bold">{result.safetyScore}/100</p>
        </div>

        <div className="bg-white rounded-xl border p-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
            Reachable
          </div>
          <p className="text-lg font-bold">{formatDistance(result.accessibleDistance)}</p>
        </div>

        <div className="bg-white rounded-xl border p-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            Accessibility
          </div>
          <p className="text-lg font-bold">{result.accessibilityPercentage}%</p>
        </div>
      </div>

      {/* Suggestions */}
      {result.suggestions.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <p className="text-xs font-semibold text-blue-700 mb-1.5">Recommendations</p>
          <ul className="space-y-1">
            {result.suggestions.map((s, i) => (
              <li key={i} className="text-xs text-blue-800 flex items-start gap-1.5">
                <span className="mt-0.5">•</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Segment summary */}
      {result.blockedSegments.length > 0 && (
        <div className="bg-white rounded-xl border p-3">
          <p className="text-xs font-semibold text-gray-700 mb-2">Blocked Segments</p>
          <div className="space-y-1.5">
            {result.blockedSegments.map((seg) => (
              <div key={seg.index} className="flex items-start gap-2 text-xs">
                <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium">Segment {seg.index + 1}</span>
                  {seg.blockedBy.length > 0 && (
                    <span className="text-gray-500"> — {seg.blockedBy.join("; ")}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
