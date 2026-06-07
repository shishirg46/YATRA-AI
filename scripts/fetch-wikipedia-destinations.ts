#!/usr/bin/env node

import "dotenv/config";
import { writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  normalizeName,
  findProvinceForDistrict,
  validateCoordinates,
  calculateQualityScore,
} from "../lib/destinations/validation";

const WIKI_REST = "https://en.wikipedia.org/api/rest_v1";
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const UA = "YatraAI/1.0 (wikipedia-fetch)";
const PROXIMITY_KM = 0.5;
const MAX_DESTINATIONS = 1500;

const CATEGORY_BLOCKLIST = new Set([
  "Articles with", "Coordinates on", "Pages with", "Wikipedia",
  "Commons category", "Official website", "All stub", "Stub articles",
  "Use dmy dates", "Use British English", "Short description",
  "AC with", "Webarchive", "CS1", "Pages using", "Infobox",
  "Geographic coordinate", "Hidden categories", "Articles containing",
  "Pages with broken", "All articles", "Articles needing",
  "Wikipedia articles", "Articles that may", "Articles with dead",
  "Articles incorporating", "Commons link", "Wikidata", "Featured articles",
  "Good articles", "Lists of", "Nepal geography", "Nepal stubs",
  "Asian mountain", "Asian geography", "CS1 Nepali", "CS1 uses",
]);

const NEPAL_DISTRICTS = [
  "Achham", "Arghakhanchi", "Baglung", "Baitadi", "Bajhang", "Bajura",
  "Banke", "Bara", "Bardiya", "Bhaktapur", "Bhojpur", "Chitwan",
  "Dadeldhura", "Dailekh", "Dang", "Darchula", "Dhading", "Dhankuta",
  "Dhanusha", "Dolakha", "Dolpa", "Doti", "Gorkha", "Gulmi",
  "Humla", "Ilam", "Jajarkot", "Jhapa", "Jumla", "Kailali",
  "Kalikot", "Kanchanpur", "Kapilvastu", "Kaski", "Kathmandu",
  "Kavrepalanchok", "Khotang", "Lalitpur", "Lamjung", "Mahottari",
  "Makwanpur", "Manang", "Morang", "Mugu", "Mustang", "Myagdi",
  "Nawalparasi", "Nawalpur", "Nuwakot", "Okhaldhunga", "Palpa",
  "Panchthar", "Parbat", "Parsa", "Pyuthan", "Ramechhap",
  "Rasuwa", "Rautahat", "Rolpa", "Rukum", "Rupandehi", "Salyan",
  "Sankhuwasabha", "Saptari", "Sarlahi", "Sindhuli", "Sindhupalchok",
  "Siraha", "Solukhumbu", "Sunsari", "Surkhet", "Syangja",
  "Tanahun", "Taplejung", "Terhathum", "Udayapur",
];

// ── Broad curated list of Nepal destinations ──
// Combined from: existing curated list, Wikipedia category research,
// district headquarters, major temples/lakes/mountains/treks, and tourism hotspots

