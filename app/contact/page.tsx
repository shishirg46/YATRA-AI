"use client";

import { useState } from "react";
import { Mountain, Mail, Send, CheckCircle } from "lucide-react";
import Link from "next/link";

export default function ContactPage() {
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", message: "" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // In production, this would POST to an API endpoint.
    // For now, open the default mail client.
    const subject = encodeURIComponent("YatraAI Support Request");
    const body = encodeURIComponent(
      `Name: ${form.name}\nEmail: ${form.email}\n\n${form.message}`
    );
    window.open(`mailto:support@yatraai.com?subject=${subject}&body=${body}`);
    setSent(true);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-slate-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-amber-400 w-fit">
          <Mountain size={20} />
          <span className="font-display font-bold">YatraAI</span>
        </Link>
      </header>
      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-display font-bold text-foreground mb-8">Contact Us</h1>

        <div className="grid md:grid-cols-2 gap-8 mb-12">
          <div className="space-y-4">
            <h2 className="text-lg font-display font-semibold text-foreground">Get in touch</h2>
            <div className="flex items-center gap-3 text-slate-700 font-body text-sm">
              <Mail size={16} className="text-amber-400 shrink-0" />
              <a href="mailto:support@yatraai.com" className="hover:text-amber-400 transition-colors">
                support@yatraai.com
              </a>
            </div>
            <p className="text-slate-500 font-body text-sm leading-relaxed">
              We aim to respond within 24 hours. For urgent safety issues, use the
              in-app SOS feature.
            </p>
          </div>
          <div className="space-y-4">
            <h2 className="text-lg font-display font-semibold text-foreground">Report an issue</h2>
            <p className="text-slate-500 font-body text-sm leading-relaxed">
              Found a bug or inaccurate safety data? Let us know using the form or
              email us directly. We appreciate your help improving YatraAI for
              everyone travelling in Nepal.
            </p>
          </div>
        </div>

        {sent ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CheckCircle size={48} className="text-emerald-400 mb-4" />
            <h2 className="text-xl font-display font-semibold text-foreground mb-2">Message sent!</h2>
            <p className="text-slate-400 font-body text-sm">
              We&apos;ll get back to you as soon as possible.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="name" className="block text-sm font-body text-slate-700 mb-1.5">
                Name
              </label>
              <input
                id="name"
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500/50 transition-colors"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-body text-slate-700 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500/50 transition-colors"
              />
            </div>
            <div>
              <label htmlFor="message" className="block text-sm font-body text-slate-700 mb-1.5">
                Message
              </label>
              <textarea
                id="message"
                required
                rows={5}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500/50 transition-colors resize-y"
              />
            </div>
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-3 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl font-medium text-sm hover:bg-amber-500/20 transition-colors"
            >
              <Send size={15} />
              Send message
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
