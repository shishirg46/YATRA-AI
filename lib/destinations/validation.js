"use strict";
/**
 * lib/destinations/validation.ts
 * Data validation and normalization for destinations
 */
exports.__esModule = true;
exports.mapOSMTypeToCategory = exports.isValidCategory = exports.findProvinceForDistrict = exports.normalizeDistrict = exports.calculateQualityScore = exports.validateAltitude = exports.validateCoordinates = exports.areNamesSimilar = exports.normalizeName = void 0;
/**
 * Normalize a place name for comparison
 * - Convert to lowercase
 * - Remove diacritics
 * - Remove special characters
 * - Collapse whitespace
 */
function normalizeName(name) {
    return name
        .toLowerCase()
        .normalize("NFD") // Decompose accented characters
        .replace(/[\u0300-\u036f]/g, "") // Remove diacritical marks
        .replace(/[^a-z0-9\s]/g, "") // Remove special chars except spaces
        .replace(/\s+/g, " ") // Collapse whitespace
        .trim();
}
exports.normalizeName = normalizeName;
/**
 * Check if two names likely refer to the same place
 */
function areNamesSimilar(name1, name2, threshold) {
    if (threshold === void 0) { threshold = 0.7; }
    var norm1 = normalizeName(name1);
    var norm2 = normalizeName(name2);
    // Exact match after normalization
    if (norm1 === norm2)
        return true;
    // One contains the other
    if (norm1.includes(norm2) || norm2.includes(norm1))
        return true;
    // Levenshtein distance
    var distance = levenshteinDistance(norm1, norm2);
    var maxLength = Math.max(norm1.length, norm2.length);
    var similarity = 1 - distance / maxLength;
    return similarity >= threshold;
}
exports.areNamesSimilar = areNamesSimilar;
/**
 * Levenshtein distance - minimum edits to transform one string to another
 */
function levenshteinDistance(str1, str2) {
    var m = str1.length;
    var n = str2.length;
    var dp = Array(m + 1)
        .fill(null)
        .map(function () { return Array(n + 1).fill(0); });
    for (var i = 0; i <= m; i++)
        dp[i][0] = i;
    for (var j = 0; j <= n; j++)
        dp[0][j] = j;
    for (var i = 1; i <= m; i++) {
        for (var j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            }
            else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }
    return dp[m][n];
}
function validateCoordinates(lat, lng, strict) {
    if (strict === void 0) { strict = true; }
    // Check if coordinates are valid numbers
    if (!isFinite(lat) || !isFinite(lng)) {
        return { valid: false, inNepal: false, reason: "Invalid coordinates (NaN or Infinity)" };
    }
    // Check if coordinates are within valid ranges
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { valid: false, inNepal: false, reason: "Coordinates out of global range" };
    }
    // Check if in Nepal (26.3°N to 30.5°N, 80.0°E to 88.2°E)
    var inNepal = lat >= 26.3 && lat <= 30.5 && lng >= 80.0 && lng <= 88.2;
    if (strict && !inNepal) {
        return { valid: false, inNepal: false, reason: "Location is outside Nepal" };
    }
    // Check for obviously incorrect coordinates (e.g., all zeros)
    if (lat === 0 && lng === 0) {
        return {
            valid: strict,
            inNepal: false,
            reason: "Likely placeholder coordinates (0, 0)"
        };
    }
    return { valid: true, inNepal: inNepal };
}
exports.validateCoordinates = validateCoordinates;
/**
 * Validate altitude/elevation
 */
function validateAltitude(altitude) {
    if (altitude === null || altitude === undefined)
        return true;
    if (typeof altitude !== "number")
        return false;
    if (!isFinite(altitude))
        return false;
    // Nepal's elevation ranges from ~70m to ~8,848m (Everest)
    // Allow some margin
    return altitude >= 0 && altitude <= 9000;
}
exports.validateAltitude = validateAltitude;
function calculateQualityScore(factors) {
    var score = 0;
    var maxScore = 100;
    // Essential fields (weight: 40 points)
    if (factors.hasName)
        score += 10;
    if (factors.hasCoordinates && factors.coordinatesValid)
        score += 20;
    if (factors.coordinatesInNepal)
        score += 10;
    // Important fields (weight: 40 points)
    if (factors.hasCategory)
        score += 15;
    if (factors.hasAltitude)
        score += 10;
    if (factors.hasDescription)
        score += 15;
    // Trust & verification (weight: 20 points)
    if (factors.hasSource)
        score += 10;
    if (factors.hasVerification)
        score += 10;
    return Math.min(score, maxScore);
}
exports.calculateQualityScore = calculateQualityScore;
/**
 * Normalize district names to match our canonical list
 */
