import { Mountain } from "lucide-react";
import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-slate-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-amber-400 w-fit">
          <Mountain size={20} />
          <span className="font-display font-bold">YatraAI</span>
        </Link>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-12 font-body text-sm text-slate-700 leading-relaxed">
        <h1 className="text-3xl font-display font-bold text-foreground mb-8">Privacy Policy</h1>
        <p className="text-slate-500 mb-8">Last updated: June 2026</p>

        <section className="mb-8">
          <h2 className="text-xl font-display font-semibold text-foreground mb-3">1. Information We Collect</h2>
          <p className="mb-3">
            YatraAI collects information you provide directly when creating an account, including your
            name, email address, username, and optional health and emergency contact details.
          </p>
          <p className="mb-3">
            When you use our trip planning and safety features, we collect location data (GPS
            coordinates, place names, route waypoints) to provide personalised safety scores,
            hazard alerts, and route recommendations.
          </p>
          <p>
            We also collect usage data such as pages visited, features used, and interaction
            patterns to improve our service.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-display font-semibold text-foreground mb-3">2. How We Use Your Information</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>Provide AI-powered travel safety assessments and route recommendations</li>
            <li>Send real-time hazard alerts for your planned or active trips</li>
            <li>Enable emergency SOS notifications to your designated contacts</li>
            <li>Improve our safety models and destination data through aggregated analysis</li>
            <li>Communicate service updates and respond to support requests</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-display font-semibold text-foreground mb-3">3. Data Sharing</h2>
          <p className="mb-3">
            We do not sell your personal information. We may share anonymised, aggregated data
            with tourism and safety authorities in Nepal for research purposes.
          </p>
          <p>
            Emergency contact information you provide is used solely for SOS alerts. We share
            your location with emergency contacts only when you explicitly trigger an SOS alert.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-display font-semibold text-foreground mb-3">4. Data Retention</h2>
          <p>
            Account data is retained until you delete your account. Location data associated
            with trips is retained for 12 months after your last activity, then anonymised.
            You may request deletion of your data at any time by contacting support.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-display font-semibold text-foreground mb-3">5. Third-Party Services</h2>
          <p className="mb-3">
            YatraAI uses the following third-party services, each with their own privacy policies:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-slate-400">
            <li>OpenStreetMap / Nominatim — reverse geocoding and map data</li>
            <li>OpenRouteService — route calculation</li>
            <li>Wikipedia / Wikimedia — destination content and images</li>
            <li>Cloudinary — image storage and optimisation</li>
            <li>Google OAuth — optional sign-in (email and profile data only)</li>
            <li>OpenWeatherMap — weather data for safety assessments</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-display font-semibold text-foreground mb-3">6. Your Rights</h2>
          <p className="mb-3">
            Under Nepal&apos;s Information Technology Act and global privacy frameworks, you have the right to:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Access the personal data we hold about you</li>
            <li>Correct inaccurate or incomplete data</li>
            <li>Delete your account and associated data</li>
            <li>Export your data in a machine-readable format</li>
            <li>Withdraw consent for data processing (where applicable)</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-display font-semibold text-foreground mb-3">7. Contact</h2>
          <p>
            For privacy-related inquiries, contact us at{" "}
            <a href="mailto:privacy@yatraai.com" className="text-amber-400 hover:underline">
              privacy@yatraai.com
            </a>.
          </p>
        </section>
      </main>
    </div>
  );
}