const DESTINATION_LIST = [
  // ════════════════════════════════════════════════
  // World Heritage Sites & Cultural Landmarks
  // ════════════════════════════════════════════════
  "Kathmandu Durbar Square", "Patan Durbar Square", "Bhaktapur Durbar Square",
  "Swayambhunath", "Boudhanath", "Boudha Stupa", "Swayambhunath Stupa",
  "Pashupatinath Temple", "Changu Narayan", "Lumbini",
  "Kasthamandap", "Hanuman Dhoka Palace", "Patan Museum",
  "Taleju Temple", "Nyatapola Temple", "Kumbheshwar Temple",
  "Bindabasini Temple", "Dakshinkali Temple",
  "Nautalle Durbar", "Maju Dega", "Maru, Kathmandu",
  "Shiva Parvati Temple", "Singha Sattal",
  "Taleju Temple, Kathmandu", "Vidhyeshvari Vajra Yogini Temple",
  "Kaal Bhairav, Kathmandu",

  // ════════════════════════════════════════════════
  // National Parks & Protected Areas
  // ════════════════════════════════════════════════
  "Sagarmatha National Park", "Chitwan National Park",
  "Langtang National Park", "Makalu Barun National Park",
  "Shey Phoksundo National Park", "Bardiya National Park",
  "Khaptad National Park", "Rara National Park",
  "Banke National Park", "Parsa National Park",
  "Shuklaphanta National Park", "Shivapuri Nagarjun National Park",
  "Koshi Tappu Wildlife Reserve",
  "Annapurna Conservation Area", "Kanchenjunga Conservation Area",
  "Manaslu Conservation Area", "Gaurishankar Conservation Area",
  "Api Nampa Conservation Area", "Dhorpatan Hunting Reserve",

  // ════════════════════════════════════════════════
  // Mountains & Peaks
  // ════════════════════════════════════════════════
  "Mount Everest", "Ama Dablam", "Annapurna", "Manaslu",
  "Kanchenjunga", "Dhaulagiri", "Makalu", "Langtang Lirung",
  "Machapuchare", "Pumori", "Nuptse", "Lhotse", "Cho Oyu",
  "Gaurishankar", "Mera Peak", "Island Peak",
  "Lobuche East", "Lobuche West", "Tharpu Chuli",
  "Nilgiri", "Gangapurna", "Pisang Peak",
  "Chulu West", "Chulu East",
  "Hunku Chuli", "Tukuche Peak", "Khatung Kang",
  "Naya Kanga", "Singu Chuli",
  "Thapa Peak", "Tsergo Ri",

  // ════════════════════════════════════════════════
  // Trekking Routes & Base Camps
  // ════════════════════════════════════════════════
  "Annapurna Circuit", "Annapurna Base Camp", "Everest base camps",
  "Langtang Valley Trek", "Manaslu Circuit Trek",
  "Kanchenjunga Base Camp Trek", "Mustang Trek", "Dolpo Trek",
  "Annapurna Circuit Trek", "Everest Base Camp Trek",

  // ════════════════════════════════════════════════
  // Lakes
  // ════════════════════════════════════════════════
  "Phewa Lake", "Tilicho Lake", "Gokyo Lakes", "Phoksundo Lake",
  "Begnas Lake", "Rara Lake", "Gosaikunda", "Panch Pokhari",
  "Ghodaghodi Lake", "Rupa Lake",
  "Bulbule Lake", "Dhumba lake", "Kamal lake", "Timbung Pokhari",

  // ════════════════════════════════════════════════
  // Waterfalls
  // ════════════════════════════════════════════════
  "Rupse Falls", "Davis Falls", "Hyatung Falls", "Tindhare Waterfall",
  "Devi's Fall", "Jhor waterfall", "Lamo waterfall",
  "Mohini waterfall", "Namaste Falls", "Narchyang waterfall",
  "Pachal waterfall", "Pokali waterfall", "Purandhara waterfall",
  "Simba waterfall", "Todke waterfall",

  // ════════════════════════════════════════════════
  // Hill Stations & Viewpoints
  // ════════════════════════════════════════════════
  "Nagarkot", "Sarangkot", "Dhulikhel", "Kakani",
  "Shivapuri Hill", "Phulchowki", "Chandragiri Hill",
  "Poon Hill", "Kalinchowk", "Sailung",
  "Daman, Nepal", "Dhankuta", "Dunai, Nepal",
  "Ghalegaun", "Hile", "Bandipur",
  "Phidim Municipality", "Chandragiri, Nepal",

  // ════════════════════════════════════════════════
  // Temples & Religious Sites
  // ════════════════════════════════════════════════
  "Manakamana Temple", "Muktinath", "Tengboche Monastery",
  "Pathibhara Devi Temple", "Pathivara Temple",
  "Halesi Mahadev", "Swargadwari", "Rani Mahal",
  "Baraha Kshetra", "Bageshwari Temple",
  "Bhadrakali Temple", "Kailashnath Mahadev Statue",
  "Pumdikot Shiva Statue", "Phugmoche Monastery",
  "Mithila Bihari Mandir", "Sankata Temple",
  "Lhakhang", "Agnishala, Patan",
  "Kamalamai Temple (Sindhuli)", "Tripura Sundari Temple, Nepal",

  // ════════════════════════════════════════════════
  // Caves
  // ════════════════════════════════════════════════
  "Mahendra Cave", "Bat Cave", "Gupteshwor Cave",

  // ════════════════════════════════════════════════
  // Valleys
  // ════════════════════════════════════════════════
  "Kathmandu Valley", "Pokhara Valley", "Kali Gandaki Valley",
  "Upper Mustang",

  // ════════════════════════════════════════════════
  // Cities & Major Towns
  // ════════════════════════════════════════════════
  "Kathmandu", "Bhaktapur", "Patan", "Kirtipur",
  "Pokhara", "Bharatpur", "Hetauda",
  "Biratnagar", "Janakpur", "Nepalgunj",
  "Dharan", "Butwal", "Bhairahawa", "Itahari", "Damak",
  "Surkhet", "Tansen, Nepal", "Gorkha",
  "Kapilvastu", "Lalitpur", "Birendranagar",

  // ════════════════════════════════════════════════
  // Trekking Villages & Stops (Annapurna Region)
  // ════════════════════════════════════════════════
  "Ghandruk", "Chhomrong", "Sinuwa", "Dovan", "Himalaya",
  "Deurali", "Dhampus", "Ghorepani", "Tadapani",
  "Bagarchhap", "Chame", "Pisang", "Bhratang",
  "Manang", "Thorung Phedi", "Muktinath",
  "Ghasa", "Tatopani", "Beni", "Dana",
  "Dharapani", "Besishahar", "Syanje", "Jagat",

  // ════════════════════════════════════════════════
  // Trekking Villages & Stops (Everest Region)
  // ════════════════════════════════════════════════
  "Namche Bazaar", "Lukla", "Tengboche", "Pheriche",
  "Gorak Shep", "Gokyo",
  "Phakding", "Khumjung",
  "Fakding",

  // ════════════════════════════════════════════════
  // Trekking Villages (Langtang Region)
  // ════════════════════════════════════════════════
  "Syaphrubesi", "Rimche", "Thulo Syabru",
  "Sing Gompa", "Kyanjin Gompa", "Chisapani",
  "Bamboo",

  // ════════════════════════════════════════════════
  // Trekking Villages & Stops (Mustang / Upper Mustang)
  // ════════════════════════════════════════════════
  "Jomsom", "Marpha", "Kagbeni", "Lo Manthang",
  "Lomanthang Rural Municipality",

  // ════════════════════════════════════════════════
  // Eastern Nepal Destinations
  // ════════════════════════════════════════════════
  "Kanyam", "Ilam", "Ilam Municipality", "Jiri",
  "Charikot", "Salleri",
  "Bhojpur, Nepal", "Chainpur, Bhojpur",
  "Phungling Municipality", "Taplejung",
  "Fikkal", "Mai Pokhari",

  // ════════════════════════════════════════════════
  // Mid-Western & Far-Western Destinations
  // ════════════════════════════════════════════════
  "Kusma", "Kavre", "Panauti",
  "Patan Durbar Square", "Nuwakot Durbar",
  "Sindhuli Madi", "Dolakha Town, Nepal",
  "Amritpur, Nepal", "Hunga, Nepal",

  // ════════════════════════════════════════════════
  // Museums, Palaces & Monuments
  // ════════════════════════════════════════════════
  "Patan Museum", "Hanuman Dhoka Palace",
  "Narayanhiti Palace Museum", "Gurkha Memorial Park",
  "Gurkha Durbar",

  // ════════════════════════════════════════════════
  // Ramsar Sites & Wetlands
  // ════════════════════════════════════════════════
  "Koshi Tappu Wildlife Reserve",
  "Jagdishpur Reservoir", "Bishazari Tal",
  "Ghodaghodi Lake", "Gokyo Lakes",

  // ════════════════════════════════════════════════
  // Gardens & Parks
  // ════════════════════════════════════════════════
  "Garden of Dreams", "Shiva Park",
  "Ratna Park, Kathmandu",

  // ════════════════════════════════════════════════
  // Archaeological Sites
  // ════════════════════════════════════════════════
  "Lumbini", "Tilaurakot",
  "Sinja Valley",

  // ════════════════════════════════════════════════
  // Rivers
  // ════════════════════════════════════════════════
  "Koshi River", "Gandaki River", "Karnali River",
  "Trishuli River", "Marshyangdi River", "Kaligandaki River",
  "Sunkoshi River", "Tamur River", "Arun River",
  "Bhotekoshi River", "Indrawati River",
  "Bagmati River", "Bishnumati River",
  "Manohara River",

  // ════════════════════════════════════════════════
  // Passes
  // ════════════════════════════════════════════════
  "Thorong La", "Cho La", "Renjo La",

  // ════════════════════════════════════════════════
  // Monasteries
  // ════════════════════════════════════════════════
  "Tengboche Monastery", "Kopan Monastery",
  "Shechen Monastery", "Boudha Stupa",
  "Swayambhunath", "Namobuddha",
  "Halesi Mahadev",
  "Pharping",
  "Matepani Gumba",

  // ════════════════════════════════════════════════
  // Local Favorites & Hidden Gems
  // ════════════════════════════════════════════════
  "Chabahil", "Baluwatar, Kathmandu",
  "Kirtipur", "Chovar Gorge",
  "Godavari, Nepal", "Budhanilkantha",
  "Sundarijal", "Taudaha Lake",
  "Thankot", "Chandragiri Hills",
  "Patan Industrial District", "Gwarko",

  // ════════════════════════════════════════════════
  // Additional Tourism Sites (from Wikipedia research)
  // ════════════════════════════════════════════════
  "Annapurna Circuit Trek",
  "Jamunkhadi Simsar", "Kundahar", "Larumba",
  "Lumbini Crane Sanctuary", "Najarpur",
  "Pharping", "Pokhara",
  "Tourism in Pokhara",
  "Siddha Cave",
  "Chamere Gufa",
  "Chitwan National Park", "Bardiya National Park",
  "Shuklaphanta National Park",
  "Rara Lake", "Khaptad National Park",
  "Shivaraj, Nepal",
  "Siraichuli",

  // ════════════════════════════════════════════════
  // More towns across all provinces
  // ════════════════════════════════════════════════
  "Gaighat", "Lahan", "Rajbiraj",
  "Inaruwa", "Bhadrapur",
  "Birtamod", "Mechinagar",
  "Damak", "Urlabari",
  "Rangeli", "Koshi Haraicha",
  "Mangalbare", "Letang",
  "Jaleshwar, Nepal", "Gaushala",
  "Malangwa", "Siraha, Nepal",
  "Sukhipur", "Dhanusha",
  "Kamalamai", "Kapilvastu Municipality",
  "Ramgram", "Sunaul",
  "Bardaghat", "Gorkha Municipality",
  "Ghanpokhara", "Besisahar",
  "Rampur, Palpa", "Sandhikhark",
  "Tansen, Nepal", "Shivaraj, Nepal",
  "Ghorahi", "Lamahi",
  "Narayanpur, Dang",
  "Gulariya", "Rajapur, Nepal",
  "Bansgadhi", "Thakurdwara",
  "Birendranagar", "Gurbhakot",
  "Panchapuri", "Lekbeshi",
  "Bheri, Nepal", "Chaurjahari",
  "Tulsipur, Dang",
  "Baglung, Nepal", "Beni, Nepal",
  "Galyang", "Chapakot",
  "Putalibazar", "Waling",
  "Syangja", "Kusma",
  "Burtibang",
  "Dhorpatan",

  // ════════════════════════════════════════════════
  // Additional lakes, viewpoints, nature
  // ════════════════════════════════════════════════
  "Khadakwasla Lake",
  "Shanti Stupa, Pokhara",
  "International Mountain Museum",
  "Pokhara Museum",
  "Begnas Lake", "Rupa Tal",
  "Dipang Lake", "Khaste Lake",
  "Gunde Lake",
  "Kali Gandaki Gorge",
  "Andha Katti",
  "Borlang",
  "Bhanjyang, Nuwakot",
  "Bhairabkunda",
  "Chimdi Lake",
  "Bishahazari Tal",

  // ════════════════════════════════════════════════
  // More mountains & hiking peaks
  // ════════════════════════════════════════════════
  "Hiunchuli", "Singuchuli",
  "Gandharwa Chuli",
  "Stok Kangri",
  "Dhaulagiri II", "Dhaulagiri III", "Dhaulagiri IV",
  "Jannu", "Kabru",
  "Kirat Chuli", "Nepal Peak",
  "Mount Kangchenjunga",
  "Yalung Kang", "Mount Jomolhari",

  // ════════════════════════════════════════════════
  // Additional villages and rural tourism
  // ════════════════════════════════════════════════
  "Sirubari", "Bandipur",
  "Ghandruk", "Ghale Gaun",
  "Barpak", "Trishuli Bazaar",
  "Mangaltar", "Kalinchok",
  "Panauti", "Balthali",
  "Nagarkot", "Kakani",
  "Daman, Nepal", "Kushma",
  "Raniban",
  "Champadevi",
  "Bhardeo, Lalitpur",
  "Bishankhu Narayan",

  // ════════════════════════════════════════════════
  // Hot springs
  // ════════════════════════════════════════════════
  "Tatopani, Myagdi",
  "Tatopani, Jumla",
  "Bhairavsthan",
  "Helambu",
  "Panch Pokhari",
  "Jalbin",
  "Saldhunga",
  "Chichila",
  "Khandbari",
  "Num, Nepal",
  "Sedua",
  "Ghumthang",
  "Chatara",
  "Barahakshetra",

  // ════════════════════════════════════════════════
  // District Headquarters (missing from above)
  // ════════════════════════════════════════════════
  "Mangalsen", "Sandhikhark", "Dasharathchand", "Jayaprithvi",
  "Martadi", "Kalaiya", "Dadeldhura", "Dailekh",
  "Dhading Besi", "Dipayal Silgadhi", "Simikot", "Bheri Khalanga",
  "Chandannath, Jumla", "Dhangadhi", "Manma", "Bhimdatta",
  "Diktel", "Gamgadhi", "Bidur, Nepal",
  "Okhaldhunga", "Siddhicharan", "Birgunj",
  "Pyuthan Khalanga", "Manthali", "Dhunche", "Gaur, Nepal",
  "Liwang", "Rukumkot", "Musikot",
  "Siddharthanagar", "Shaarad", "Chautara",
  "Inaruwa, Nepal", "Damauli", "Myanglung",
  "Triyuga", "Gaighat",

  // ════════════════════════════════════════════════
  // Additional cities, towns and urban centers
  // ════════════════════════════════════════════════
  "Kalaiya", "Nilkantha", "Kawasoti", "Resunga",
  "Siddharthanagar", "Bhairawaha",
  "Thamel", "Jhamsikhel", "Jawalakhel",
  "Pulchowk, Lalitpur", "Kupondole", "Naxal, Kathmandu",
  "Maharajgunj, Kathmandu", "Balaju", "Kalanki",
  "Sauraha", "Meghauli", "Gaidakot", "Shaktikhor",
  "Thakurdwara, Bardiya", "Nagarjun, Nepal",
  "Trishuli", "Rampur, Chitwan",
  "Khaireni", "Mugling",

  // ════════════════════════════════════════════════
  // More mountains & trekking peaks
  // ════════════════════════════════════════════════
  "Baruntse", "Chamlang", "Chomo Lonzo",
  "Thamserku", "Kusum Kanguru", "Kangtega",
  "Taboche", "Cholatse",
  "Kala Patthar", "Gokyo Ri", "Chukung Ri",
  "Lingtren", "Khumbutse", "Changtse",
  "Api, Nepal", "Mount Saipal",
  "Kanjiroba", "Mount Sisne",
  "Mount Pumori", "Gyachung Kang",
  "Himalchuli", "Ngadi Chuli",
  "Mount Ganesh", "Salasungo",

  // ════════════════════════════════════════════════
  // More trekking routes & trails
  // ════════════════════════════════════════════════
  "Tamang Heritage Trail", "Tsum Valley Trek",
  "Nar Phu Valley", "Khopra Ridge",
  "Mohare Danda", "Panchase",
  "Pikey Peak", "Everest View Trek",
  "Gokyo Renjo La Trek", "Three Passes Trek",
  "Great Himalaya Trail",
  "Makalu Base Camp Trek", "Rara Lake Trek",
  "Ruby Valley Trek", "Limpi Valley Trek",

  // ════════════════════════════════════════════════
  // More trekking villages
  // ════════════════════════════════════════════════
  "Birethanti", "Nayapul", "Tikhedhunga", "Ulleri",
  "Banthanti", "Nangge", "Dobato",
  "Siprong", "Ghandruk", "Landruk",
  "Ghandruk", "Gurjung", "Bargurung",
  "Soti, Nepal", "Narchyang",
  "Nar, Nepal", "Phu, Nepal",
  "Kyeng", "Samar, Nepal",
  "Hilsa, Nepal", "Yari, Nepal",
  "Dharapani, Manang", "Timang, Nepal",
  "Thanchowk", "Danakyu",
  "Ghyaru", "Ngawal",
  "Bhujung", "Ghalegaun",
  "Kali, Nepal", "Sikles, Nepal",
  "Panchase", "Bhumichowk",

  // ════════════════════════════════════════════════
  // More lakes
  // ════════════════════════════════════════════════
  "Lake Cluster of Pokhara",
  "Ghadar Kunda", "Pathar Kanda",
  "Sat Tal, Nepal",
  "Foksundo Lake",
  "Surya Kund", "Bhairav Kund",
  "Chimdi Lake", "Kusum Lake",
  "Dhaneswor Lake", "Sarada River",
  "Khadakwasla", "Bishazari Tal",
  "Jagatpur Lake", "Bejarnath Lake",
  "Budhi Khola", "Bakraha River",

  // ════════════════════════════════════════════════
  // More temples & religious sites
  // ════════════════════════════════════════════════
  "Devghat", "Triveni, Nepal",
  "Sitala Mai Temple", "Shashwat Dham",
  "Doleshwar Mahadev", "Mahananda",
  "Mahamrityunjaya Temple, Nepal",
  "Manohara, Nepal",
  "Sundar Mata Ka Mandir",
  "Nageshwari Temple", "Maihi Temple",
  "Bishankhu Narayan", "Bishnu Devi",
  "Sankhamul, Patan",
  "Bagh Bhairab Temple",
  "Bhimsen Temple, Patan",
  "Krishna Mandir, Patan",
  "Golden Temple, Patan",
  "Manga Hiti, Patan",
  "Adinath Temple",
  "Jal Binayak Temple", "Chobhar Gorge",
  "Chabahil Stupa",

  // ════════════════════════════════════════════════
  // Monasteries
  // ════════════════════════════════════════════════
  "Thrangu Tashi Yangtse Monastery",
  "Karma Shri Nalanda Monastery",
  "International Buddhist Academy",
  "Jangchub Choeling Monastery",
  "Seto Gumba",
  "Amitabha Monastery, Nepal",
  "Chorten, Nepal",

  // ════════════════════════════════════════════════
  // Museums & Cultural Sites
  // ════════════════════════════════════════════════
  "National Museum of Nepal",
  "Natural History Museum of Nepal",
  "Tribhuvan Museum",
  "Mahendra Museum",
  "Chhauni Museum",
  "City Museum, Patan",
  "Railway Museum, Janakpur",

  // ════════════════════════════════════════════════
  // Parks, Gardens & Recreation
  // ════════════════════════════════════════════════
  "Godawari Botanical Garden",
  "Shiva Park, Kathmandu",
  "Fun Park, Kathmandu",
  "Nagarjun Forest Reserve",
  "Chandragiri Hills, Kathmandu",
  "Parnashala, Dang",

  // ════════════════════════════════════════════════
  // More waterfalls
  // ════════════════════════════════════════════════
  "Pachabhaiya Waterfall",
  "Sahid Smriti Waterfall",
  "Bharat Pokhari Waterfall",

  // ════════════════════════════════════════════════
  // Sunsari, Udayapur & Eastern more places
  // ════════════════════════════════════════════════
  "Koshi Barrage",
  "Chatara, Sunsari",
  "Koshi Tappu",
  "Birat Chowk",
  "Charkose Jhadi",
  "Morang, Nepal",

  // ════════════════════════════════════════════════
  // Adventure & Sports Sites
  // ════════════════════════════════════════════════
  "Bungee Jumping in Nepal",
  "ZipFlyer Nepal",
  "Ultimate Rush Pokhara",
  "White Water Rafting in Nepal",
  "Phoksundo Lake Biking",
  "Elephant Breeding Center",

  // ════════════════════════════════════════════════
  // Hot Springs & Wellness
  // ════════════════════════════════════════════════
  "Myagdi Tatopani",
  "Rasuwa Tatopani",
  "Dolpa Tatopani",
  "Bhurkia, Nepal",
  "Saldhunga, Nepal",
  "Jalbin, Nepal",
  "Chichila, Nepal",

  // ════════════════════════════════════════════════
  // Border Towns & Transit Points
  // ════════════════════════════════════════════════
  "Kakarbhitta",
  "Bhairahawa Transit Point",
  "Nepalgunj Transit Point",
  "Kodari, Nepal",
  "Rasuwa Gadhi",
  "Banbasa, Nepal",
  "Gaddachauki",
  "Jogbani, Nepal",
  "Rani, Nepal",
  "Naxalbari, Nepal",

  // ════════════════════════════════════════════════
  // Rural & Community Tourism Villages
  // ════════════════════════════════════════════════
  "Okharbot, Kaski", "Tangting",
  "Lwang, Kaski", "Kumpur",
  "Silinge", "Rupakot",
  "Bhadaure Tamagaon",
  "Nayabazar, Kaski",
  "Syagja",
  "Arthunge, Myagdi",
  "Dowa, Myagdi",
  "Takam, Myagdi",
  "Tatopani, Baglung",
  "Khibang",
  "Raha, Nepal",
  "Pina, Nepal",
  "Gajarkot",
  "Karkineta",

  // ════════════════════════════════════════════════
  // More forests & conservation areas
  // ════════════════════════════════════════════════
  "Suklaphanta National Park",
  "Bardia National Park",
  "Koshi Tappu Wildlife Reserve",
  "Dhorpatan Hunting Reserve",
  "Api Nampa Conservation Area",
  "Krishna Sarowar",
  "Sivaha, Nepal",

  // ════════════════════════════════════════════════
  // Heritage and Historical
  // ════════════════════════════════════════════════
  "Simroungadh", "Khadbadevi",
  "Mithila region",
  "Lo Tsho Dhyang",
  "Rukum Durbar",
  "Palpa Durbar",
  "Bajhang Durbar",
  "Doti Durbar",
  "Jumla Durbar",
  "Karnali Province",
  "Arghakhanchi Durbar",

  // ════════════════════════════════════════════════
  // More 6000m+ & 7000m+ mountains
  // ════════════════════════════════════════════════
  "Annapurna II", "Annapurna III",
  "Annapurna IV", "Annapurna South",
  "Gangapurna", "Machapuchare",
  "Nemjung", "Himlung Himal",
  "Mount Ganesh I", "Mount Ganesh II",
  "Mount Ganesh III", "Mount Ganesh IV",
  "Salasungo", "Shringi",
  "Langtang Lirung", "Langtang Ri",
  "Dorje Lakpa", "Kimshung",
  "Nampa, Nepal", "Byas Rishi",
  "Churen Himal", "Putha Hiunchuli",
  "Gaurishankar", "Melungtse",
  "Kabru", "Talung",
  "Tenchenkhang", "Jannu",
  "Kumbhakarna", "Rimo I",
  "Rimo III", "Teram Kangri I",
  "Saser Kangri I", "Mamostong Kangri",
  "Mount Gauri Sankar",
  "Sita Chuchura", "Ombigaichan",
  "Mount P 33", "Boku Peak",
  "Khung Kang", "Kangri",
  "Baintha Brakk", "Latok I",
  "Latok II", "Latok III",
  "Mount Urdok", "Saltoro Kangri",
  "Chogolisa", "Masherbrum",
  "Mount Kailash",
  "Api Himal", "Jethi Bahurani",
  "Bobaye, Nepal", "Dhaulagiri II",
  "Dhaulagiri III", "Dhaulagiri IV",
  "Dhaulagiri V", "Dhaulagiri VI",
  "Churen Himal",
  "Annapurna Dakshin",
  "Hiunchuli",
  "Tukche Peak",
  "Dhampus Peak",
  "Singu Chuli",
  "Tharpu Chuli",
  "Fang, Nepal",
  "Mardi Himal",
  "Pisang Peak",
  "Chulu Peak",
  "Fluted Peak",
  "Mount Everest North",
  "Kangshung Face",
  "Mera Peak",
  "Island Peak",
  "Lobuche East",
  "Lobuche West",
  "Nirekha",
  "Kyashar",
  "Kwangde",
  "Mount Ama Dablam",
  "Mount Lhotse Shar",
  "Nuptse",
  "Imja Tse",
  "Cho Oyu, Nepal",
  "Awi Peak",
  "Barpak, Nepal",
  "Mount Makalu II",
  "Chago, Nepal",
  "Peak 38",
  "Peak 39",
  "Peak 41, Nepal",
  "Langkang",
  "Pokhari, Solukhumbu",
  "Thyangbo",
  "Chukhung",
  "Dingboche",
  "Pangboche",
  "Phortse",
  "Tengboche",
  "Deboche",
  "Milinggo, Nepal",
  "Thame, Nepal",
  "Lungdhen",
  "Marulung, Nepal",
  "Chamlang",
  "Peak 6",
  "Peak 7, Nepal",

  // ════════════════════════════════════════════════
  // More towns, villages & settlements
  // ════════════════════════════════════════════════
  "Besisahar",
  "Dumre",
  "Chame, Nepal",
  "Pisang",
  "Manang, Nepal",
  "Humde, Nepal",
  "Gorakh, Nepal",
  "Jagat, Nepal",
  "Dharapani, Nepal",
  "Bagarchhap",
  "Tatopani, Mustang",
  "Ghasa, Nepal",
  "Kobang",
  "Samagaun, Nepal",
  "Sartap, Nepal",
  "Syabru, Nepal",
  "Syabrubesi",
  "Lama Hotel",
  "Rimche",
  "Thulo Syabru",
  "Sing Gompa",
  "Chandanbari",
  "Mundhum, Nepal",
  "Chandrakot, Nepal",
  "Ramche",
  "Tatopani, Myagdi",
  "Dana, Nepal",
  "Rupse, Nepal",
  "Sikha, Nepal",
  "Mudhe, Myagdi",
  "Paudwar, Nepal",
  "Bhurjung, Nepal",
  "Khor, Nepal",
  "Dhaiban, Nepal",
  "Siurung, Nepal",
  "Ampipal",
  "Bansar, Nepal",
  "Deurali, Gorkha",
  "Bhachek, Nepal",
  "Saurpani, Nepal",
  "Mankamana",
  "Anbu Khaireni",
  "Kyang, Nepal",
  "Gumba, Nepal",
  "Thakre, Nepal",
  "Bhumredanda",
  "Khanigaun, Nepal",
  "Khoplang, Nepal",
  "Manakamana, Gorkha",
  "Kashigaun, Nepal",
  "Arukharka",
  "Chhoprak, Gorkha",
  "Asrang, Nepal",
  "Hawang, Nepal",
  "Khorla, Nepal",
  "Chiuri, Gorkha",
  "Bihadi, Parbat",
  "Falebas",
  "Thuli Pokhari",
  "Kurkot, Parbat",
  "Shankar, Nepal",
  "Deupur, Parbat",
  "Kuine, Nepal",
  "Chitre, Parbat",
  "Lunkhu Deurali",
  "Bachchha, Nepal",
  "Taklak, Nepal",
  "Ambote, Nepal",
  "Bharlam, Nepal",
  "Karkineta, Parbat",
  "Chaurikot, Parbat",
  "Pakhapatan, Parbat",
  "Shankhar, Nepal",
  "Gorkha, Nepal",
  "Palungtar",
  "Bharatpur, Chitwan",
  "Rapti, Nepal",
  "Madi, Chitwan",
  "Ichchhakamana",
  "Bharatpur Metropolitan",
  "Bharatpur, Nepal",
  "Khairahani",
  "Chitwan, Nepal",
  "Ratnanagar",
  "Bhangaha",
  "Siraha, Nepal",
  "Siraha Bazar",
  "Lahan, Nepal",
  "Padhariya, Nepal",
  "Golbazar, Nepal",
  "Mirchaiya",
  "Nawalpur, Nepal",
  "Hupsekot, Nawalpur",
  "Binayi Triveni",
  "Bulingtar",
  "Baudikali, Nawalparasi",
  "Rani, Nawalparasi",
  "Nijgadh",
  "Prasauni",
  "Kolhabi, Nepal",
  "Garuda, Nepal",
  "Paroha, Nepal",
  "Simara, Nepal",
  "Basbitti, Nepal",
  "Karaiyamai",
  "Devtal, Nepal",
  "Pachrauta",
  "Baragadhi",
  "Sapahi, Nepal",
  "Sonma, Nepal",
  "Naraha, Nepal",
  "Bishnupur, Sirha",
  "Lakshmipur, Siraha",
  "Sakhuwanankar",
  "Arnama, Nepal",
  "Bodhe Barsain",
  "Bariyarpatti",
  "Ramnagar, Mirchaiya",
  "Babiya, Nepal",
  "Mahuwa, Nepal",
  "Bara, Nepal",
  "Mahagadhimai",
  "Bishrampur, Bara",
  "Pheta, Nepal",
  "Parwanipur",
  "Thori, Nepal",
  "Prasauni, Nepal",
  "Pakadiya, Nepal",
  "Bhawanipur, Kalaiya",
  "Rampurwa, Nepal",
  "Sagarmala, Nepal",
  "Belwa, Nepal",
  "Dohari, Nepal",
  "Devdaha, Nepal",
  "Dudhrakshya",
  "Amuwa, Nepal",
  "Bijayani, Nepal",
  "Betahani, Nepal",
  "Dhakhwa, Nepal",
  "Phulwariya, Nepal",
  "Rangasidhi",
  "Bhimghatta, Nepal",
  "Karauta, Nepal",
  "Binauna, Nepal",
  "Jilmila, Nepal",
  "Lalmatiya, Nepal",
  "Barkulpur, Nepal",
  "Sagarpalwa, Nepal",
  "Bela, Lumbini",
  "Ganapur, Nepal",
  "Lamatikhiya",
  "Bansar, Lumbini",
  "Hamsapur, Nepal",
  "Bishweshwar, Nepal",
  "Guthi, Nepal",
  "Sundar Bazar, Lamjung",
  "Mohoriyakot",
  "Sablakot",
  "Sundar Bazar",
  "Gauda, Nepal",
  "Dudhpokhari",
  "Simbuwa",
  "Pawakhola",
  "Madi, Khotang",
  "Santeshwar",
  "Khimdi, Nepal",
  "Mahuwa, Khotang",
  "Kattike, Nepal",
  "Halesi Tuwachung",
  "Tuwachung",
  "Bung, Nepal",
  "Karneshwar, Nepal",
  "Diware, Nepal",
  "Aiselukharka, Khotang",
  "Bhalayadanda",
  "Lekhani, Khotang",
  "Sakela, Nepal",
  "Chisapani, Khotang",
  "Dhapuk, Nepal",
  "Sungdel, Nepal",
  "Dhadbhanjyang",
  "Badaka, Nepal",
  "Mude, Nepal",
  "Mahadevsthan, Khotang",
  "Sukra, Nepal",
  "Rupakot, Khotang",
  "Balakhu, Nepal",
  "Rakha Bangdel",
  "Lichi, Nepal",
  "Khiwang, Nepal",
  "Lamabagar",
  "Bigau, Nepal",
  "Margin, Nepal",
  "Bhagawatimai",
  "Baiteshwar, Nepal",
  "Dolakha, Nepal",
  "Sunkhani",
  "Sundrawati",
  "Jalpa, Dolakha",
  "Gaurishankar, Dolakha",
  "Kalinchok, Dolakha",
  "Melung, Dolakha",
  "Marbu, Nepal",
  "Chandeni, Nepal",
  "Sukajor, Nepal",
  "Bhimsen, Gorkha",
  "Aanpu, Nepal",
  "Siranchok, Nepal",
  "Ghyalchok, Nepal",
  "Tanglichok",
  "Darbhung, Nepal",
  "Jaubari, Nepal",
  "Bhumichok, Gorkha",
  "Tandrang, Nepal",
  "Simjung, Nepal",
  "Chumchet, Nepal",
  "Chhechhet, Nepal",
  "Tinman, Nepal",
  "Bihi, Nepal",
  "Jagat, Gorkha",
  "Philim, Nepal",
  "Deng, Nepal",
  "Lapgaun, Nepal",
  "Sahare, Nepal",
  "Tibet, Nepal",
  "Gumba, Gorkha",
  "Yak, Nepal",
  "Rukumkot, Rukum",
  "Chhiwang, Nepal",
  "Gothichaur",
  "Ranimahal, Rukum",
  "Jhula, Rukum",
  "Pipalkot, Rukum",
  "Athbiskot",
  "Dulikot, Nepal",
  "Bangabagar",
  "Tatopani, Jumla",
  "Patarasi, Jumla",
  "Desh, Nepal",
  "Kamalbazar, Jumla",
  "Tilagufa, Nepal",
  "Gothi, Nepal",
  "Bundu, Nepal",
  "Padmashakti",
  "Khotila, Nepal",
  "Sinja, Nepal",
  "Dillichaur",
  "Kalika, Nepal",
  "Narayanapur, Jumla",
  "Hagga, Nepal",
  "Tila, Nepal",
  "Bichuwa, Nepal",
  "Guru, Nepal",
  "Kartikswami",
  "Ghumkhawar",
  "Chhinchu, Nepal",
  "Birendranagar, Nepal",
  "Birendra Nagar",
  "Babharkhola",
  "Sirkot, Nepal",
  "Chaukhune, Nepal",
  "Chhilowana",
  "Pulap, Nepal",
  "Jayakeshavi, Nepal",
  "Phattepur, Nepal",
  "Karkada, Nepal",
  "Mahakali, Kalikot",
  "Kotla, Nepal",
  "Kalikot, Nepal",
  "Sannai, Nepal",
  "Sukatiya, Nepal",
  "Sigha, Nepal",
  "Jubitha, Nepal",
  "Maha, Nepal",
  "Ramu, Nepal",
  "Mugra, Nepal",
  "Sipkhana",
  "Narakot, Nepal",
  "Daha, Nepal",
  "Thirpuram, Nepal",
  "Basantasreni",
  "Shantadurga",
  "Kamala, Nepal",
  "Simi, Nepal",
  "Khaluwa, Nepal",
  "Thin, Nepal",
  "Sorla, Nepal",
  "Mohan, Nepal",
  "Milekh, Nepal",
  "Phinemma, Nepal",
  "Kaikhor, Nepal",
  "Kashmigaun",
  "Oligaun, Nepal",
  "Tukucha, Nepal",
  "Goganpani",
  "Dharampur, Baglung",
  "Chandrakot, Baglung",
  "Amalachaur, Baglung",
  "Pala, Baglung",
  "Nisi, Baglung",
  "Pandavkhani",
  "Kandra, Nepal",
  "Binu, Baglung",
  "Bihadi, Baglung",
  "Karkineta, Baglung",
  "Dhadhuwa, Nepal",
  "Sahapur, Baglung",
  "Devisthan, Baglung",
  "Dhulachaur",
  "Suwarna, Nepal",
  "Jaljala, Parbat",
  "Lukrum, Nepal",
  "Bashari, Nepal",
  "Hupse, Nepal",
  "Rambhat, Nepal",
  "Uttarganga, Nepal",
  "Hasuwa, Nepal",
  "Sagarmatha, Khotang",
  "Lamidada, Nepal",
  "Mainatar, Nepal",
  "Bardanda, Nepal",
  "Mahadevasthana",
  "Jalpa, Khotang",
  "Khotang, Nepal",
  "Phedi, Khotang",
  "Buipa, Nepal",
  "Bhakshidevi, Nepal",
  "Chiuri Danda",
  "Chainpur, Bajhang",
  "Kedarsyu, Nepal",
  "Delekh, Nepal",
  "Mahadeva, Bajhang",
  "Rayal, Nepal",
  "Sunikot, Nepal",
  "Talkot, Nepal",
  "Jayaprithvi, Bajhang",
  "Bajhang, Nepal",
  "Chhanna, Nepal",
  "Mashta, Nepal",
  "Dhabala, Nepal",
  "Loli, Nepal",
  "Kailash, Bajhang",
  "Patadev, Nepal",
  "Sunkuda, Nepal",
  "Sipalgaun, Nepal",
  "Paralek, Nepal",
  "Bhek, Nepal",
  "Buwa, Nepal",
  "Shilang, Nepal",
  "Mahadevsthan, Bajhang",
  "Tallo, Nepal",
  "Mailek, Nepal",
  "Simal, Nepal",
  "Seuti, Nepal",
  "Duhun, Nepal",
  "Ghodasain, Nepal",
  "Suni, Nepal",
  "Pokhari, Bajhang",
  "Kotabasti, Nepal",
  "Rithapata",
  "Pauwagadhi",
  "Badimalika, Bajura",
  "Bajura, Nepal",
  "Dandakot, Nepal",
  "Kolti, Nepal",
  "Bichhaya, Nepal",
  "Gudikot, Nepal",
  "Budhinanda, Nepal",
  "Swami, Nepal",
  "Manakot, Nepal",
  "Sapata, Nepal",
  "Dahabagar, Nepal",
  "Shibanath, Nepal",
  "Baidhyanath, Nepal",
  "Matela, Nepal",
  "Durga, Nepal",
  "Bhagaban, Nepal",
  "Bamnito, Nepal",
  "Kalik, Nepal",
  "Pilas, Nepal",
  "Chhata, Nepal",
  "Lami, Nepal",
  "Rugin, Nepal",
  "Marthadi, Nepal",
  "Jaljala, Bajhang",
  "Surma, Nepal",
  "Suna, Nepal",
  "Kuldev, Nepal",
  "Shivalaya, Nepal",
  "Dasharathpur, Nepal",
  "Phyak, Nepal",
  "Rishi, Nepal",
  "Mahakali, Nepal",
  "Bhimdatta, Nepal",
  "Kanchanpur, Nepal",
  "Dodhara, Nepal",
  "Chandani, Nepal",
  "Suda, Nepal",
  "Jhalari, Nepal",
  "Pipaladi, Nepal",
  "Raikawar, Nepal",
  "Belchautara, Nepal",
  "Nagarjuna, Dadeldhura",
  "Bhageshwar, Dadeldhura",
  "Sirsha, Nepal",
  "Ajameru, Nepal",
  "Kabhre, Dadeldhura",
  "Alital, Nepal",
  "Dadeldhura, Nepal",
  "Sama, Nepal",
  "Chiuri, Dadeldhura",
  "Gulyam, Nepal",
  "Rupal, Nepal",
  "Bhadrapur, Nepal",
  "Barhabise, Sindhupalchok",
  "Melamchi, Sindhupalchok",
  "Indrawati, Sindhupalchok",
  "Bhotekoshi, Nepal",
  "Balephi, Nepal",
  "Sindhupalchok, Nepal",
  "Jalbire, Nepal",
  "Pangtang, Nepal",
  "Thokarpa, Nepal",
  "Fulping, Nepal",
  "Banskharkapur",
  "Chokati, Nepal",
  "Gunsakot, Nepal",
  "Selang, Nepal",
  "Bansbari, Sindhupalchok",
  "Bhimtar, Nepal",
  "Dhusa, Nepal",
  "Dubachaur, Nepal",
  "Chautara, Sindhupalchok",
  "Mangkha, Nepal",
  "Panchkhal, Nepal",
  "Batase, Sindhupalchok",
  "Thulo Pakhar",
  "Bhumlutar, Nepal",
  "Sunkhani, Sindhupalchok",
  "Hagam, Nepal",
  "Kunchok, Nepal",
  "Batar, Nepal",
  "Tatopani, Sindhupalchok",
  "Jagat, Sindhupalchok",
  "Khadka, Nepal",
  "Syalakharka",
  "Mangsang, Nepal",
  "Bhirpani, Nepal",
  "Kattun, Nepal",
  "Bhotpa, Nepal",
  "Sunkoshi, Nepal",
  "Kadambas, Nepal",
  "Badegaun, Nepal",
  "Kafle, Nepal",
  "Ramche, Sindhupalchok",
  "Gati, Nepal",
  "Gumba, Sindhupalchok",
  "Nayangaun, Nepal",
  "Sundaradevi",
  "Sarsyu, Nepal",
  "Lwang, Nepal",
  "Dandagaun, Nepal",
  "Rangrung, Nepal",
  "Sene, Nepal",
  "Phalate, Nepal",
  "Gumba, Kavre",
  "Bhumlutar, Kavre",
  "Mahananda, Nepal",
  "Saldhara, Nepal",
  "Mangaltar, Kavre",
  "Panauti, Nepal",
  "Dhulikhel, Nepal",
  "Patan, Dhulikhel",
  "Sanga, Nepal",
  "Banepa, Nepal",
  "Kavre, Nepal",
  "Khopasi, Nepal",
  "Nala, Kavre",
  "Timal, Nepal",
  "Roshil, Nepal",
  "Kusadevi, Nepal",
  "Dapcha, Nepal",
  "Talachhen, Nepal",
  "Birtadeurali",
  "Dobato, Kavre",
  "Miltan, Nepal",
  "Chanauta, Nepal",
  "Majuwa, Nepal",
  "Banepa, Kavre",
  "Chandrampur",
  "Kasi, Nepal",
  "Mahadevsthan, Kavre",
  "Bhimkunda, Nepal",
  "Salyantar, Dhading",
  "Sertung, Nepal",
  "Gajuri, Nepal",
  "Baireni, Nepal",
  "Benighat, Nepal",
  "Mara, Nepal",
  "Naubise, Nepal",
  "Baad Bhanjyang",
  "Tistung, Nepal",
  "Chhatre, Nepal",
  "Kurule, Nepal",
  "Deurale, Nepal",
  "Nalang, Dhading",
  "Kali, Dhading",
  "Dhola, Nepal",
  "Pida, Nepal",
  "Mankha, Nuwakot",
  "Belkot, Nepal",
  "Bhattedanda, Nepal",
  "Khanikhola",
  "Bhumidanda, Nepal",
  "Kisan, Nepal",
  "Ghyangphedi",
  "Sheshnarayan",
  "Gokarneshwar",
  "Tokha, Nepal",
  "Kapan, Nepal",
  "Budhanilkantha",
  "Chandragiri, Kathmandu",
  "Dharamsthali",
  "Kageshwari, Nepal",
  "Nagarjun, Kathmandu",
  "Daksheshwar, Nepal",
  "Chhayal, Nepal",
  "Dhap, Nepal",
  "Gokarnasthan",
  "Kadamtar, Nepal",
  "Kaushaltar",
  "Karyabinayak",
  "Chobhar, Nepal",
  "Thankot, Nepal",
  "Sitapaila, Nepal",
  "Satdobato",
  "Imadol, Nepal",
  "Bungamati, Nepal",
  "Panga, Nepal",
  "Badikhel, Nepal",
  "Godawari, Nepal",
  "Bhattedanda, Lalitpur",
  "Bishankhu, Nepal",
  "Phasikhel",
  "Chanasthali",
  "Kirtipur Kathmandu",
  "Suryabinayak",
  "Chitrapur, Nepal",
  "Bistri, Nepal",
  "Paldhunga",
  "Makaibari",
  "Kharka, Nepal",
  "Pantar, Nepal",
  "Bhorle, Nepal",
  "Biushing, Nepal",
  "Tekanpur, Nepal",
  "Jyamdi, Nepal",
  "Mahabharat, Nepal",
  "Faparbasi",
  "Majhi, Nepal",
  "Jestha, Nepal",
  "Mali, Nepal",
  "Rakha, Nepal",
  "Bharat, Nepal",
  "Thada, Nepal",
  "Pantan, Nepal",
  "Dawan, Nepal",
  "Sindhu, Nepal",
  "Madan, Nepal",
  "Sundarpur, Nepal",
  "Tharu, Nepal",
  "Basnet, Nepal",
  "Bokse, Nepal",
  "Gilung, Nepal",
  "Kaule, Nepal",
  "Nibuwatar",
  "Kumal, Nepal",
  "Chatiwan, Nepal",
  "Basamadi, Nepal",
  "Hatiya, Makwanpur",
  "Manhari, Nepal",
  "Raksirang",
  "Bhimphedi, Makwanpur",
  "Chhatiwan, Nepal",
  "Gogane, Nepal",
  "Sariswa, Nepal",
  "Bhainse, Nepal",
  "Srishakot, Nepal",
  "Kankaraj, Nepal",
  "Rochi, Nepal",
  "Daman, Makwanpur",
  "Bajra, Nepal",
  "Aambhanjyang",
  "Chha, Nepal",
  "Baldhara, Nepal",
  "Matera, Nepal",
  "Pang, Nepal",
  "Pandhak, Nepal",
  "Hunrya, Nepal",
  "Bhairav, Nepal",
  "Bhandar, Nepal",
  "Dhuskun, Nepal",
  "Sakhuwa, Nepal",
  "Tikathali, Nepal",
  "Bhaktapur, Nepal",
  "Chhaling, Nepal",
  "Bode, Nepal",
  "Thimi, Nepal",
  "Suryabinayak, Bhaktapur",
  "Duwakot, Nepal",
  "Katunje, Bhaktapur",
  "Changu, Nepal",
  "Lokanthali, Nepal",
  "Bageshwari, Bhaktapur",
  "Sudal, Nepal",
  "Sirutar, Nepal",
  "Nankhel, Nepal",
  "Dadikot, Nepal",
  "Tathali, Nepal",
  "Gundu, Nepal",
  "Chitapol, Nepal",
  "Golmadhi, Nepal",
  "Malkop, Nepal",
  "Gathaghar, Nepal",
  "Kharipati, Nepal",
  "Balkot, Bhaktapur",
  "Dabli, Nepal",
  "Mahat, Nepal",
  "Chapagaon, Nepal",
  "Lele, Nepal",
  "Dhukuchhap",
  "Dhusel, Nepal",
  "Choughada, Nepal",
  "Dhapakhel, Nepal",
  "Siddhipur, Nepal",
  "Harisiddhi, Nepal",
  "Thankot, Kathmandu",
  "Dhapasi, Nepal",
  "Raniban, Nepal",
  "Halchok, Nepal",
  "Swayambhu, Nepal",
  "Ichangu, Nepal",
  "Lapsiphedi",
  "Sundarijal, Nepal",
  "Jitpur, Nepal",
  "Bhadrabas, Nepal",
  "Chunikhel, Nepal",
  "Tarahi, Nepal",
  "Gamcha, Nepal",
  "Furke, Nepal",
  "Matatirtha, Nepal",
  "Sisa, Nepal",
  "Ramkot, Nepal",
  "Bishnumati, Nepal",
  "Kirtipur, Nepal",
];

