import type { PrismaClient } from "@/app/generated/prisma/client";
import type { Template, Severity, Audience } from "../types";

const DEV_RELOAD_INTERVAL_MS = 30_000;

function makeKey(group: string, condition: string, severity?: string, audience?: string): string {
  return `${group}:${condition}:${severity ?? "*"}:${audience ?? "*"}`;
}

export class TemplateCache {
  private static _instance: TemplateCache | null = null;
  private store = new Map<string, Template[]>();
  private byId = new Map<string, Template>();
  private _templateVersion = 0;
  private usageOrder: string[] = [];
  private reloadTimer: ReturnType<typeof setInterval> | null = null;
  private prisma: PrismaClient | null = null;

  static get instance(): TemplateCache {
    if (!TemplateCache._instance) {
      TemplateCache._instance = new TemplateCache();
    }
    return TemplateCache._instance;
  }

  static async initialize(prisma: PrismaClient): Promise<TemplateCache> {
    const cache = TemplateCache.instance;
    cache.prisma = prisma;
    await cache.reload();

    if (process.env.NODE_ENV === "development") {
      cache.startHotReload();
    }

    return cache;
  }

  private constructor() {}

  private startHotReload(): void {
    if (this.reloadTimer) clearInterval(this.reloadTimer);
    this.reloadTimer = setInterval(() => {
      this.reload().catch((err) => console.error("[TemplateCache] hot-reload failed:", err));
    }, DEV_RELOAD_INTERVAL_MS);
  }

  stopHotReload(): void {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  async reload(): Promise<void> {
    if (!this.prisma) throw new Error("TemplateCache not initialized with PrismaClient");

    const templates = await (this.prisma as any).explanationTemplate.findMany({
      where: { enabled: true, archivedAt: null },
      orderBy: { templateVersion: "desc" },
    });

    this.store.clear();
    this.byId.clear();
    this.usageOrder = [];

    let maxVersion = 0;

    for (const t of templates) {
      const template: Template = {
        id: t.id,
        templateGroup: t.templateGroup,
        condition: t.condition,
        severity: t.severity as Severity | null,
        audience: t.audience as Audience,
        variant: t.variant,
        template: t.template,
        priority: t.priority,
        templateVersion: t.templateVersion,
      };

      this.byId.set(t.id, template);

      const severityKey = t.severity ?? "*";
      const audienceKey = t.audience ?? "*";
      const key = makeKey(t.templateGroup, t.condition, severityKey, audienceKey);

      const arr = this.store.get(key) ?? [];
      arr.push(template);
      this.store.set(key, arr);

      const wildcardKey = makeKey(t.templateGroup, t.condition);
      const wcArr = this.store.get(wildcardKey) ?? [];
      if (!wcArr.some((existing) => existing.id === t.id)) {
        wcArr.push(template);
        this.store.set(wildcardKey, wcArr);
      }

      if (t.templateVersion > maxVersion) maxVersion = t.templateVersion;
    }

    this._templateVersion = maxVersion;
  }

  get templateVersion(): number {
    return this._templateVersion;
  }

  get(group: string, condition: string, severity?: string, audience?: string): Template[] {
    if (severity && audience) {
      const exact = this.store.get(makeKey(group, condition, severity, audience));
      if (exact && exact.length > 0) return exact;
    }

    if (severity) {
      const sev = this.store.get(makeKey(group, condition, severity));
      if (sev && sev.length > 0) return sev;
    }

    if (audience) {
      const aud = this.store.get(makeKey(group, condition, "*", audience));
      if (aud && aud.length > 0) return aud;
    }

    const wildcard = this.store.get(makeKey(group, condition));
    return wildcard ?? [];
  }

  getAll(): Template[] {
    return [...this.byId.values()];
  }

  markUsed(templateId: string): void {
    this.usageOrder = this.usageOrder.filter((id) => id !== templateId);
    this.usageOrder.push(templateId);
  }

  getLeastRecentlyUsed(templates: Template[]): Template {
    if (templates.length === 0) throw new Error("No templates to select from");

    if (templates.length === 1) return templates[0];

    const sorted = [...templates].sort((a, b) => {
      const aIdx = this.usageOrder.indexOf(a.id);
      const bIdx = this.usageOrder.indexOf(b.id);
      if (aIdx === -1 && bIdx === -1) return 0;
      if (aIdx === -1) return -1;
      if (bIdx === -1) return 1;
      return aIdx - bIdx;
    });

    return sorted[0];
  }

  get size(): number {
    return this.byId.size;
  }

  get keyCount(): number {
    return this.store.size;
  }
}