var NEPAL_DISTRICTS = {
    Koshi: [
        "Bhojpur",
        "Dhankuta",
        "Ilam",
        "Jhapa",
        "Khotang",
        "Morang",
        "Okhaldhunga",
        "Panchthar",
        "Sankhuwasabha",
        "Solukhumbu",
        "Sunsari",
        "Taplejung",
        "Terhathum",
        "Udayapur",
    ],
    Madhesh: [
        "Bara",
        "Dhanusha",
        "Mahottari",
        "Parsa",
        "Rautahat",
        "Saptari",
        "Sarlahi",
        "Siraha",
    ],
    Bagmati: [
        "Bhaktapur",
        "Chitwan",
        "Dhading",
        "Dolakha",
        "Kathmandu",
        "Kavrepalanchok",
        "Lalitpur",
        "Makwanpur",
        "Nuwakot",
        "Ramechhap",
        "Rasuwa",
        "Sindhuli",
        "Sindhupalchok",
    ],
    Gandaki: [
        "Baglung",
        "Gorkha",
        "Kaski",
        "Lamjung",
        "Manang",
        "Mustang",
        "Myagdi",
        "Nawalpur",
        "Parbat",
        "Syangja",
        "Tanahun",
    ],
    Lumbini: [
        "Arghakhanchi",
        "Banke",
        "Bardiya",
        "Dang",
        "Gulmi",
        "Kapilvastu",
        "Nawalparasi",
        "Palpa",
        "Pyuthan",
        "Rolpa",
        "Rupandehi",
        "Rukum",
    ],
    Karnali: [
        "Dailekh",
        "Dolpa",
        "Humla",
        "Jajarkot",
        "Jumla",
        "Kalikot",
        "Mugu",
        "Salyan",
        "Surkhet",
    ],
    Sudurpashchim: [
        "Achham",
        "Baitadi",
        "Bajhang",
        "Bajura",
        "Dadeldhura",
        "Darchula",
        "Doti",
        "Kailali",
        "Kanchanpur",
    ]
};
/**
 * Find the canonical district name
 */
function normalizeDistrict(input) {
    var normalized = normalizeName(input);
    for (var _i = 0, _a = Object.values(NEPAL_DISTRICTS); _i < _a.length; _i++) {
        var districts = _a[_i];
        var found = districts.find(function (d) { return normalizeName(d) === normalized; });
        if (found)
            return found;
    }
    return null;
}
exports.normalizeDistrict = normalizeDistrict;
/**
 * Find the province for a district
 */
function findProvinceForDistrict(district) {
    var normalized = normalizeName(district);
    for (var _i = 0, _a = Object.entries(NEPAL_DISTRICTS); _i < _a.length; _i++) {
        var _b = _a[_i], province = _b[0], districts = _b[1];
        if (districts.some(function (d) { return normalizeName(d) === normalized; })) {
            return province;
        }
    }
    return null;
}
exports.findProvinceForDistrict = findProvinceForDistrict;
/**
 * Validate destination category
 */
function isValidCategory(category) {
    var validCategories = [
        "VIEWPOINT",
        "TREKKING_VILLAGE",
        "LAKE",
        "HILL",
        "MOUNTAIN",
        "TOURIST_ATTRACTION",
        "MUNICIPALITY",
        "CHOWK",
        "TEMPLE",
        "RIVERSIDE",
        "FOREST",
        "WATERFALL",
        "CAMP",
        "MOUNTAIN_SETTLEMENT",
        "OTHER",
    ];
    return validCategories.includes(category);
}
exports.isValidCategory = isValidCategory;
/**
 * Map common place types to our categories
 */
function mapOSMTypeToCategory(osmType, osmClass) {
    var mapping = {
        amenity: {
            place_of_worship: "TEMPLE",
            restaurant: "TOURIST_ATTRACTION",
            hotel: "TOURIST_ATTRACTION",
            cafe: "TOURIST_ATTRACTION",
            parking: "TOURIST_ATTRACTION"
        },
        tourism: {
            viewpoint: "VIEWPOINT",
            camp_site: "CAMP",
            alpine_hut: "CAMP",
            guest_house: "TOURIST_ATTRACTION",
            hotel: "TOURIST_ATTRACTION",
            attraction: "TOURIST_ATTRACTION"
        },
        natural: {
            water: "LAKE",
            wood: "FOREST",
            peak: "HILL"
        },
        waterway: {
            waterfall: "WATERFALL",
            river: "RIVERSIDE"
        },
        historic: {
            archaeological_site: "TOURIST_ATTRACTION",
            monument: "TOURIST_ATTRACTION",
            castle: "TOURIST_ATTRACTION"
        }
    };
    if (mapping[osmClass] && mapping[osmClass][osmType]) {
        return mapping[osmClass][osmType];
    }
    // Default category for unmatched types
    return "OTHER";
}
exports.mapOSMTypeToCategory = mapOSMTypeToCategory;