// ── Rate limiter ──

let lastApiCall = 0;
const API_DELAY_MS = 2200;

function jitter(): number {
  return Math.floor(Math.random() * 400);
}

async function rateLimitedFetch(url: string, retries = 5): Promise<any> {
  const now = Date.now();
  const sinceLast = now - lastApiCall;
  const wait = API_DELAY_MS + jitter();
  if (sinceLast < wait) {
    await sleep(wait - sinceLast);
  }
  lastApiCall = Date.now();

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      const backoff = Math.min(20000 * Math.pow(2, attempt - 1), 180000);
      console.warn(`    Rate limited, waiting ${backoff}ms (attempt ${attempt}/${retries})...`);
      lastApiCall = Date.now();
      await sleep(backoff);
      continue;
    }
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url.slice(0, 100)}: ${body.slice(0, 200)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Validation helpers ──

function findProvinceFromCoords(lat: number, lon: number): string {
  if (lat >= 29.5) return "Sudurpashchim";
  if (lat >= 28.8) return lon >= 83.5 ? "Karnali" : "Sudurpashchim";
  if (lat >= 28.0) return lon >= 84.5 ? "Gandaki" : "Karnali";
  if (lat >= 27.5) return lon >= 85.5 ? "Bagmati" : (lon >= 84.0 ? "Gandaki" : "Lumbini");
  if (lat >= 27.0) return lon >= 85.5 ? "Bagmati" : (lon >= 84.0 ? "Gandaki" : "Lumbini");
  if (lon >= 86.5) return "Koshi";
  if (lon >= 85.0) return "Bagmati";
  if (lon >= 84.0) return "Madhesh";
  return "Lumbini";
}

function inferCategory(name: string, wikiCategories: string[]): string {
  for (const cat of wikiCategories) {
    const c = cat.toLowerCase();
    if (/lake|tal$|pokhari|sagar|kunda|daha|taláo/i.test(c)) return "LAKE";
    if (/waterfall|falls/i.test(c)) return "WATERFALL";
    if (/mountain|peak|mount|him|giri|everest|chuli|shikhar/i.test(c)) return "MOUNTAIN";
    if (/hill/i.test(c)) return "HILL";
    if (/temple|mandir|monastery|gompa|stupa|church|mosque|shrine/i.test(c)) return "TEMPLE";
    if (/forest|national park|conservation|reserve|protected/i.test(c)) return "FOREST";
    if (/viewpoint|view/i.test(c)) return "VIEWPOINT";
    if (/trekking|trail|trek|base.?camp/i.test(c)) return "CAMP";
    if (/village|settlement|bazaar|bazar|town|city|municipality/i.test(c)) return "TREKKING_VILLAGE";
    if (/valley/i.test(c)) return "VIEWPOINT";
    if (/river|riverside|spring|hot spring/i.test(c)) return "RIVERSIDE";
    if (/cave/i.test(c)) return "OTHER";
    if (/museum|palace|durbar|fort|monument|square|garden/i.test(c)) return "TOURIST_ATTRACTION";
    if (/camp/i.test(c) && !/base.?camp/i.test(c)) return "CAMP";
  }
  const l = name.toLowerCase();
  if (/lake|tal|pokhari|sagar|kunda|daha/i.test(l)) return "LAKE";
  if (/waterfall|falls|jharna/i.test(l)) return "WATERFALL";
  if (/peak|mount|him|giri|shikhar|chuli|everest|massif/i.test(l)) return "MOUNTAIN";
  if (/hill|pahar|danda|lek/i.test(l)) return "HILL";
  if (/temple|mandir|monastery|gompa|stupa|church|mosque|shrine|gumba|math/i.test(l)) return "TEMPLE";
  if (/park|forest|ban|conservation|reserve|protected/i.test(l)) return "FOREST";
  if (/viewpoint|view|danda|deurali|observation|sightseeing/i.test(l)) return "VIEWPOINT";
  if (/trek|trail|circuit|base.?camp|camp/i.test(l)) return "CAMP";
  if (/village|gaon|basti|bazaar|bazar|settlement|town/i.test(l)) return "TREKKING_VILLAGE";
  if (/palace|durbar|fort|museum|monument|square|garden|bridge|memorial|park/i.test(l)) return "TOURIST_ATTRACTION";
  if (/valley/i.test(l)) return "VIEWPOINT";
  if (/cave|gufa/i.test(l)) return "OTHER";
  if (/riverside|river|ghat|spring/i.test(l)) return "RIVERSIDE";
  return "TOURIST_ATTRACTION";
}

function cleanCategories(categories: string[]): string[] {
  const seen = new Set<string>();
  return categories
    .filter((c) => {
      const title = c.startsWith("Category:") ? c.slice(9) : c;
      return ![...CATEGORY_BLOCKLIST].some((b) => title.startsWith(b));
    })
    .map((c) => (c.startsWith("Category:") ? c.slice(9) : c))
    .filter((c) => {
      const lower = c.toLowerCase();
      return (
        !lower.includes("pages") && !lower.includes("article") &&
        !lower.includes("wikipedia") && !lower.includes("cs1") &&
        !lower.includes("stub") && !lower.includes("short description") &&
        c.length > 3
      );
    })
    .filter((c) => {
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    })
    .slice(0, 5);
}

function extractDistrictFromText(text: string): string | null {
  const normalized = text.toLowerCase();
  for (const d of NEPAL_DISTRICTS) {
    if (normalized.includes(d.toLowerCase())) return d;
  }
  return null;
}

function extractInfobox(wikitext: string): string {
  const start = wikitext.search(/\{\{\s*Infobox/i);
  if (start === -1) return "";
  let depth = 0;
  let end = start;
  for (let i = start; i < wikitext.length; i++) {
    if (wikitext[i] === "{" && wikitext[i + 1] === "{") { depth++; i++; }
    else if (wikitext[i] === "}" && wikitext[i + 1] === "}") { depth--; i++; }
    if (depth === 0) { end = i + 1; break; }
  }
  return wikitext.slice(start, end);
}

function extractAltitudeFromWikitext(wikitext: string): number | null {
  const infobox = extractInfobox(wikitext);
  if (!infobox) return null;
  const m = infobox.match(/elevation_m\s*=\s*([\d,]+)/i);
  if (m) return parseInt(m[1].replace(/,/g, ""));
  const m2 = infobox.match(/elevation\s*=\s*([\d,]+)/i);
  if (m2) return parseInt(m2[1].replace(/,/g, ""));
  return null;
}

function extractDistrictFromWikitext(wikitext: string): string | null {
  const infobox = extractInfobox(wikitext);
  if (!infobox) return null;

  const locationMatch = infobox.match(/\|\s*location\s*=\s*(.+?)(?:\n\||\n\}\}|$)/i);
  if (locationMatch) {
    const d = extractDistrictFromText(locationMatch[1]);
    if (d) return d;
  }

  const subdivProps = infobox.match(/\|\s*subdivision_name\s*=\s*(.+?)(?:\n\||\n\}\}|$)/gi);
  if (subdivProps) {
    for (const m of subdivProps) {
      const val = m.replace(/^.*?=\s*/, "");
      const d = extractDistrictFromText(val);
      if (d) return d;
    }
  }

  return null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function searchWikipediaTitle(query: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: "query", list: "search", srsearch: query,
    srlimit: "1", format: "json", formatversion: "2",
  });
  try {
    const data = await rateLimitedFetch(`${WIKI_API}?${params}`);
    const pages = data.query?.search ?? [];
    if (pages.length > 0 && pages[0].title) return pages[0].title;
  } catch {}
  return null;
}

