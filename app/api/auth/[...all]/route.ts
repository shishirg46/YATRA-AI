import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { withRateLimit } from "@/lib/rate-limit";

const _h = toNextJsHandler(auth);
export const GET = withRateLimit(_h.GET, { max: 30, windowSeconds: 60 });
export const POST = withRateLimit(_h.POST, { max: 5, windowSeconds: 60 });
