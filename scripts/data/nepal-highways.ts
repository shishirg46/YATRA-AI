export type NodeType = "city" | "town" | "junction" | "highwaynode" | "mountainpass" | "touristspot";
export type RoadType = "highway" | "feederroad" | "mountainroad" | "valleyroad";

export interface CorridorWaypoint {
  name: string;
  lat: number;
  lon: number;
  type?: NodeType;
  importance?: number;
}

export interface HighwayCorridor {
  name: string;
  roadType: RoadType;
  waypoints: CorridorWaypoint[];
  sampleEveryKm: number;
  isAlternative?: boolean;
}

export const HIGHWAY_CORRIDORS: HighwayCorridor[] = [
  {
    name: "East-West Highway",
    roadType: "highway",
    sampleEveryKm: 3,
    waypoints: [
      { name: "Mechinagar", lat: 26.645, lon: 88.155, type: "town", importance: 3 },
      { name: "Birtamode", lat: 26.65, lon: 87.983, type: "town", importance: 3 },
      { name: "Itahari", lat: 26.663, lon: 87.274, type: "town", importance: 4 },
      { name: "Lagankhel", lat: 26.72, lon: 87.02, type: "town", importance: 2 },
      { name: "Janakpur", lat: 26.729, lon: 85.925, type: "city", importance: 4 },
      { name: "Jaleswor", lat: 26.647, lon: 85.798, type: "town", importance: 3 },
      { name: "Bardibas", lat: 26.98, lon: 85.9, type: "town", importance: 4 },
      { name: "Chandranigahapur", lat: 27.17, lon: 85.24, type: "town", importance: 2 },
      { name: "Hetauda", lat: 27.428, lon: 85.032, type: "city", importance: 4 },
      { name: "Narayanghat", lat: 27.7, lon: 84.433, type: "town", importance: 4 },
      { name: "Bharatpur", lat: 27.683, lon: 84.433, type: "city", importance: 5 },
      { name: "Butwal", lat: 27.7, lon: 83.45, type: "city", importance: 5 },
      { name: "Kohalpur", lat: 28.2, lon: 81.7, type: "town", importance: 3 },
      { name: "Lamahi", lat: 28.0, lon: 82.35, type: "town", importance: 3 },
      { name: "Dang", lat: 28.05, lon: 82.3, type: "town", importance: 3 },
      { name: "Tulsipur", lat: 28.133, lon: 82.3, type: "town", importance: 3 },
      { name: "Surkhet", lat: 28.6, lon: 81.633, type: "city", importance: 4 },
      { name: "Dhangadhi", lat: 28.683, lon: 80.617, type: "city", importance: 4 },
      { name: "Mahendranagar", lat: 28.964, lon: 80.186, type: "city", importance: 4 },
    ],
  },
  {
    name: "BP Highway",
    roadType: "highway",
    sampleEveryKm: 3,
    waypoints: [
      { name: "Bardibas", lat: 26.98, lon: 85.9, type: "town", importance: 4 },
      { name: "Sindhuli", lat: 27.2, lon: 85.95, type: "town", importance: 3 },
      { name: "Khurkot", lat: 27.38, lon: 85.68, type: "junction", importance: 2 },
      { name: "Nepalthok", lat: 27.55, lon: 85.85, type: "town", importance: 2 },
      { name: "Galchhi", lat: 27.85, lon: 84.95, type: "town", importance: 3 },
      { name: "Kathmandu", lat: 27.717, lon: 85.324, type: "city", importance: 5 },
    ],
  },
  {
    name: "Prithvi Highway",
    roadType: "highway",
    sampleEveryKm: 3,
    waypoints: [
      { name: "Kathmandu", lat: 27.717, lon: 85.324, type: "city", importance: 5 },
      { name: "Thankot", lat: 27.7, lon: 85.3, type: "town", importance: 3 },
      { name: "Naubise", lat: 27.717, lon: 85.0, type: "town", importance: 2 },
      { name: "Malekhu", lat: 27.733, lon: 84.85, type: "town", importance: 2 },
      { name: "Mugling", lat: 27.583, lon: 84.833, type: "junction", importance: 3 },
      { name: "Bharatpur", lat: 27.683, lon: 84.433, type: "city", importance: 5 },
      { name: "Damauli", lat: 27.967, lon: 84.267, type: "town", importance: 2 },
      { name: "Pokhara", lat: 28.210, lon: 83.986, type: "city", importance: 5 },
    ],
  },
  {
    name: "Tribhuvan Highway",
    roadType: "highway",
    sampleEveryKm: 3,
    waypoints: [
      { name: "Kathmandu", lat: 27.717, lon: 85.324, type: "city", importance: 5 },
      { name: "Thankot", lat: 27.7, lon: 85.3, type: "town", importance: 3 },
      { name: "Sisneri", lat: 27.6, lon: 85.18, type: "town", importance: 2 },
      { name: "Malekhu", lat: 27.733, lon: 84.85, type: "town", importance: 2 },
      { name: "Bhimphedi", lat: 27.467, lon: 85.133, type: "town", importance: 2 },
      { name: "Hetauda", lat: 27.428, lon: 85.032, type: "city", importance: 4 },
      { name: "Birgunj", lat: 27.0, lon: 84.867, type: "city", importance: 4 },
    ],
  },
  {
    name: "Arniko Highway",
    roadType: "highway",
    sampleEveryKm: 3,
    waypoints: [
      { name: "Kathmandu", lat: 27.717, lon: 85.324, type: "city", importance: 5 },
      { name: "Bhaktapur", lat: 27.671, lon: 85.426, type: "city", importance: 4 },
      { name: "Banepa", lat: 27.63, lon: 85.52, type: "town", importance: 3 },
      { name: "Dhulikhel", lat: 27.619, lon: 85.552, type: "town", importance: 3 },
      { name: "Panauti", lat: 27.585, lon: 85.516, type: "town", importance: 2 },
      { name: "Khadichaur", lat: 27.65, lon: 85.75, type: "town", importance: 2 },
      { name: "Barabise", lat: 27.788, lon: 85.900, type: "town", importance: 2 },
      { name: "Kodari", lat: 27.967, lon: 85.967, type: "town", importance: 3 },
    ],
  },
  {
    name: "Siddhartha Highway",
    roadType: "highway",
    sampleEveryKm: 3,
    waypoints: [
      { name: "Pokhara", lat: 28.210, lon: 83.986, type: "city", importance: 5 },
      { name: "Syangja", lat: 28.1, lon: 83.867, type: "town", importance: 3 },
      { name: "Waling", lat: 27.983, lon: 83.767, type: "town", importance: 2 },
      { name: "Tansen", lat: 27.867, lon: 83.55, type: "town", importance: 3 },
      { name: "Butwal", lat: 27.7, lon: 83.45, type: "city", importance: 5 },
    ],
  },
  {
    name: "Kaligandaki Corridor",
    roadType: "feederroad",
    sampleEveryKm: 3,
    waypoints: [
      { name: "Pokhara", lat: 28.210, lon: 83.986, type: "city", importance: 5 },
      { name: "Baglung", lat: 28.267, lon: 83.6, type: "town", importance: 3 },
      { name: "Beni", lat: 28.345, lon: 83.567, type: "town", importance: 3 },
      { name: "Ghayaghat", lat: 28.467, lon: 83.6, type: "town", importance: 2 },
      { name: "Jomsom", lat: 28.78, lon: 83.72, type: "town", importance: 3 },
      { name: "Kagbeni", lat: 28.817, lon: 83.783, type: "town", importance: 2 },
      { name: "Muktinath", lat: 28.82, lon: 83.87, type: "touristspot", importance: 4 },
    ],
  },
  {
    name: "Karnali Highway",
    roadType: "mountainroad",
    sampleEveryKm: 4,
    waypoints: [
      { name: "Surkhet", lat: 28.6, lon: 81.633, type: "city", importance: 4 },
      { name: "Musikot", lat: 28.633, lon: 81.617, type: "town", importance: 2 },
      { name: "Gurnakot", lat: 28.733, lon: 81.717, type: "town", importance: 2 },
      { name: "Jumla", lat: 29.275, lon: 82.183, type: "town", importance: 3 },
      { name: "Hilsa", lat: 29.517, lon: 81.933, type: "town", importance: 2 },
    ],
  },
  {
    name: "Koshi Highway",
    roadType: "mountainroad",
    sampleEveryKm: 4,
    waypoints: [
      { name: "Biratnagar", lat: 26.454, lon: 87.28, type: "city", importance: 5 },
      { name: "Itahari", lat: 26.663, lon: 87.274, type: "city", importance: 4 },
      { name: "Dharan", lat: 26.814, lon: 87.279, type: "city", importance: 4 },
      { name: "Dhankuta", lat: 26.983, lon: 87.333, type: "town", importance: 3 },
      { name: "Hile", lat: 27.042, lon: 87.35, type: "town", importance: 2 },
      { name: "Khandbari", lat: 27.367, lon: 87.217, type: "town", importance: 3 },
      { name: "Kimathanka", lat: 27.817, lon: 87.383, type: "town", importance: 2 },
    ],
  },
  {
    name: "Mechi Highway",
    roadType: "mountainroad",
    sampleEveryKm: 4,
    waypoints: [
      { name: "Kakarbhitta", lat: 26.65, lon: 88.15, type: "junction", importance: 3 },
      { name: "Bhadrapur", lat: 26.533, lon: 88.083, type: "town", importance: 2 },
      { name: "Ilam", lat: 26.9, lon: 87.9, type: "town", importance: 3 },
      { name: "Mangalbare", lat: 26.95, lon: 87.85, type: "town", importance: 2 },
      { name: "Phidim", lat: 27.15, lon: 87.75, type: "town", importance: 2 },
      { name: "Taplejung", lat: 27.35, lon: 87.667, type: "town", importance: 3 },
    ],
  },
  {
    name: "Rapti Highway",
    roadType: "feederroad",
    sampleEveryKm: 4,
    waypoints: [
      { name: "Butwal", lat: 27.7, lon: 83.45, type: "city", importance: 5 },
      { name: "Dang", lat: 28.05, lon: 82.3, type: "city", importance: 4 },
      { name: "Salyan", lat: 28.383, lon: 82.167, type: "town", importance: 3 },
      { name: "Musikot", lat: 28.633, lon: 81.617, type: "town", importance: 2 },
      { name: "Surkhet", lat: 28.6, lon: 81.633, type: "city", importance: 4 },
    ],
  },
  {
    name: "Mahakali Highway",
    roadType: "mountainroad",
    sampleEveryKm: 4,
    waypoints: [
      { name: "Mahendranagar", lat: 28.964, lon: 80.186, type: "city", importance: 4 },
      { name: "Dadeldhura", lat: 29.3, lon: 80.583, type: "town", importance: 3 },
      { name: "Baitadi", lat: 29.517, lon: 80.333, type: "town", importance: 3 },
      { name: "Darchula", lat: 29.85, lon: 80.533, type: "town", importance: 3 },
      { name: "Jhulaghat", lat: 29.933, lon: 80.367, type: "town", importance: 2 },
    ],
  },
  {
    name: "Hulaki Highway",
    roadType: "highway",
    sampleEveryKm: 4,
    isAlternative: true,
    waypoints: [
      { name: "Kakarbhitta", lat: 26.65, lon: 88.15, type: "junction", importance: 3 },
      { name: "Birtamode", lat: 26.65, lon: 87.983, type: "town", importance: 3 },
      { name: "Biratnagar", lat: 26.454, lon: 87.28, type: "city", importance: 5 },
      { name: "Rajbiraj", lat: 26.541, lon: 86.749, type: "town", importance: 3 },
      { name: "Janakpur", lat: 26.729, lon: 85.925, type: "city", importance: 4 },
      { name: "Jaleswor", lat: 26.647, lon: 85.798, type: "town", importance: 3 },
      { name: "Malangwa", lat: 26.867, lon: 85.567, type: "town", importance: 2 },
      { name: "Narayanghat", lat: 27.7, lon: 84.433, type: "town", importance: 4 },
      { name: "Bharatpur", lat: 27.683, lon: 84.433, type: "city", importance: 5 },
      { name: "Butwal", lat: 27.7, lon: 83.45, type: "city", importance: 5 },
      { name: "Nepalgunj", lat: 28.05, lon: 81.617, type: "city", importance: 4 },
      { name: "Tikapur", lat: 28.5, lon: 81.133, type: "town", importance: 2 },
      { name: "Dhangadhi", lat: 28.683, lon: 80.617, type: "city", importance: 4 },
      { name: "Mahendranagar", lat: 28.964, lon: 80.186, type: "city", importance: 4 },
    ],
  },
  {
    name: "Biratnagar-Dhankuta Road",
    roadType: "feederroad",
    sampleEveryKm: 2,
    waypoints: [
      { name: "Biratnagar", lat: 26.454, lon: 87.28, type: "city", importance: 5 },
      { name: "Dharan", lat: 26.814, lon: 87.279, type: "city", importance: 4 },
      { name: "Dhankuta", lat: 26.983, lon: 87.333, type: "town", importance: 3 },
      { name: "Bhojpur", lat: 27.167, lon: 87.067, type: "town", importance: 2 },
      { name: "Chainpur", lat: 27.417, lon: 87.55, type: "town", importance: 2 },
    ],
  },
  {
    name: "Janakpur-Dhanusa Road",
    roadType: "feederroad",
    sampleEveryKm: 2,
    waypoints: [
      { name: "Janakpur", lat: 26.729, lon: 85.925, type: "city", importance: 4 },
      { name: "Dhanusa", lat: 26.817, lon: 86.033, type: "town", importance: 2 },
      { name: "Siraha", lat: 26.75, lon: 86.217, type: "town", importance: 2 },
    ],
  },
  {
    name: "Pokhara-Baglung Highway",
    roadType: "feederroad",
    sampleEveryKm: 2,
    waypoints: [
      { name: "Pokhara", lat: 28.210, lon: 83.986, type: "city", importance: 5 },
      { name: "Baglung", lat: 28.267, lon: 83.6, type: "town", importance: 3 },
      { name: "Kusma", lat: 28.233, lon: 83.717, type: "town", importance: 2 },
    ],
  },
  {
    name: "Nepalgunj-Dailekh Road",
    roadType: "feederroad",
    sampleEveryKm: 3,
    waypoints: [
      { name: "Nepalgunj", lat: 28.05, lon: 81.617, type: "city", importance: 4 },
      { name: "Gulariya", lat: 28.233, lon: 81.333, type: "town", importance: 2 },
      { name: "Dailekh", lat: 28.833, lon: 81.717, type: "town", importance: 2 },
    ],
  },
  {
    name: "Dhangadhi-Dadeldhura Road",
    roadType: "mountainroad",
    sampleEveryKm: 3,
    waypoints: [
      { name: "Dhangadhi", lat: 28.683, lon: 80.617, type: "city", importance: 4 },
      { name: "Godawari", lat: 29.083, lon: 80.533, type: "town", importance: 2 },
      { name: "Dadeldhura", lat: 29.3, lon: 80.583, type: "town", importance: 3 },
    ],
  },
  {
    name: "Mahendranagar-Darchula Road",
    roadType: "mountainroad",
    sampleEveryKm: 4,
    waypoints: [
      { name: "Mahendranagar", lat: 28.964, lon: 80.186, type: "city", importance: 4 },
      { name: "Dodhara", lat: 28.9, lon: 80.1, type: "town", importance: 2 },
      { name: "Darchula", lat: 29.85, lon: 80.533, type: "town", importance: 3 },
    ],
  },
  {
    name: "Hetauda-Makwanpur Road",
    roadType: "valleyroad",
    sampleEveryKm: 2,
    waypoints: [
      { name: "Hetauda", lat: 27.428, lon: 85.032, type: "city", importance: 4 },
      { name: "Makwanpur", lat: 27.517, lon: 84.933, type: "town", importance: 2 },
      { name: "Fakhel", lat: 27.617, lon: 85.133, type: "town", importance: 2 },
      { name: "Kathmandu", lat: 27.717, lon: 85.324, type: "city", importance: 5 },
    ],
  },
  {
    name: "Besisahar Road",
    roadType: "feederroad",
    sampleEveryKm: 3,
    waypoints: [
      { name: "Pokhara", lat: 28.210, lon: 83.986, type: "city", importance: 5 },
      { name: "Besisahar", lat: 28.233, lon: 84.383, type: "town", importance: 3 },
    ],
  },
  {
    name: "Madan Bhandari Highway",
    roadType: "feederroad",
    sampleEveryKm: 4,
    waypoints: [
      { name: "Sindhuli", lat: 27.2, lon: 85.95, type: "town", importance: 3 },
      { name: "Kalinchok", lat: 27.7, lon: 86.0, type: "town", importance: 2 },
      { name: "Charikot", lat: 27.67, lon: 86.05, type: "town", importance: 3 },
      { name: "Mugling", lat: 27.583, lon: 84.833, type: "junction", importance: 3 },
    ],
  },
  {
    name: "Pasang Lhamu Highway",
    roadType: "mountainroad",
    sampleEveryKm: 5,
    waypoints: [
      { name: "Kathmandu", lat: 27.717, lon: 85.324, type: "city", importance: 5 },
      { name: "Balaju", lat: 27.74, lon: 85.31, type: "town", importance: 2 },
      { name: "Trishuli", lat: 27.917, lon: 85.15, type: "town", importance: 2 },
      { name: "Syaphrubesi", lat: 28.167, lon: 85.333, type: "town", importance: 2 },
      { name: "Rasuwagadhi", lat: 28.3, lon: 85.383, type: "town", importance: 2 },
    ],
  },
  {
    name: "Thankot-Chandragiri Road",
    roadType: "valleyroad",
    sampleEveryKm: 2,
    waypoints: [
      { name: "Thankot", lat: 27.7, lon: 85.3, type: "town", importance: 3 },
      { name: "Chandragiri", lat: 27.683, lon: 85.267, type: "touristspot", importance: 2 },
    ],
  },
  {
    name: "Kathmandu Ring Road",
    roadType: "valleyroad",
    sampleEveryKm: 2,
    waypoints: [
      { name: "Kalanki", lat: 27.705, lon: 85.285, type: "junction", importance: 2 },
      { name: "Swayambhu", lat: 27.715, lon: 85.29, type: "town", importance: 2 },
      { name: "Thamel", lat: 27.718, lon: 85.313, type: "town", importance: 3 },
      { name: "Chabahil", lat: 27.72, lon: 85.345, type: "town", importance: 2 },
      { name: "Koteshwor", lat: 27.68, lon: 85.345, type: "town", importance: 2 },
      { name: "Balkumari", lat: 27.68, lon: 85.32, type: "town", importance: 2 },
      { name: "Kalanki", lat: 27.705, lon: 85.285, type: "junction", importance: 2 },
    ],
  },
  {
    name: "Kanti Highway",
    roadType: "valleyroad",
    sampleEveryKm: 3,
    isAlternative: true,
    waypoints: [
      { name: "Thankot", lat: 27.7, lon: 85.3, type: "town", importance: 3 },
      { name: "Dakshinkali", lat: 27.611, lon: 85.264, type: "town", importance: 2 },
      { name: "Chhaimale", lat: 27.567, lon: 85.25, type: "town", importance: 2 },
      { name: "Hetauda", lat: 27.428, lon: 85.032, type: "city", importance: 4 },
    ],
  },
  {
    name: "Narayanghat-Bharatpur Local",
    roadType: "valleyroad",
    sampleEveryKm: 2,
    isAlternative: true,
    waypoints: [
      { name: "Narayanghat", lat: 27.7, lon: 84.433, type: "town", importance: 4 },
      { name: "Bharatpur", lat: 27.683, lon: 84.433, type: "city", importance: 5 },
    ],
  },
  {
    name: "Lumbini Road",
    roadType: "feederroad",
    sampleEveryKm: 2,
    waypoints: [
      { name: "Butwal", lat: 27.7, lon: 83.45, type: "city", importance: 5 },
      { name: "Lumbini", lat: 27.469, lon: 83.276, type: "touristspot", importance: 5 },
    ],
  },
  {
    name: "Nepalgunj-Surkhet Road",
    roadType: "highway",
    sampleEveryKm: 3,
    waypoints: [
      { name: "Nepalgunj", lat: 28.05, lon: 81.617, type: "city", importance: 4 },
      { name: "Kohalpur", lat: 28.2, lon: 81.7, type: "town", importance: 3 },
      { name: "Surkhet", lat: 28.6, lon: 81.633, type: "city", importance: 4 },
    ],
  },
];