// ── Phase 2: Fetch data for each page ──

interface DestRecord {
  id: string;
  name: string;
  normalizedName: string;
  district: string;
  province: string;
  municipality: null;
  latitude: number;
  longitude: number;
  altitude: number | null;
  category: string;
  description: string | null;
  image: string | null;
  tags: string[];
  osmId: null;
  source: string;
  verified: boolean;
  verifiedBy: null;
  verifiedAt: null;
  routeAccessible: boolean;
  coordinateAccuracy: null;
  dataQualityScore: number | null;
  popularityScore: null;
  confidenceScore: null;
  accessibilityScore: null;
  tourismSupportScore: null;
  destinationTier: null;
  metadata: null;
  createdAt: string;
  updatedAt: string;
  sourceLastFetch: string;
}

async function fetchPageData(title: string): Promise<DestRecord | null> {
  try {
    // Step 1: Fetch summary from REST API
    let summary: any;
    try {
      summary = await rateLimitedFetch(
        `${WIKI_REST}/page/summary/${encodeURIComponent(title)}`,
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes("HTTP 404")) {
        const searched = await searchWikipediaTitle(title);
        if (!searched || searched === title) return null;
        try {
          summary = await rateLimitedFetch(
            `${WIKI_REST}/page/summary/${encodeURIComponent(searched)}`,
          );
        } catch { return null; }
      } else { throw err; }
    }

    if (summary.type === "disambiguation" || !summary.extract) {
      const searched = await searchWikipediaTitle(title);
      if (!searched || searched === title) return null;
      try {
        summary = await rateLimitedFetch(
          `${WIKI_REST}/page/summary/${encodeURIComponent(searched)}`,
        );
      } catch { return null; }
      if (summary.type === "disambiguation" || !summary.extract) return null;
    }

    const pageTitle: string = summary.title;
    const description: string | null = summary.extract || null;
    const image: string | null = summary.thumbnail?.source || null;

    // Step 2: Fetch coordinates, categories, wikitext
    const params = new URLSearchParams({
      action: "query",
      prop: "coordinates|categories|revisions",
      titles: pageTitle,
      format: "json",
      formatversion: "2",
      cllimit: "50",
      rvprop: "content",
      rvslots: "main",
    });
    const mwData = await rateLimitedFetch(`${WIKI_API}?${params}`);
    const page = mwData.query?.pages?.[0];
    if (!page || page.missing) return null;

    const lat = page.coordinates?.[0]?.lat ?? null;
    const lon = page.coordinates?.[0]?.lon ?? null;
    if (lat === null || lon === null) return null;

    const coordCheck = validateCoordinates(lat, lon, false);
    if (!coordCheck.valid) return null;

    const rawCategories: string[] = (page.categories || []).map((c: any) => c.title);
    const tags = cleanCategories(rawCategories);

    const wikitext: string = page.revisions?.[0]?.slots?.main?.["*"] || "";
    let district: string | null = null;
    let altitude: number | null = null;

    if (wikitext) {
      district = extractDistrictFromWikitext(wikitext);
      altitude = extractAltitudeFromWikitext(wikitext);
    }

    if (!district && description) {
      district = extractDistrictFromText(description);
    }

    const category = inferCategory(pageTitle, rawCategories);
    const province = district
      ? findProvinceForDistrict(district) || findProvinceFromCoords(lat, lon)
      : findProvinceFromCoords(lat, lon);

    if (!district) {
      district = "Unknown";
    }

    const qualityFactors = {
      hasName: true, hasCoordinates: true,
      coordinatesValid: coordCheck.valid === true,
      coordinatesInNepal: coordCheck.inNepal === true,
      hasAltitude: altitude !== null, hasCategory: category !== "OTHER",
      hasDescription: !!description, hasVerification: true, hasSource: true,
    };
    const dataQualityScore = calculateQualityScore(qualityFactors);

    return {
      id: randomUUID(), name: pageTitle,
      normalizedName: normalizeName(pageTitle),
      district, province, municipality: null,
      latitude: lat, longitude: lon, altitude,
      category, description, image, tags,
      osmId: null, source: "MANUAL",
      verified: true, verifiedBy: null, verifiedAt: null,
      routeAccessible: true, coordinateAccuracy: null,
      dataQualityScore, popularityScore: null,
      confidenceScore: null, accessibilityScore: null,
      tourismSupportScore: null, destinationTier: null,
      metadata: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceLastFetch: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`  ✗ "${title}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Proximity deduplication ──

function deduplicateByProximity(destinations: DestRecord[]): DestRecord[] {
  const kept: DestRecord[] = [];
  let removed = 0;

  for (const dest of destinations) {
    const isNear = kept.some(k =>
      haversineKm(k.latitude, k.longitude, dest.latitude, dest.longitude) < PROXIMITY_KM
    );
    if (!isNear) {
      kept.push(dest);
    } else {
      removed++;
    }
  }

  console.log(`\n  📏 Proximity dedup: ${removed} removed (within ${PROXIMITY_KM}km)`);
  return kept;
}

// ── Periodic save ──

function tempSave(outputPath: string, succeeded: number, failed: number, results: DestRecord[]) {
  const deduped = deduplicateByProximity(results);
  const final = deduped.length > MAX_DESTINATIONS
    ? deduped.sort((a, b) => (b.dataQualityScore ?? 0) - (a.dataQualityScore ?? 0)).slice(0, MAX_DESTINATIONS)
    : deduped;
  final.sort((a, b) => a.name.localeCompare(b.name));
  const jsonData = {
    exportedAt: new Date().toISOString(),
    count: final.length,
    destinations: final,
  };
  writeFileSync(outputPath, JSON.stringify(jsonData, null, 2), "utf-8");
  console.log(`  💾 Saved ${final.length} destinations to ${outputPath}`);
}

// ── Main ──

async function main() {
  console.log("=".repeat(60));
  console.log("  YATRA AI — Wikipedia Destination Fetcher");
  console.log("=".repeat(60));

  // Deduplicate the list by name
  const uniqueNames = [...new Set(DESTINATION_LIST.map(n => n.trim()))];
  console.log(`\n📋 Total destinations in list: ${DESTINATION_LIST.length}`);
  console.log(`📋 Unique destinations:         ${uniqueNames.length}`);

  // Fetch data for each destination
  console.log("\n📡 Fetching data from Wikipedia...\n");

  const results: DestRecord[] = [];
  let succeeded = 0;
  let failed = 0;

  const outputPath = join(__dirname, "data", "destinations.json");

  for (let i = 0; i < uniqueNames.length; i++) {
    const name = uniqueNames[i];
    process.stdout.write(`[${i + 1}/${uniqueNames.length}] "${name}"... `);

    const result = await fetchPageData(name);
    if (result) {
      results.push(result);
      succeeded++;
      console.log(`✅ ${result.district} / ${result.category}`);
    } else {
      failed++;
      console.log(`❌ skipped`);
    }

    // Save progress every 100 entries
    if ((i + 1) % 100 === 0) {
      console.log(`  [Progress save at ${i + 1}/${uniqueNames.length}]`);
      tempSave(outputPath, succeeded, failed, results);
    }
  }

  console.log(`\n  📊 Fetched: ${succeeded}, Skipped: ${failed}`);

  // Proximity deduplication
  console.log("\n📡 Proximity deduplication...");
  const deduped = deduplicateByProximity(results);
  console.log(`  → ${deduped.length} destinations after dedup`);

  // Trim to max
  const final = deduped.length > MAX_DESTINATIONS
    ? deduped.sort((a, b) => (b.dataQualityScore ?? 0) - (a.dataQualityScore ?? 0)).slice(0, MAX_DESTINATIONS)
    : deduped;

  if (deduped.length > MAX_DESTINATIONS) {
    console.log(`  ✂ Trimmed to top ${MAX_DESTINATIONS} by quality score`);
  }

  if (final.length < 500) {
    console.warn(`\n  ⚠️  Only ${final.length} destinations (target was 500-1500). Consider adding more entries to the list.`);
  }

  // Final save
  tempSave(outputPath, succeeded, failed, results);

  console.log("\n" + "=".repeat(60));
  console.log("  SUMMARY");
  console.log("=".repeat(60));
  console.log(`  In list:   ${uniqueNames.length}`);
  console.log(`  Fetched:   ${succeeded}`);
  console.log(`  Skipped:   ${failed}`);
  console.log(`  After dedup: ${deduped.length}`);
  console.log(`  Saved:     ${final.length}`);
  console.log(`  Output:    ${outputPath}`);

  const catCounts: Record<string, number> = {};
  for (const r of final) {
    catCounts[r.category] = (catCounts[r.category] || 0) + 1;
  }
  console.log("\n  Category breakdown:");
  for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat}: ${count}`);
  }
}

main().catch((err) => {
  console.error("\n❌ Fatal:", err);
  process.exit(1);
});
