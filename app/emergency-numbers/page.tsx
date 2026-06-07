import { Phone, Building2, Shield, Truck, Flame, LifeBuoy, MapPin } from "lucide-react";
import Link from "next/link";
import { Mountain } from "lucide-react";

const NATIONAL_NUMBERS = [
  { service: "Police", number: "100", icon: Shield, desc: "Nepal Police emergency hotline" },
  { service: "Ambulance", number: "102", icon: Truck, desc: "National ambulance service" },
  { service: "Fire Brigade", number: "101", icon: Flame, desc: "Fire emergency response" },
  { service: "Tourist Police", number: "1144", icon: LifeBuoy, desc: "Dedicated tourist assistance" },
  { service: "Disaster Management", number: "1155", icon: Shield, desc: "NDRRMA hotline" },
  { service: "Women & Children", number: "1145", icon: Shield, desc: "Women and child helpline" },
  { service: "Child Helpline", number: "1098", icon: Shield, desc: "Child rights and protection" },
  { service: "Traffic Police", number: "103", icon: Building2, desc: "Traffic incidents and road safety" },
  { service: "Search & Rescue", number: "100", icon: LifeBuoy, desc: "Ask operator for SAR (via Police 100)" },
];

const PROVINCES = [
  {
    name: "Province 1",
    capital: "Biratnagar",
    districts: ["Taplejung", "Panchthar", "Ilam", "Jhapa", "Morang", "Sunsari", "Dhankuta", "Terhathum", "Sankhuwasabha", "Bhojpur", "Solukhumbu", "Khotang", "Udayapur", "Okhaldhunga"],
    hospitals: [
      { name: "BP Koirala Institute of Health Sciences", city: "Dharan", phone: "025-525555" },
      { name: "Koshi Hospital", city: "Biratnagar", phone: "021-527400" },
      { name: "Mechi Zonal Hospital", city: "Bhadrapur", phone: "023-520166" },
    ],
  },
  {
    name: "Madhesh Province",
    capital: "Janakpur",
    districts: ["Saptari", "Siraha", "Dhanusa", "Mahottari", "Sarlahi", "Rautahat", "Bara", "Parsa"],
    hospitals: [
      { name: "Janakpur Zonal Hospital", city: "Janakpur", phone: "041-520166" },
      { name: "Narayani Hospital", city: "Birgunj", phone: "051-522240" },
      { name: "Gajendra Narayan Singh Hospital", city: "Rajbiraj", phone: "031-520166" },
    ],
  },
  {
    name: "Bagmati Province",
    capital: "Hetauda",
    districts: ["Kathmandu", "Bhaktapur", "Lalitpur", "Nuwakot", "Rasuwa", "Dhading", "Makwanpur", "Chitwan", "Kavrepalanchok", "Sindhupalchok", "Sindhuli", "Ramechhap"],
    hospitals: [
      { name: "Bir Hospital (NAMS)", city: "Kathmandu", phone: "01-4221119" },
      { name: "Teaching Hospital (IOM)", city: "Maharajgunj", phone: "01-4412303" },
      { name: "Patan Hospital", city: "Lalitpur", phone: "01-5522295" },
      { name: "Bhaktapur Hospital", city: "Bhaktapur", phone: "01-6611628" },
      { name: "Bharatpur Hospital", city: "Chitwan", phone: "056-593166" },
    ],
  },
  {
    name: "Gandaki Province",
    capital: "Pokhara",
    districts: ["Gorkha", "Lamjung", "Tanahun", "Kaski", "Manang", "Mustang", "Syangja", "Myagdi", "Parbat", "Baglung", "Nawalpur"],
    hospitals: [
      { name: "Pokhara Academy of Health Sciences", city: "Pokhara", phone: "061-570601" },
      { name: "Gandaki Medical College", city: "Pokhara", phone: "061-526111" },
      { name: "Dhaulagiri Hospital", city: "Baglung", phone: "068-520237" },
    ],
  },
  {
    name: "Lumbini Province",
    capital: "Deukhuri",
    districts: ["Rupandehi", "Kapilvastu", "Palpa", "Arghakhanchi", "Gulmi", "Nawalparasi (West)", "Pyuthan", "Rolpa", "Dang", "Banke", "Bardiya"],
    hospitals: [
      { name: "Lumbini Provincial Hospital", city: "Butwal", phone: "071-542195" },
      { name: "Bheri Hospital", city: "Nepalgunj", phone: "081-520166" },
    ],
  },
  {
    name: "Karnali Province",
    capital: "Birendranagar",
    districts: ["Surkhet", "Salyan", "Dailekh", "Jajarkot", "Dolpa", "Jumla", "Kalikot", "Mugu", "Humla"],
    hospitals: [
      { name: "Karnali Academy of Health Sciences", city: "Jumla", phone: "087-680207" },
      { name: "Mid-Western Regional Hospital", city: "Surkhet", phone: "083-520166" },
    ],
  },
  {
    name: "Sudurpashchim Province",
    capital: "Godawari",
    districts: ["Kailali", "Kanchanpur", "Dadeldhura", "Baitadi", "Darchula", "Bajhang", "Bajura", "Achham", "Doti"],
    hospitals: [
      { name: "Seti Provincial Hospital", city: "Dhangadhi", phone: "091-522200" },
      { name: "Mahakali Hospital", city: "Mahendranagar", phone: "099-520522" },
    ],
  },
];

