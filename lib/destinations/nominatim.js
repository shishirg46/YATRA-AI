"use strict";
/**
 * lib/destinations/nominatim.ts
 * Nominatim API integration for reverse geocoding and place lookups
 * Using OpenStreetMap data
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
exports.calculateDistance = exports.isInNepal = exports.extractNepalRegion = exports.reverseGeocode = exports.searchPlace = void 0;
/**
 * Search for a place by name
 */
function searchPlace(query, options) {
    var _a;
    return __awaiter(this, void 0, void 0, function () {
        var params, response, error_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    params = new URLSearchParams({
                        q: query,
                        format: "jsonv2",
                        limit: String((_a = options === null || options === void 0 ? void 0 : options.limit) !== null && _a !== void 0 ? _a : 10),
                        addressdetails: "1"
                    });
                    if (options === null || options === void 0 ? void 0 : options.countrycodes) {
                        params.append("countrycodes", options.countrycodes);
                    }
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 4, , 5]);
                    return [4 /*yield*/, fetch("https://nominatim.openstreetmap.org/search?".concat(params), {
                            headers: {
                                Accept: "application/json",
                                "Accept-Language": "en-US",
                                "User-Agent": "YatraAI/1.0 (destination-enrichment)"
                            }
                        })];
                case 2:
                    response = _b.sent();
                    if (!response.ok) {
                        console.error("Nominatim search failed: ".concat(response.status));
                        return [2 /*return*/, []];
                    }
                    return [4 /*yield*/, response.json()];
                case 3: return [2 /*return*/, (_b.sent())];
                case 4:
                    error_1 = _b.sent();
                    console.error("Nominatim search error:", error_1);
                    return [2 /*return*/, []];
                case 5: return [2 /*return*/];
            }
        });
    });
}
exports.searchPlace = searchPlace;
/**
 * Reverse geocode coordinates to find place information
 */
function reverseGeocode(lat, lng, options) {
    var _a;
    return __awaiter(this, void 0, void 0, function () {
        var params, response, error_2;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    params = new URLSearchParams({
                        lat: String(lat),
                        lon: String(lng),
                        format: "jsonv2",
                        zoom: String((_a = options === null || options === void 0 ? void 0 : options.zoom) !== null && _a !== void 0 ? _a : 10),
                        addressdetails: "1"
                    });
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 4, , 5]);
                    return [4 /*yield*/, fetch("https://nominatim.openstreetmap.org/reverse?".concat(params), {
                            headers: {
                                Accept: "application/json",
                                "Accept-Language": "en-US",
                                "User-Agent": "YatraAI/1.0 (destination-enrichment)"
                            }
                        })];
                case 2:
                    response = _b.sent();
                    if (!response.ok) {
                        console.error("Nominatim reverse geocoding failed: ".concat(response.status));
                        return [2 /*return*/, null];
                    }
                    return [4 /*yield*/, response.json()];
                case 3: return [2 /*return*/, (_b.sent())];
                case 4:
                    error_2 = _b.sent();
                    console.error("Nominatim reverse geocoding error:", error_2);
                    return [2 /*return*/, null];
                case 5: return [2 /*return*/];
            }
        });
    });
}
exports.reverseGeocode = reverseGeocode;
/**
 * Extract Nepal region from Nominatim address
 */
function extractNepalRegion(address) {
    var _a, _b, _c, _d;
    if (!address)
        return null;
    return {
        province: (_a = address.state) !== null && _a !== void 0 ? _a : address.region,
        district: (_c = (_b = address.state_district) !== null && _b !== void 0 ? _b : address.county) !== null && _c !== void 0 ? _c : address.city_district,
        municipality: (_d = address.municipality) !== null && _d !== void 0 ? _d : address.city
    };
}
exports.extractNepalRegion = extractNepalRegion;
/**
 * Validate if coordinates are within Nepal bounds
 * Nepal bounds: ~26.3°N to ~30.5°N, ~80.0°E to ~88.2°E
 */
function isInNepal(lat, lng) {
    return lat >= 26.3 && lat <= 30.5 && lng >= 80.0 && lng <= 88.2;
}
exports.isInNepal = isInNepal;
/**
 * Calculate distance between two coordinates in kilometers
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
    var R = 6371; // Earth's radius in km
    var dLat = ((lat2 - lat1) * Math.PI) / 180;
    var dLng = ((lng2 - lng1) * Math.PI) / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
exports.calculateDistance = calculateDistance;
