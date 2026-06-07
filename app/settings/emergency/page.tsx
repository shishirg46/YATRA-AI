"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Plus, Pencil, Trash2, Phone, Mail, Star, X, Check, Loader2, PhoneCall } from "lucide-react";
import { toast } from "sonner";

type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  relation: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

export default function EmergencyContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formRelation, setFormRelation] = useState("");
  const [formIsPrimary, setFormIsPrimary] = useState(false);

  const fetchContacts = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/user/emergency-contacts", { credentials: "include" });
      if (!res.ok) { setError("Failed to load contacts."); return; }
      const data = await res.json();
      setContacts(data);
    } catch {
      setError("Failed to load contacts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  function resetForm() {
    setFormName(""); setFormPhone(""); setFormEmail(""); setFormRelation(""); setFormIsPrimary(false);
    setEditingId(null); setShowForm(false);
  }

  function openEdit(c: EmergencyContact) {
    setFormName(c.name); setFormPhone(c.phone); setFormEmail(c.email ?? ""); setFormRelation(c.relation ?? "");
    setFormIsPrimary(c.isPrimary); setEditingId(c.id); setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim() || !formPhone.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const res = await fetch(`/api/user/emergency-contacts/${editingId}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName.trim(), phone: formPhone.trim(), email: formEmail.trim() || null, relation: formRelation.trim() || null, isPrimary: formIsPrimary }),
        });
        if (!res.ok) { setError("Failed to update contact."); setSaving(false); return; }
      } else {
        const res = await fetch("/api/user/emergency-contacts", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName.trim(), phone: formPhone.trim(), email: formEmail.trim() || null, relation: formRelation.trim() || null, isPrimary: formIsPrimary }),
        });
        if (!res.ok) { setError("Failed to add contact."); setSaving(false); return; }
      }
      resetForm();
      await fetchContacts();
      toast.success(editingId ? "Contact updated." : "Contact added.");
    } catch {
      setError("Something went wrong.");
      toast.error("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deletingId) return;
    try {
      const res = await fetch(`/api/user/emergency-contacts/${deletingId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { setError("Failed to delete contact."); toast.error("Failed to delete contact."); setDeletingId(null); return; }
      setContacts((prev) => prev.filter((c) => c.id !== deletingId));
      setDeletingId(null);
      toast.success("Contact removed.");
    } catch {
      setError("Failed to delete contact.");
      toast.error("Failed to delete contact.");
      setDeletingId(null);
    }
  }

  async function togglePrimary(c: EmergencyContact) {
    if (c.isPrimary) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/user/emergency-contacts/${c.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrimary: true }),
      });
      if (!res.ok) { setError("Failed to update."); toast.error("Failed to update."); setSaving(false); return; }
      await fetchContacts();
      toast.success("Primary contact updated.");
    } catch {
      setError("Failed to update.");
      toast.error("Failed to update.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="glow-dot w-[500px] h-[400px] bg-amber-500/8 -top-32 -left-32 pointer-events-none fixed" />
      <div className="glow-dot w-[400px] h-[300px] bg-sky-500/6 bottom-0 right-0 pointer-events-none fixed" />

      <nav className="nav-blur fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 md:px-8 h-16 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={() => router.back()} className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors font-body text-sm shrink-0">
            <ChevronLeft size={15} />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <PhoneCall className="text-amber-400 shrink-0" size={22} />
            <span className="font-display font-bold text-lg text-white tracking-tight truncate">YatraAI</span>
          </div>
          <span className="text-slate-700 hidden sm:inline">·</span>
          <span className="font-body text-sm text-slate-400 truncate hidden sm:inline">Emergency Contacts</span>
        </div>
      </nav>

      <main className="pt-16 max-w-2xl mx-auto px-4 md:px-8 py-8 relative">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <PhoneCall size={18} className="text-amber-400" />
            <h1 className="font-display text-2xl font-bold text-white">Emergency Contacts</h1>
          </div>
          <p className="font-body text-sm text-slate-400">
            Manage who gets notified when you trigger an SOS alert.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-400/10 border border-red-400/20 mb-4">
            <span className="font-body text-sm text-red-400">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-400"><X size={14} /></button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-amber-400" />
          </div>
        ) : (
          <div className="space-y-3">
            {contacts.length === 0 ? (
              <div className="text-center py-16">
                <Phone size={36} className="text-slate-700 mx-auto mb-3" />
                <h3 className="font-display font-semibold text-white mb-1">No emergency contacts</h3>
                <p className="font-body text-sm text-slate-400 mb-4">Add at least one contact for SOS alerts.</p>
              </div>
            ) : (
              contacts.map((c) => (
                <div key={c.id} className="rounded-xl border border-slate-700/50 bg-slate-800/60 px-4 py-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0">
                    <Phone size={16} className="text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-body font-medium text-white text-sm truncate">{c.name}</span>
                      {c.isPrimary && <Star size={12} className="text-amber-400 fill-amber-400 shrink-0" />}
                    </div>
                    <p className="font-body text-xs text-slate-400 truncate">
                      <Phone size={10} className="inline mr-1" />{c.phone}
                      {c.email ? <><span className="text-slate-600 mx-1">·</span><Mail size={10} className="inline mr-1" />{c.email}</> : ""}
                      {c.relation ? <><span className="text-slate-600 mx-1">·</span>{c.relation}</> : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!c.isPrimary && (
                      <button onClick={() => togglePrimary(c)} disabled={saving} title="Set as primary" className="p-1.5 rounded-lg text-slate-500 hover:text-amber-400 hover:bg-amber-400/10 transition-all">
                        <Star size={13} />
                      </button>
                    )}
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-slate-500 hover:text-sky-400 hover:bg-sky-400/10 transition-all">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => setDeletingId(c.id)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-all">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}

            {!showForm && (
              <button onClick={() => { resetForm(); setShowForm(true); }} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-slate-700/60 text-slate-400 hover:text-amber-400 hover:border-amber-400/40 transition-all font-body text-sm">
                <Plus size={15} /> Add emergency contact
              </button>
            )}

            {showForm && (
              <form onSubmit={handleSave} className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 space-y-3">
                <h3 className="font-body text-xs text-slate-500 uppercase tracking-widest">{editingId ? "Edit contact" : "New contact"}</h3>
                <div>
                  <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Full name" required autoFocus
                    className="drawer-input w-full px-3 py-2 text-sm rounded-lg" />
                </div>
                <div>
                  <input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} placeholder="Phone number" required
                    className="drawer-input w-full px-3 py-2 text-sm rounded-lg" />
                </div>
                <div>
                  <input value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="Email (for SOS alerts)" type="email"
                    className="drawer-input w-full px-3 py-2 text-sm rounded-lg" />
                </div>
                <div>
                  <input value={formRelation} onChange={(e) => setFormRelation(e.target.value)} placeholder="Relation (e.g. Spouse, Brother)" 
                    className="drawer-input w-full px-3 py-2 text-sm rounded-lg" />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formIsPrimary} onChange={(e) => setFormIsPrimary(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/30" />
                  <span className="font-body text-xs text-slate-400">Set as primary contact</span>
                </label>
                <div className="flex items-center gap-2 pt-1">
                  <button type="submit" disabled={saving || !formName.trim() || !formPhone.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-body font-semibold transition-all disabled:opacity-50">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {editingId ? "Update" : "Add"}
                  </button>
                  <button type="button" onClick={resetForm} className="px-3 py-2 rounded-lg border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-500 transition-all font-body text-sm">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </main>

      {deletingId && (() => {
        const contact = contacts.find((c) => c.id === deletingId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700/60 rounded-2xl p-5 max-w-xs w-full shadow-2xl">
              <div className="flex items-center gap-3 mb-3">
                <Trash2 size={20} className="text-red-400 shrink-0" />
                <p className="font-body text-sm text-white font-bold">Delete Contact</p>
              </div>
              <p className="font-body text-xs text-slate-400 mb-5">
                Are you sure you want to remove <span className="text-white font-semibold">{contact?.name || "this contact"}</span> from your emergency contacts?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeletingId(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-600 font-body text-xs text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 font-body text-xs text-white font-bold transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <style jsx>{`
        .drawer-input {
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(51, 65, 85, 0.5);
          color: #e2e8f0;
          outline: none;
          transition: border-color 0.2s;
        }
        .drawer-input:focus { border-color: rgba(251, 191, 36, 0.4); }
      `}</style>
    </div>
  );
}