export const MOUNTAIN_PASSES: CorridorWaypoint[] = [
  { name: "Thorong La", lat: 28.817, lon: 83.917, type: "mountainpass", importance: 3 },
  { name: "Kakkot", lat: 27.867, lon: 85.917, type: "mountainpass", importance: 2 },
  { name: "Bhanjyang", lat: 27.983, lon: 85.4, type: "mountainpass", importance: 2 },
  { name: "Dandagaun", lat: 28.083, lon: 83.583, type: "mountainpass", importance: 2 },
  { name: "Khanigaun", lat: 28.283, lon: 82.75, type: "mountainpass", importance: 2 },
  { name: "Muktinath Pass", lat: 28.817, lon: 83.871, type: "mountainpass", importance: 3 },
  { name: "Poon Hill", lat: 28.383, lon: 83.717, type: "mountainpass", importance: 3 },
  { name: "Gokyo Ri", lat: 27.95, lon: 86.667, type: "mountainpass", importance: 2 },
  { name: "Renjo La", lat: 27.933, lon: 86.717, type: "mountainpass", importance: 2 },
  { name: "Kyangjin Ri", lat: 28.167, lon: 85.567, type: "mountainpass", importance: 2 },
  { name: "Syabru Bensi", lat: 28.15, lon: 85.317, type: "mountainpass", importance: 2 },
  { name: "Rasuwa Gadhi", lat: 28.3, lon: 85.383, type: "mountainpass", importance: 2 },
  { name: "Kodari Pass", lat: 27.967, lon: 85.967, type: "mountainpass", importance: 2 },
  { name: "Lamabagar", lat: 27.75, lon: 86.367, type: "mountainpass", importance: 2 },
  { name: "Simikot Pass", lat: 29.967, lon: 81.817, type: "mountainpass", importance: 2 },
  { name: "Tsum Valley", lat: 28.35, lon: 85.183, type: "mountainpass", importance: 2 },
  { name: "Nar Phu Valley", lat: 28.667, lon: 84.233, type: "mountainpass", importance: 2 },
  { name: "Kali Gandaki Gorge", lat: 28.5, lon: 83.633, type: "mountainpass", importance: 2 },
  { name: "Tilicho Base", lat: 28.683, lon: 83.9, type: "mountainpass", importance: 2 },
  { name: "Annapurna Base Camp", lat: 28.533, lon: 83.883, type: "mountainpass", importance: 2 },
  { name: "Everest Base Camp", lat: 28.017, lon: 86.85, type: "mountainpass", importance: 2 },
  { name: "Kala Patthar", lat: 27.983, lon: 86.833, type: "mountainpass", importance: 2 },
  { name: "Gokyo Lake Pass", lat: 27.917, lon: 86.683, type: "mountainpass", importance: 2 },
  { name: "Langtang Valley", lat: 28.217, lon: 85.5, type: "mountainpass", importance: 2 },
  { name: "Kyuksum", lat: 28.167, lon: 85.533, type: "mountainpass", importance: 2 },
];