export default function EmergencyNumbersPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-slate-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-amber-400 w-fit">
          <Mountain size={20} />
          <span className="font-display font-bold">YatraAI</span>
        </Link>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="flex items-center gap-3 mb-2">
          <Phone size={24} className="text-amber-400" />
          <h1 className="font-display text-3xl md:text-4xl font-bold">Emergency Numbers</h1>
        </div>
        <p className="font-body text-muted-foreground text-sm mb-10">
          National hotlines and province-wise emergency contacts for Nepal. Save these before your trip.
        </p>

        {/* National Numbers */}
        <section className="mb-12">
          <h2 className="font-display text-xl font-bold text-foreground mb-5 flex items-center gap-2">
            <Shield size={18} className="text-amber-400" />
            National Emergency Hotlines
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {NATIONAL_NUMBERS.map((item) => (
              <div key={item.number + item.service} className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-4 hover:border-amber-400/30 transition-colors">
                <div className="flex items-start gap-3">
                  <item.icon size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-display font-bold text-white">{item.service}</p>
                    <p className="font-body text-xs text-slate-400 mb-1.5">{item.desc}</p>
                    <a href={`tel:${item.number}`} className="font-mono text-lg font-bold text-green-400 hover:text-green-300 transition-colors">
                      {item.number}
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Province-wise hospitals */}
        <section>
          <h2 className="font-display text-xl font-bold text-foreground mb-5 flex items-center gap-2">
            <Building2 size={18} className="text-amber-400" />
            Province-wise Hospitals
          </h2>
          <div className="space-y-6">
            {PROVINCES.map((province) => (
              <details key={province.name} className="bg-slate-800/30 border border-slate-700/40 rounded-xl overflow-hidden group">
                <summary className="px-5 py-4 cursor-pointer hover:bg-slate-800/60 transition-colors flex items-center justify-between">
                  <div>
                    <h3 className="font-display font-bold text-white">{province.name}</h3>
                    <p className="font-body text-xs text-slate-500">{province.districts.length} districts · Capital: {province.capital}</p>
                  </div>
                  <MapPin size={16} className="text-slate-600 group-open:text-amber-400 transition-colors" />
                </summary>
                <div className="px-5 pb-5 space-y-4">
                  <div className="flex flex-wrap gap-1.5">
                    {province.districts.map((d) => (
                      <span key={d} className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 font-body text-[11px] text-slate-400">
                        {d}
                      </span>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {province.hospitals.map((h) => (
                      <div key={h.name} className="flex items-center justify-between bg-slate-800/40 rounded-lg px-3.5 py-2.5">
                        <div>
                          <p className="font-body text-sm text-white">{h.name}</p>
                          <p className="font-body text-xs text-slate-500">{h.city}</p>
                        </div>
                        <a href={`tel:${h.phone.replace(/\D/g, "")}`} className="font-mono text-sm text-green-400 hover:text-green-300 shrink-0">
                          {h.phone}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </div>
        </section>

        <p className="font-body text-xs text-slate-600 mt-12 text-center">
          Numbers sourced from Nepal Ministry of Health, Nepal Police, and NDRRMA. Verify locally before travel.
        </p>
      </main>
    </div>
  );
}