export const ADDITIONAL_TOURIST_NODES: CorridorWaypoint[] = [
  { name: "Lumbini", lat: 27.469, lon: 83.276, type: "touristspot", importance: 5 },
  { name: "Janakpur", lat: 26.729, lon: 85.925, type: "touristspot", importance: 4 },
  { name: "Muktinath", lat: 28.82, lon: 83.87, type: "touristspot", importance: 4 },
  { name: "Tilicho Lake", lat: 28.683, lon: 83.817, type: "touristspot", importance: 2 },
  { name: "Gosaikunda", lat: 28.083, lon: 85.417, type: "touristspot", importance: 2 },
  { name: "Khaptad", lat: 29.35, lon: 81.15, type: "touristspot", importance: 2 },
  { name: "Shey Phoksundo", lat: 29.533, lon: 82.133, type: "touristspot", importance: 2 },
  { name: "Tansen Durbar", lat: 27.867, lon: 83.55, type: "touristspot", importance: 2 },
  { name: "Daman", lat: 27.617, lon: 85.15, type: "touristspot", importance: 2 },
  { name: "Nagarkot", lat: 27.7, lon: 85.5, type: "touristspot", importance: 3 },
  { name: "Chandragiri Hill", lat: 27.683, lon: 85.267, type: "touristspot", importance: 2 },
  { name: "Phulchowki", lat: 27.583, lon: 85.283, type: "touristspot", importance: 2 },
  { name: "Shivapuri", lat: 27.8, lon: 85.367, type: "touristspot", importance: 2 },
  { name: "Bandipur", lat: 27.933, lon: 84.383, type: "touristspot", importance: 3 },
  { name: "Gorkha Durbar", lat: 28.0, lon: 84.617, type: "touristspot", importance: 3 },
  { name: "Patan Durbar", lat: 27.677, lon: 85.317, type: "touristspot", importance: 3 },
  { name: "Bhaktapur Durbar", lat: 27.671, lon: 85.426, type: "touristspot", importance: 3 },
  { name: "Swayambhunath", lat: 27.715, lon: 85.29, type: "touristspot", importance: 3 },
  { name: "Boudhanath", lat: 27.722, lon: 85.355, type: "touristspot", importance: 3 },
  { name: "Pashupatinath", lat: 27.717, lon: 85.348, type: "touristspot", importance: 3 },
  { name: "Manakamana", lat: 27.917, lon: 84.567, type: "touristspot", importance: 3 },
  { name: "Devghat", lat: 27.717, lon: 84.433, type: "touristspot", importance: 2 },
  { name: "Triveni", lat: 27.467, lon: 83.667, type: "touristspot", importance: 2 },
  { name: "Swargadwari", lat: 28.05, lon: 82.383, type: "touristspot", importance: 2 },
  { name: "Pathibhara", lat: 27.35, lon: 87.867, type: "touristspot", importance: 3 },
  { name: "Halesi Mahadev", lat: 27.183, lon: 86.6, type: "touristspot", importance: 2 },
  { name: "Baraha Chhetra", lat: 26.883, lon: 87.183, type: "touristspot", importance: 2 },
  { name: "Dhaneshwor", lat: 26.733, lon: 86.25, type: "touristspot", importance: 2 },
  { name: "Gadhimal", lat: 26.45, lon: 87.033, type: "touristspot", importance: 2 },
  { name: "Budhanilkantha", lat: 27.767, lon: 85.35, type: "touristspot", importance: 2 },
  { name: "Namo Buddha", lat: 27.6, lon: 85.467, type: "touristspot", importance: 2 },
  { name: "Changu Narayan", lat: 27.667, lon: 85.433, type: "touristspot", importance: 3 },
  { name: "Dakshinkali Temple", lat: 27.611, lon: 85.264, type: "touristspot", importance: 2 },
  { name: "Guhyeshwari", lat: 27.713, lon: 85.353, type: "touristspot", importance: 2 },
  { name: "Sanga", lat: 27.633, lon: 85.45, type: "touristspot", importance: 2 },
  { name: "Tokha", lat: 27.767, lon: 85.35, type: "touristspot", importance: 2 },
  { name: "Kirtipur", lat: 27.677, lon: 85.283, type: "touristspot", importance: 2 },
  { name: "Thankot Village", lat: 27.685, lon: 85.267, type: "touristspot", importance: 2 },
  { name: "Bungamati", lat: 27.617, lon: 85.283, type: "touristspot", importance: 2 },
  { name: "Khokana", lat: 27.633, lon: 85.283, type: "touristspot", importance: 2 },
  { name: "Lubhu", lat: 27.65, lon: 85.35, type: "touristspot", importance: 2 },
  { name: "Sankhu", lat: 27.733, lon: 85.383, type: "touristspot", importance: 2 },
  { name: "Bhadgaon", lat: 27.671, lon: 85.426, type: "touristspot", importance: 2 },
  { name: "Bode", lat: 27.683, lon: 85.4, type: "touristspot", importance: 2 },
  { name: "Thimi", lat: 27.683, lon: 85.383, type: "touristspot", importance: 2 },
  { name: "Tenkhu", lat: 27.567, lon: 85.55, type: "touristspot", importance: 2 },
  { name: "Ghyaro", lat: 27.567, lon: 85.583, type: "touristspot", importance: 2 },
  { name: "Sarangkot", lat: 28.233, lon: 83.933, type: "touristspot", importance: 3 },
  { name: "Begnas Lake", lat: 28.183, lon: 83.983, type: "touristspot", importance: 3 },
  { name: "Phewa Lake", lat: 28.217, lon: 83.95, type: "touristspot", importance: 3 },
  { name: "Bindyabasini", lat: 28.2, lon: 83.983, type: "touristspot", importance: 2 },
  { name: "Gurkha Memorial", lat: 27.983, lon: 84.6, type: "touristspot", importance: 2 },
  { name: "Palpa Durbar", lat: 27.867, lon: 83.55, type: "touristspot", importance: 2 },
  { name: "Ranighat", lat: 27.95, lon: 83.45, type: "touristspot", importance: 2 },
];

/**
 * Standalone junction/hub nodes at key highway intersections, river crossings,
 * and transit hubs. These are places where travelers make routing decisions
 * but aren't captured by existing corridor waypoints.
 */
export const JUNCTION_NODES: CorridorWaypoint[] = [
  // East-West Highway junctions
  { name: "Chandragadhi", lat: 26.583, lon: 88.067, type: "junction", importance: 3 },
  { name: "Damak", lat: 26.667, lon: 87.683, type: "town", importance: 3 },
  { name: "Gauradaha", lat: 26.567, lon: 87.717, type: "town", importance: 2 },
  { name: "Nijgadh", lat: 27.200, lon: 85.150, type: "town", importance: 3 },
  { name: "Amlekhgunj", lat: 27.300, lon: 84.983, type: "town", importance: 2 },

  // Arniko Highway
  { name: "Panchkhal", lat: 27.650, lon: 85.600, type: "town", importance: 2 },

  // Prithvi Highway junctions
  { name: "Dumre", lat: 27.950, lon: 84.433, type: "junction", importance: 3 },
  { name: "Sandhikhark", lat: 27.967, lon: 84.550, type: "town", importance: 2 },

  // Mid-West junctions
  { name: "Ridi Bazaar", lat: 27.933, lon: 83.433, type: "town", importance: 2 },
  { name: "Thakurdwara", lat: 28.033, lon: 82.283, type: "town", importance: 2 },
  { name: "Manma", lat: 28.883, lon: 82.200, type: "town", importance: 2 },

  // Kathmandu Valley junctions
  { name: "Surya Binayak", lat: 27.683, lon: 85.350, type: "junction", importance: 2 },
  { name: "Gaushala", lat: 27.710, lon: 85.340, type: "junction", importance: 2 },

  // River crossings / strategic points
  { name: "Trishuli Bazaar", lat: 27.917, lon: 85.150, type: "town", importance: 2 },
  { name: "Betrawati", lat: 27.867, lon: 85.117, type: "town", importance: 2 },
  { name: "Muglin Bazaar", lat: 27.590, lon: 84.820, type: "town", importance: 2 },
];
