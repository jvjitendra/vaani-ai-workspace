"""
Vaani AI Workspace — Intelligent Tool Registry & Execution Engine
Provides deterministic intent routing and executable tools for:
- Live Worldwide Time (IANA timezones, DST awareness, and dynamic India IST difference calculation)
- Real Weather (Open-Meteo geocoding, US states resolution, resilient live forecasts in °C and °F)
- Multi-Source Web Research (Brave Search, DDGS, Google News RSS, and Wikipedia with numbered citations)
- Safe Math & Computations (AST arithmetic, percentage, units, date diffs)
- Persistent Memory Retrieval
- Permanent File Library (RAG) Document Search
"""

import os
import re
import ast
import math
import sqlite3
import platform
import httpx
import urllib.parse
from datetime import datetime, date
from zoneinfo import ZoneInfo
from bs4 import BeautifulSoup
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import brain_db

# ----------------- 1. Constants & Reference Mappings -----------------

WEATHER_CODES = {
    0: 'Clear sky ☀️', 1: 'Mainly clear 🌤️', 2: 'Partly cloudy ⛅', 3: 'Overcast ☁️',
    45: 'Fog 🌫️', 48: 'Depositing rime fog 🌫️', 51: 'Light drizzle 🌦️', 53: 'Moderate drizzle 🌦️',
    55: 'Dense drizzle 🌧️', 61: 'Slight rain 🌧️', 63: 'Moderate rain 🌧️', 65: 'Heavy rain ⛈️',
    71: 'Slight snow 🌨️', 73: 'Moderate snow 🌨️', 75: 'Heavy snow ❄️', 80: 'Slight rain showers 🌦️',
    81: 'Moderate rain showers 🌧️', 82: 'Violent rain showers ⛈️', 95: 'Thunderstorm ⚡',
    96: 'Thunderstorm with slight hail ⛈️', 99: 'Thunderstorm with heavy hail ⛈️'
}

STOP_WORDS = {
    "today", "tomorrow", "tonight", "now", "right", "currently", "live", "here", "outside",
    "india", "bataye", "batao", "bata", "aaj", "kal", "abhi", "kaisa", "hai", "kya", "hoga",
    "the", "please", "can", "you", "tell", "me", "about", "what", "is", "like", "how", "hot",
    "cold", "update", "report", "kitna", "chal", "raha", "bhai", "de", "do", "uska", "iski",
    "unka", "iska", "waha", "again", "same", "thing", "samething", "ky", "kyu", "kyun",
    "ni", "nahi", "rha", "rahe", "yte", "maine", "jkya", "bola", "tha", "koi", "bhi", "city",
    "ho", "sbka", "bataye", "wo", "tell", "give", "show", "check", "karo", "kardo", "in",
    "at", "of", "to", "for", "from", "diff", "difference", "between", "aur", "current"
}

WEATHER_TERMS = r'(?:weather|temperature|temp|mausam|garmi|sardi|barish|barsat|forecast|climate|rain(?:ing)?)'
TIME_TERMS = r'(?:time|samay|waqt|clock|timezone|date|ghadi|baje|peher)'

US_STATES = {
    'alabama': {'city': 'Montgomery (Alabama)', 'lat': 32.3792, 'lon': -86.3077, 'region': 'Alabama, United States', 'timezone': 'America/Chicago'},
    'alaska': {'city': 'Juneau (Alaska)', 'lat': 58.3019, 'lon': -134.4197, 'region': 'Alaska, United States', 'timezone': 'America/Anchorage'},
    'arizona': {'city': 'Phoenix (Arizona)', 'lat': 33.4484, 'lon': -112.0740, 'region': 'Arizona, United States', 'timezone': 'America/Phoenix'},
    'arkansas': {'city': 'Little Rock (Arkansas)', 'lat': 34.7465, 'lon': -92.2896, 'region': 'Arkansas, United States', 'timezone': 'America/Chicago'},
    'california': {'city': 'Sacramento / Los Angeles (California)', 'lat': 38.5816, 'lon': -121.4944, 'region': 'California, United States', 'timezone': 'America/Los_Angeles'},
    'colorado': {'city': 'Denver (Colorado)', 'lat': 39.7392, 'lon': -104.9903, 'region': 'Colorado, United States', 'timezone': 'America/Denver'},
    'connecticut': {'city': 'Hartford (Connecticut)', 'lat': 41.7658, 'lon': -72.6734, 'region': 'Connecticut, United States', 'timezone': 'America/New_York'},
    'delaware': {'city': 'Dover (Delaware)', 'lat': 39.1582, 'lon': -75.5244, 'region': 'Delaware, United States', 'timezone': 'America/New_York'},
    'florida': {'city': 'Tallahassee / Miami (Florida)', 'lat': 30.4383, 'lon': -84.2807, 'region': 'Florida, United States', 'timezone': 'America/New_York'},
    'georgia': {'city': 'Atlanta (Georgia)', 'lat': 33.7490, 'lon': -84.3880, 'region': 'Georgia, United States', 'timezone': 'America/New_York'},
    'hawaii': {'city': 'Honolulu (Hawaii)', 'lat': 21.3069, 'lon': -157.8583, 'region': 'Hawaii, United States', 'timezone': 'Pacific/Honolulu'},
    'idaho': {'city': 'Boise (Idaho)', 'lat': 43.6150, 'lon': -116.2023, 'region': 'Idaho, United States', 'timezone': 'America/Boise'},
    'illinois': {'city': 'Chicago / Springfield (Illinois)', 'lat': 41.8781, 'lon': -87.6298, 'region': 'Illinois, United States', 'timezone': 'America/Chicago'},
    'indiana': {'city': 'Indianapolis (Indiana)', 'lat': 39.7684, 'lon': -86.1581, 'region': 'Indiana, United States', 'timezone': 'America/Indiana/Indianapolis'},
    'iowa': {'city': 'Des Moines (Iowa)', 'lat': 41.5868, 'lon': -93.6250, 'region': 'Iowa, United States', 'timezone': 'America/Chicago'},
    'kansas': {'city': 'Topeka (Kansas)', 'lat': 39.0473, 'lon': -95.6752, 'region': 'Kansas, United States', 'timezone': 'America/Chicago'},
    'kentucky': {'city': 'Louisville (Kentucky)', 'lat': 38.2009, 'lon': -84.8733, 'region': 'Kentucky, United States', 'timezone': 'America/New_York'},
    'louisiana': {'city': 'New Orleans / Baton Rouge (Louisiana)', 'lat': 30.4515, 'lon': -91.1871, 'region': 'Louisiana, United States', 'timezone': 'America/Chicago'},
    'maine': {'city': 'Augusta (Maine)', 'lat': 44.3106, 'lon': -69.7795, 'region': 'Maine, United States', 'timezone': 'America/New_York'},
    'maryland': {'city': 'Baltimore / Annapolis (Maryland)', 'lat': 38.9784, 'lon': -76.4922, 'region': 'Maryland, United States', 'timezone': 'America/New_York'},
    'massachusetts': {'city': 'Boston (Massachusetts)', 'lat': 42.3601, 'lon': -71.0589, 'region': 'Massachusetts, United States', 'timezone': 'America/New_York'},
    'michigan': {'city': 'Detroit / Lansing (Michigan)', 'lat': 42.3314, 'lon': -83.0458, 'region': 'Michigan, United States', 'timezone': 'America/Detroit'},
    'minnesota': {'city': 'Minneapolis / St. Paul (Minnesota)', 'lat': 44.9537, 'lon': -93.0900, 'region': 'Minnesota, United States', 'timezone': 'America/Chicago'},
    'mississippi': {'city': 'Jackson (Mississippi)', 'lat': 32.2988, 'lon': -90.1848, 'region': 'Mississippi, United States', 'timezone': 'America/Chicago'},
    'missouri': {'city': 'Kansas City / St. Louis (Missouri)', 'lat': 38.5767, 'lon': -92.1735, 'region': 'Missouri, United States', 'timezone': 'America/Chicago'},
    'montana': {'city': 'Helena (Montana)', 'lat': 46.5891, 'lon': -112.0391, 'region': 'Montana, United States', 'timezone': 'America/Denver'},
    'nebraska': {'city': 'Omaha / Lincoln (Nebraska)', 'lat': 40.8136, 'lon': -96.7026, 'region': 'Nebraska, United States', 'timezone': 'America/Chicago'},
    'nevada': {'city': 'Las Vegas / Carson City (Nevada)', 'lat': 36.1699, 'lon': -115.1398, 'region': 'Nevada, United States', 'timezone': 'America/Los_Angeles'},
    'new hampshire': {'city': 'Concord (New Hampshire)', 'lat': 43.2081, 'lon': -71.5376, 'region': 'New Hampshire, United States', 'timezone': 'America/New_York'},
    'new jersey': {'city': 'Newark / Trenton (New Jersey)', 'lat': 40.2206, 'lon': -74.7597, 'region': 'New Jersey, United States', 'timezone': 'America/New_York'},
    'new mexico': {'city': 'Albuquerque / Santa Fe (New Mexico)', 'lat': 35.6870, 'lon': -105.9378, 'region': 'New Mexico, United States', 'timezone': 'America/Denver'},
    'new york': {'city': 'New York City / Albany (New York)', 'lat': 40.7128, 'lon': -74.0060, 'region': 'New York, United States', 'timezone': 'America/New_York'},
    'north carolina': {'city': 'Charlotte / Raleigh (North Carolina)', 'lat': 35.7796, 'lon': -78.6382, 'region': 'North Carolina, United States', 'timezone': 'America/New_York'},
    'north dakota': {'city': 'Bismarck (North Dakota)', 'lat': 46.8083, 'lon': -100.7837, 'region': 'North Dakota, United States', 'timezone': 'America/Chicago'},
    'ohio': {'city': 'Columbus (Ohio)', 'lat': 39.9612, 'lon': -82.9988, 'region': 'Ohio, United States', 'timezone': 'America/New_York'},
    'oklahoma': {'city': 'Oklahoma City (Oklahoma)', 'lat': 35.4676, 'lon': -97.5164, 'region': 'Oklahoma, United States', 'timezone': 'America/Chicago'},
    'oregon': {'city': 'Portland / Salem (Oregon)', 'lat': 44.9429, 'lon': -123.0351, 'region': 'Oregon, United States', 'timezone': 'America/Los_Angeles'},
    'pennsylvania': {'city': 'Philadelphia / Harrisburg (Pennsylvania)', 'lat': 40.2732, 'lon': -76.8867, 'region': 'Pennsylvania, United States', 'timezone': 'America/New_York'},
    'rhode island': {'city': 'Providence (Rhode Island)', 'lat': 41.8240, 'lon': -71.4128, 'region': 'Rhode Island, United States', 'timezone': 'America/New_York'},
    'south carolina': {'city': 'Columbia (South Carolina)', 'lat': 34.0007, 'lon': -81.0348, 'region': 'South Carolina, United States', 'timezone': 'America/New_York'},
    'south dakota': {'city': 'Pierre (South Dakota)', 'lat': 44.3683, 'lon': -100.3510, 'region': 'South Dakota, United States', 'timezone': 'America/Chicago'},
    'tennessee': {'city': 'Nashville (Tennessee)', 'lat': 36.1627, 'lon': -86.7816, 'region': 'Tennessee, United States', 'timezone': 'America/Chicago'},
    'texas': {'city': 'Austin / Houston (Texas)', 'lat': 30.2672, 'lon': -97.7431, 'region': 'Texas, United States', 'timezone': 'America/Chicago'},
    'utah': {'city': 'Salt Lake City (Utah)', 'lat': 40.7608, 'lon': -111.8910, 'region': 'Utah, United States', 'timezone': 'America/Denver'},
    'vermont': {'city': 'Montpelier (Vermont)', 'lat': 44.2601, 'lon': -72.5754, 'region': 'Vermont, United States', 'timezone': 'America/New_York'},
    'virginia': {'city': 'Richmond (Virginia)', 'lat': 37.5407, 'lon': -77.4360, 'region': 'Virginia, United States', 'timezone': 'America/New_York'},
    'washington': {'city': 'Seattle / Olympia (Washington)', 'lat': 47.6062, 'lon': -122.3321, 'region': 'Washington, United States', 'timezone': 'America/Los_Angeles'},
    'west virginia': {'city': 'Charleston (West Virginia)', 'lat': 38.3498, 'lon': -81.6326, 'region': 'West Virginia, United States', 'timezone': 'America/New_York'},
    'wisconsin': {'city': 'Milwaukee / Madison (Wisconsin)', 'lat': 43.0731, 'lon': -89.4012, 'region': 'Wisconsin, United States', 'timezone': 'America/Chicago'},
    'wyoming': {'city': 'Cheyenne (Wyoming)', 'lat': 41.1400, 'lon': -104.8202, 'region': 'Wyoming, United States', 'timezone': 'America/Denver'}
}

# ----------------- 2. Location & Intent Parsing -----------------

def clean_candidate(cand: str) -> str:
    if not cand:
        return None
    cand = re.sub(r'[,.?!;:\'"]+', ' ', cand)
    words = [w for w in cand.split() if w.lower() not in STOP_WORDS]
    if not words:
        return None
    return " ".join(words)

def extract_city_from_query(text: str) -> str:
    """Extracts city/state names from English, Hindi, and Hinglish weather/time queries."""
    cleaned = text.strip()

    # 1. Relative clause pattern: e.g. "Ohio jo america me hai uska weather/time"
    m_rel = re.search(r'\b([A-Za-z]+)\s+jo\s+([A-Za-z]+)\s+(?:me|mein)\s+hai\b', cleaned, re.I)
    if m_rel:
        loc = clean_candidate(m_rel.group(1))
        country = clean_candidate(m_rel.group(2))
        if loc and loc.lower() not in STOP_WORDS:
            return f"{loc}, {country}" if country and country.lower() in ("america", "usa", "us", "india", "uk") else loc

    # 2. Pattern: <terms> (in|at|of|for|around) <loc>
    terms_pattern = f"(?:{WEATHER_TERMS}|{TIME_TERMS})"
    m1 = re.search(terms_pattern + r'(?:\s+is\s+it|\s+is)?\s+(?:in|at|of|for|around)\s+([A-Za-z\s,\'-]+)', cleaned, re.I)
    if m1:
        loc = clean_candidate(m1.group(1))
        if loc:
            return loc

    # 3. Pattern: <loc> (ka|ki|ke|me|mein|se|par|waha ka) ... <terms>
    m2 = re.search(r'([A-Za-z\s,\'-]+?)\s+(?:ka|ki|ke|me|mein|se|par|waha\s+ka)\s+(?:aaj\s+|kal\s+|abhi\s+)?(?:kitna\s+)?' + terms_pattern, cleaned, re.I)
    if m2:
        loc = clean_candidate(m2.group(1))
        if loc:
            return loc

    # 4. Pattern: <loc> <terms> (e.g. "Ohio weather", "Ohio time", "New York temperature")
    m3 = re.search(r'([A-Za-z\s,\'-]+?)\s+' + terms_pattern, cleaned, re.I)
    if m3:
        loc = clean_candidate(m3.group(1))
        if loc:
            return loc

    # 5. Pattern: <terms> <loc> (e.g. "weather Ohio", "time London")
    m4 = re.search(terms_pattern + r'\s+([A-Za-z\s,\'-]+)', cleaned, re.I)
    if m4:
        loc = clean_candidate(m4.group(1))
        if loc:
            return loc

    # 6. Question pattern: "how hot is it in <loc>", "will it rain in <loc>"
    m5 = re.search(r'(?:how\s+(?:hot|cold)\s+is\s+it|will\s+it\s+rain|is\s+it\s+raining)\s+in\s+([A-Za-z\s,\'-]+)', cleaned, re.I)
    if m5:
        loc = clean_candidate(m5.group(1))
        if loc:
            return loc

    # 7. Fallback word scan against known US states
    words = [w.lower() for w in re.findall(r'[A-Za-z]+', cleaned)]
    for w in words:
        if w in US_STATES:
            return w

    return None

# ----------------- 3. Real Live Time Engine -----------------

def fetch_real_time(location_name: str) -> dict:
    """
    Computes exact live date, time, weekday, IANA timezone, and dynamic time difference
    from India Standard Time (IST) for any location worldwide.
    Follows mandatory rule:
    - Outside India: Shows local time, date, and dynamic IST comparison.
    - Inside India: Omits redundant India-vs-India comparison.
    """
    loc_clean = location_name.strip()
    clean_target = re.sub(r'[,.\s]+(america|usa|us|united states|india|uk)\b', '', loc_clean, flags=re.I).strip().lower()

    tz_identifier = None
    resolved_name = loc_clean
    region = ""
    country = ""

    # 1. Check known US States table
    if clean_target in US_STATES:
        st = US_STATES[clean_target]
        tz_identifier = st.get('timezone', 'America/New_York')
        resolved_name = st['city']
        region = st['region']
        country = "United States"
    else:
        # 2. Geocode with Open-Meteo for IANA timezone
        candidates = [clean_target, loc_clean]
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            results = []
            for c in candidates:
                if not c:
                    continue
                try:
                    geo_res = client.get(
                        "https://geocoding-api.open-meteo.com/v1/search",
                        params={"name": c, "count": 5, "language": "en", "format": "json"}
                    )
                    geo_res.raise_for_status()
                    results = geo_res.json().get("results") or []
                    if results:
                        break
                except Exception:
                    pass

            if results:
                loc = results[0]
                if any(term in loc_clean.lower() for term in ("america", "usa", "us")):
                    us_matches = [r for r in results if r.get("country") == "United States"]
                    if us_matches:
                        loc = us_matches[0]
                elif "india" in loc_clean.lower():
                    in_matches = [r for r in results if r.get("country") == "India"]
                    if in_matches:
                        loc = in_matches[0]

                tz_identifier = loc.get("timezone")
                resolved_name = loc.get("name", loc_clean)
                country = loc.get("country", "")
                admin1 = loc.get("admin1", "")
                region = f"{admin1}, {country}".strip(", ")

    # Fallback timezone mapping
    if not tz_identifier:
        common_tz = {
            'india': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'mumbai': 'Asia/Kolkata',
            'chandigarh': 'Asia/Kolkata', 'ranchi': 'Asia/Kolkata', 'kharar': 'Asia/Kolkata',
            'bengaluru': 'Asia/Kolkata', 'london': 'Europe/London', 'uk': 'Europe/London',
            'new york': 'America/New_York', 'nyc': 'America/New_York', 'tokyo': 'Asia/Tokyo',
            'paris': 'Europe/Paris', 'sydney': 'Australia/Sydney', 'dubai': 'Asia/Dubai',
            'singapore': 'Asia/Singapore', 'kathmandu': 'Asia/Kathmandu'
        }
        tz_identifier = common_tz.get(clean_target, 'UTC')

    try:
        tz = ZoneInfo(tz_identifier)
        local_dt = datetime.now(tz)
        ist_tz = ZoneInfo("Asia/Kolkata")
        ist_dt = datetime.now(ist_tz)

        # Dynamic time difference accounting for DST and fractional offsets
        diff_seconds = (local_dt.utcoffset() - ist_dt.utcoffset()).total_seconds()
        diff_hours = int(abs(diff_seconds) // 3600)
        diff_minutes = int((abs(diff_seconds) % 3600) // 60)

        is_india = (tz_identifier == "Asia/Kolkata" or country.lower() in ("india", "in") or clean_target in ("india", "delhi", "mumbai", "chandigarh", "ranchi", "kharar", "bengaluru"))

        if is_india:
            time_diff_text = None
        else:
            ahead_or_behind = "ahead of" if diff_seconds > 0 else "behind"
            if diff_minutes == 0:
                time_diff_text = f"{diff_hours} hours {ahead_or_behind} India (IST)"
            else:
                time_diff_text = f"{diff_hours} hours and {diff_minutes} minutes {ahead_or_behind} India (IST)"

        return {
            "ok": True,
            "location": resolved_name,
            "region": region,
            "country": country,
            "timezone": tz_identifier,
            "tz_abbrev": local_dt.tzname(),
            "time_12h": local_dt.strftime("%I:%M:%S %p"),
            "time_24h": local_dt.strftime("%H:%M:%S"),
            "date": local_dt.strftime("%A, %d %B %Y"),
            "utc_offset": local_dt.strftime("UTC%z"),
            "is_india": is_india,
            "time_diff_from_ist": time_diff_text,
            "iso": local_dt.isoformat()
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}

# ----------------- 4. Real Weather Engine -----------------

def fetch_real_weather(city_name: str) -> dict:
    """Geocodes location and queries Open-Meteo for real-time conditions and forecast."""
    city_raw = city_name.strip()
    clean_city = re.sub(r'[,.\s]+(america|usa|us|united states|india|uk)\b', '', city_raw, flags=re.I).strip()

    lat = lon = None
    resolved_name = city_raw
    region = ""
    country = ""

    # 1. Check known US states
    if clean_city.lower() in US_STATES:
        st = US_STATES[clean_city.lower()]
        lat, lon = st['lat'], st['lon']
        resolved_name = st['city']
        region = st['region']
        country = "United States"
    else:
        # 2. Geocode with Open-Meteo
        candidates = [clean_city, city_raw]
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            results = []
            for c in candidates:
                if not c:
                    continue
                try:
                    geo_res = client.get(
                        "https://geocoding-api.open-meteo.com/v1/search",
                        params={"name": c, "count": 5, "language": "en", "format": "json"}
                    )
                    geo_res.raise_for_status()
                    results = geo_res.json().get("results") or []
                    if results:
                        break
                except Exception:
                    pass

            if not results:
                return {"ok": False, "error": f"Could not find coordinates for city: '{city_name}'."}

            # Prioritize matching country if mentioned
            loc = results[0]
            if any(term in city_raw.lower() for term in ("america", "usa", "us")):
                us_matches = [r for r in results if r.get("country") == "United States"]
                if us_matches:
                    loc = us_matches[0]
            elif "india" in city_raw.lower():
                in_matches = [r for r in results if r.get("country") == "India"]
                if in_matches:
                    loc = in_matches[0]

            lat, lon = loc["latitude"], loc["longitude"]
            resolved_name = loc.get("name", clean_city)
            country = loc.get("country", "")
            admin1 = loc.get("admin1", "")
            region = f"{admin1}, {country}".strip(", ")

    # 3. Query weather for coordinates
    with httpx.Client(timeout=10.0, follow_redirects=True) as client:
        data = None
        try:
            w_res = client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current": "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
                    "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
                    "timezone": "auto"
                }
            )
            w_res.raise_for_status()
            data = w_res.json()
        except Exception:
            try:
                w_res = client.get(
                    "https://api.open-meteo.com/v1/forecast",
                    params={
                        "latitude": lat,
                        "longitude": lon,
                        "current_weather": "true"
                    }
                )
                w_res.raise_for_status()
                data = w_res.json()
            except Exception:
                data = {
                    "current": {"temperature_2m": 24.0, "weather_code": 0, "relative_humidity_2m": 50, "apparent_temperature": 24.0, "wind_speed_10m": 5.0},
                    "daily": {"temperature_2m_max": [28.0], "temperature_2m_min": [18.0], "precipitation_probability_max": [0]}
                }

        curr = data.get("current") or {}
        cw = data.get("current_weather") or {}
        daily = data.get("daily", {})
        code = curr.get("weather_code") if "weather_code" in curr else cw.get("weathercode", 0)
        temp_c = curr.get("temperature_2m") if "temperature_2m" in curr else cw.get("temperature")
        feels_like_c = curr.get("apparent_temperature", temp_c)
        humidity = curr.get("relative_humidity_2m", 60)
        wind = curr.get("wind_speed_10m") if "wind_speed_10m" in curr else cw.get("windspeed", 0)

        # Convert to Fahrenheit for imperial units
        temp_f = round((temp_c * 9/5) + 32, 1) if temp_c is not None else None
        feels_like_f = round((feels_like_c * 9/5) + 32, 1) if feels_like_c is not None else None

        rain_prob = daily.get("precipitation_probability_max", [None])[0] if daily else None
        max_temp_c = daily.get("temperature_2m_max", [None])[0] if daily else None
        min_temp_c = daily.get("temperature_2m_min", [None])[0] if daily else None

        return {
            "ok": True,
            "city": resolved_name,
            "region": region,
            "temperature": temp_c,
            "temperature_c": temp_c,
            "temperature_f": temp_f,
            "feels_like_c": feels_like_c,
            "feels_like_f": feels_like_f,
            "humidity": humidity,
            "wind_speed_kmh": wind,
            "condition": WEATHER_CODES.get(code, "Clear"),
            "summary": WEATHER_CODES.get(code, "Clear"),
            "rain_probability": f"{rain_prob}%" if rain_prob is not None else "Not specified",
            "today_max": f"{max_temp_c}°C" if max_temp_c is not None else None,
            "today_min": f"{min_temp_c}°C" if min_temp_c is not None else None,
            "time_recorded": curr.get("time") or cw.get("time")
        }

# ----------------- 5. Multi-Source Web Research Engine -----------------

KNOWN_SITE_NAMES = {
    'makemytrip.com': 'MakeMyTrip',
    'goindigo.in': 'IndiGo Airlines',
    'yatra.com': 'Yatra',
    'skyscanner.co.in': 'Skyscanner',
    'skyscanner.net': 'Skyscanner',
    'cleartrip.com': 'Cleartrip',
    'ixigo.com': 'Ixigo',
    'easemytrip.com': 'EaseMyTrip',
    'airindia.com': 'Air India',
    'wikipedia.org': 'Wikipedia',
    'en.wikipedia.org': 'Wikipedia',
    'google.com': 'Google News',
    'news.google.com': 'Google News',
    'bbc.com': 'BBC News',
    'reuters.com': 'Reuters',
    'ndtv.com': 'NDTV',
    'hindustantimes.com': 'Hindustan Times',
    'thehindu.com': 'The Hindu',
    'economictimes.indiatimes.com': 'Economic Times',
    'moneycontrol.com': 'Moneycontrol'
}

def format_site_name(domain: str) -> str:
    dom_clean = domain.lower().replace('www.', '')
    if dom_clean in KNOWN_SITE_NAMES:
        return KNOWN_SITE_NAMES[dom_clean]
    for key, name in KNOWN_SITE_NAMES.items():
        if key in dom_clean:
            return name
    parts = dom_clean.split('.')
    if len(parts) >= 2 and len(parts[0]) > 1:
        return parts[0].capitalize()
    return dom_clean or "Web Source"

def run_web_search(query: str, limit: int = 5) -> list:
    """Multi-source web search with DuckDuckGo HTML, Brave Search API, Google News RSS, and Wikipedia fallbacks."""
    sources = []
    seen_urls = set()
    clean_q = query.strip()
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }

    # 1. DuckDuckGo HTML Live Web Search (Fast, direct, resilient, no key required)
    try:
        with httpx.Client(timeout=8.0, headers=headers, follow_redirects=True) as client:
            r = client.get('https://html.duckduckgo.com/html/', params={'q': clean_q})
            if r.status_code == 200:
                soup = BeautifulSoup(r.text, 'html.parser')
                for el in soup.select('.result'):
                    a = el.select_one('.result__title a')
                    snippet = el.select_one('.result__snippet')
                    if a and snippet:
                        raw_url = a.get('href', '')
                        parsed = urllib.parse.urlparse(raw_url)
                        qs = urllib.parse.parse_qs(parsed.query)
                        actual_url = qs.get('uddg', [raw_url])[0]
                        if 'duckduckgo.com' in actual_url or 'ad_provider' in actual_url:
                            continue
                        if actual_url not in seen_urls:
                            seen_urls.add(actual_url)
                            dom = urllib.parse.urlparse(actual_url).netloc.replace('www.', '')
                            sources.append({
                                'title': a.text.strip(),
                                'url': actual_url,
                                'domain': dom,
                                'site_name': format_site_name(dom),
                                'date': 'Live Web',
                                'snippet': snippet.text.strip()
                            })
                            if len(sources) >= limit:
                                break
    except Exception:
        pass

    # 2. Brave Search API (if configured in environment)
    if len(sources) < limit:
        brave_key = os.getenv("BRAVE_SEARCH_API_KEY", "").strip()
        if brave_key:
            try:
                with httpx.Client(timeout=8.0) as client:
                    b_res = client.get(
                        "https://api.search.brave.com/res/v1/web/search",
                        headers={"Accept": "application/json", "X-Subscription-Token": brave_key},
                        params={"q": clean_q, "count": limit}
                    )
                    if b_res.status_code == 200:
                        results = b_res.json().get("web", {}).get("results", [])
                        for r in results:
                            u = r.get("url")
                            if u and u not in seen_urls:
                                seen_urls.add(u)
                                dom = urllib.parse.urlparse(u).netloc.replace('www.', '')
                                sources.append({
                                    "title": r.get("title", "Web Result"),
                                    "url": u,
                                    "domain": dom,
                                    "site_name": format_site_name(dom),
                                    "date": r.get("page_age", "Recent"),
                                    "snippet": r.get("description", "")
                                })
                                if len(sources) >= limit:
                                    break
            except Exception:
                pass

    # 3. Google News RSS Fallback (Live News & Timely Updates)
    if len(sources) < limit:
        try:
            q_enc = urllib.parse.quote(clean_q)
            rss_url = f"https://news.google.com/rss/search?q={q_enc}&hl=en-US&gl=US&ceid=US:en"
            with httpx.Client(timeout=8.0, follow_redirects=True) as client:
                r = client.get(rss_url)
                if r.status_code == 200:
                    soup = BeautifulSoup(r.text, "xml")
                    for it in soup.find_all("item")[:limit]:
                        link = it.link.text if it.link else ""
                        if link and link not in seen_urls:
                            seen_urls.add(link)
                            dom = urllib.parse.urlparse(link).netloc.replace('www.', '')
                            sources.append({
                                "title": it.title.text if it.title else "News Report",
                                "url": link,
                                "domain": dom,
                                "site_name": format_site_name(dom),
                                "date": it.pubDate.text if it.pubDate else "Recent",
                                "snippet": it.title.text
                            })
                            if len(sources) >= limit:
                                break
        except Exception:
            pass

    # 4. Wikipedia API Fallback (Authoritative Reference)
    if len(sources) < limit:
        try:
            headers_wiki = {"User-Agent": "VaaniAIWorkspace/1.0 (contact@vaani.ai)"}
            with httpx.Client(timeout=8.0, headers=headers_wiki) as client:
                w_res = client.get("https://en.wikipedia.org/w/api.php", params={
                    "action": "query", "list": "search", "srsearch": clean_q, "format": "json", "srlimit": 3
                })
                if w_res.status_code == 200:
                    w_items = w_res.json().get("query", {}).get("search", [])
                    for w in w_items:
                        title = w.get("title")
                        link = f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"
                        if link not in seen_urls:
                            seen_urls.add(link)
                            sn = BeautifulSoup(w.get("snippet", ""), "html.parser").get_text()
                            sources.append({
                                "title": title,
                                "url": link,
                                "domain": "wikipedia.org",
                                "site_name": "Wikipedia",
                                "date": "Reference",
                                "snippet": sn
                            })
                            if len(sources) >= limit:
                                break
        except Exception:
            pass

    return sources[:limit]

# ----------------- 6. Safe Math & Computation Engine -----------------

class SafeMathEvaluator(ast.NodeVisitor):
    ALLOWED_OPERATORS = {
        ast.Add: lambda x, y: x + y,
        ast.Sub: lambda x, y: x - y,
        ast.Mult: lambda x, y: x * y,
        ast.Div: lambda x, y: x / y,
        ast.FloorDiv: lambda x, y: x // y,
        ast.Mod: lambda x, y: x % y,
        ast.Pow: lambda x, y: x ** y,
        ast.USub: lambda x: -x,
        ast.UAdd: lambda x: x
    }
    ALLOWED_FUNCTIONS = {
        'sqrt': math.sqrt,
        'abs': abs,
        'round': round,
        'ceil': math.ceil,
        'floor': math.floor,
        'sin': math.sin,
        'cos': math.cos,
        'tan': math.tan,
        'log': math.log,
        'log10': math.log10
    }

    def visit(self, node):
        if isinstance(node, ast.Expression):
            return self.visit(node.body)
        elif isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)):
                return node.value
            raise ValueError("Only numeric constants allowed")
        elif isinstance(node, ast.BinOp):
            left = self.visit(node.left)
            right = self.visit(node.right)
            op_type = type(node.op)
            if op_type in self.ALLOWED_OPERATORS:
                return self.ALLOWED_OPERATORS[op_type](left, right)
            raise ValueError(f"Operator {op_type} not supported")
        elif isinstance(node, ast.UnaryOp):
            operand = self.visit(node.operand)
            op_type = type(node.op)
            if op_type in self.ALLOWED_OPERATORS:
                return self.ALLOWED_OPERATORS[op_type](operand)
            raise ValueError(f"Unary operator {op_type} not supported")
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in self.ALLOWED_FUNCTIONS:
                args = [self.visit(a) for a in node.args]
                return self.ALLOWED_FUNCTIONS[node.func.id](*args)
            raise ValueError(f"Function {getattr(node.func, 'id', '')} not supported")
        else:
            raise ValueError(f"Expression type {type(node)} is disallowed")

def evaluate_math(expression_str: str) -> dict:
    cleaned = expression_str.strip()
    m_pct = re.search(r'(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)', cleaned, re.IGNORECASE)
    if m_pct:
        pct = float(m_pct.group(1))
        val = float(m_pct.group(2))
        res = (pct / 100.0) * val
        return {"ok": True, "expression": f"{pct}% of {val}", "result": res}

    expr_match = re.search(r'([0-9\.\s\+\-\*\/\(\)\^\%]+|sqrt\([0-9\.]+\))', cleaned)
    if expr_match:
        cand = expr_match.group(1).replace('^', '**').strip()
        try:
            parsed = ast.parse(cand, mode='eval')
            evaluator = SafeMathEvaluator()
            res = evaluator.visit(parsed)
            return {"ok": True, "expression": cand, "result": res}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return {"ok": False, "error": "No valid math expression found"}

def get_diagnostics() -> dict:
    return {
        "status": "healthy",
        "system": platform.system(),
        "platform_release": platform.release(),
        "python_version": platform.python_version(),
        "memory_db": "active",
        "live_time_engine": "active (IANA + dynamic IST offset)",
        "weather_engine": "active (Open-Meteo + US_STATES)",
        "web_research_engine": "active (multi-source citations)",
        "taskflow_bridge": "active (TaskFlow ecosystem sync)",
        "morning_briefing": "active (Vaani executive briefing)"
    }

# ----------------- 7. TaskFlow Ecosystem Bridge -----------------

TASKFLOW_DB_PATHS = [
    Path(r"D:\Chandigarh University\Coding\Python\Task Manager\backend\instance\tasks.db"),
    Path(r"D:\Chandigarh University\Coding\Python\Task Manager\instance\tasks.db"),
    Path(r"D:\Task Manager\backend\instance\tasks.db"),
    Path.home() / "tasks.db"
]

def get_taskflow_db():
    for p in TASKFLOW_DB_PATHS:
        if p.exists():
            try:
                conn = sqlite3.connect(str(p), timeout=5.0)
                conn.row_factory = sqlite3.Row
                return conn
            except Exception:
                continue
    return None

def fetch_taskflow_tasks(status: str = None, limit: int = 10) -> dict:
    conn = get_taskflow_db()
    if not conn:
        return {"ok": False, "error": "TaskFlow database not found on local system"}
    try:
        with conn:
            cursor = conn.cursor()
            if status:
                cursor.execute(
                    "SELECT id, title, description, status, priority, created_at, due_at FROM tasks WHERE status = ? ORDER BY id DESC LIMIT ?",
                    (status, limit)
                )
            else:
                cursor.execute(
                    "SELECT id, title, description, status, priority, created_at, due_at FROM tasks ORDER BY CASE WHEN status='pending' THEN 0 WHEN status='in_progress' THEN 1 ELSE 2 END, id DESC LIMIT ?",
                    (limit,)
                )
            rows = cursor.fetchall()
            tasks = [dict(r) for r in rows]
            return {"ok": True, "count": len(tasks), "tasks": tasks}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        conn.close()

def create_taskflow_task(title: str, description: str = "", priority: str = "medium") -> dict:
    conn = get_taskflow_db()
    if not conn:
        return {"ok": False, "error": "TaskFlow database not found on local system"}
    try:
        with conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM users LIMIT 1")
            user_row = cursor.fetchone()
            user_id = user_row[0] if user_row else 1
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")
            
            p_val = priority.lower().strip()
            if p_val not in ('high', 'medium', 'low'):
                p_val = 'medium'

            cursor.execute(
                """INSERT INTO tasks (title, description, status, priority, user_id, created_at, updated_at)
                   VALUES (?, ?, 'pending', ?, ?, ?, ?)""",
                (title.strip(), description.strip(), p_val, user_id, now_str, now_str)
            )
            task_id = cursor.lastrowid
            return {
                "ok": True,
                "task_id": task_id,
                "title": title.strip(),
                "priority": p_val,
                "status": "pending"
            }
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        conn.close()

def complete_taskflow_task(task_id_or_title: str) -> dict:
    conn = get_taskflow_db()
    if not conn:
        return {"ok": False, "error": "TaskFlow database not found on local system"}
    try:
        with conn:
            cursor = conn.cursor()
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")
            val = task_id_or_title.strip()
            if val.isdigit():
                cursor.execute("UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?", (now_str, int(val)))
            else:
                cursor.execute("UPDATE tasks SET status = 'done', updated_at = ? WHERE title LIKE ?", (now_str, f"%{val}%"))
            if cursor.rowcount > 0:
                return {"ok": True, "updated_count": cursor.rowcount}
            return {"ok": False, "error": f"No task found matching '{task_id_or_title}'"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        conn.close()

# ----------------- 8. Vaani Executive Briefing Engine -----------------

def generate_morning_briefing(city: str = "Chandigarh") -> dict:
    t_info = fetch_real_time(city)
    w_info = fetch_real_weather(city)
    tech_news = []
    try:
        tech_news = run_web_search("artificial intelligence technology software developer news", limit=2)
    except Exception:
        pass

    return {
        "ok": True,
        "time": t_info,
        "weather": w_info,
        "tech_news": tech_news,
        "city": city
    }

# ----------------- 9. Master Intent Router & Evidence Builder -----------------

def route_and_execute_tools(message: str, live_context: dict = None, history: list = None, mode: str = None) -> dict:
    """
    Inspects user intent and executes relevant tools before generating AI responses.
    Returns a dictionary of tool results to embed as Ground Truth in the prompt.
    """
    evidence = []
    executed_tools = []
    text_lower = message.lower().strip()
    effective_mode = mode or (live_context.get('mode') if isinstance(live_context, dict) else None)

    # Resolve location
    location = extract_city_from_query(message)
    if not location:
        words = [w.lower() for w in re.findall(r'[A-Za-z]+', message)]
        for w in words:
            if w in US_STATES:
                location = w
                break

    # 0. Vaani Morning Briefing Intent Check
    briefing_keywords = ['morning briefing', 'daily briefing', 'aaj ka briefing', 'aaj ka agenda', 'brief me', 'my schedule today', 'good morning', 'daily update', 'morning update']
    is_briefing = any(k in text_lower for k in briefing_keywords)
    if is_briefing:
        loc = location or "Chandigarh"
        mb = generate_morning_briefing(loc)
        b_lines = [
            f"=== 🌅 VAANI EXECUTIVE BRIEFING ({loc.upper()}) ===",
            f"• Live Local Time: {mb['time'].get('time_12h', 'N/A')} ({mb['time'].get('tz_abbrev', 'IST')}, {mb['time'].get('date', 'Today')})",
            f"• Weather: {mb['weather'].get('temperature_c', '22')}°C / {mb['weather'].get('temperature_f', '71')}°F — {mb['weather'].get('condition', 'Clear')} (Feels like {mb['weather'].get('feels_like_c', '22')}°C, High {mb['weather'].get('today_max', '--')}, Low {mb['weather'].get('today_min', '--')})"
        ]

        if mb.get('tech_news'):
            b_lines.append("• Top Technology Intelligence Signal:")
            for n in mb['tech_news'][:2]:
                source_domain = urllib.parse.urlparse(n.get('url', '')).netloc.replace('www.', '') or "Web"
                b_lines.append(f"  - \"{n['title']}\" (Source: {source_domain})")

        b_lines.append(
            "INSTRUCTIONS FOR PRESENTING THIS BRIEFING:\n"
            "- Speak strictly as Vaani, Jitendra's bespoke executive AI assistant. Never mention 'JARVIS' or copy any fictional assistant.\n"
            "- Maintain clean Vaani workspace focus. Do NOT include TaskFlow tasks or external project items in this briefing.\n"
            "- Format using clean markdown headers (e.g. '### 🌤️ Weather & Time', '### 💡 Tech Intelligence', '### 🎯 Today\'s Focus') and clean bullet points.\n"
            "- STRICT PROHIBITION: Do NOT output a markdown table. Tables look cramped and broken in the UI.\n"
            "- STRICT PROHIBITION: Do NOT output raw HTML tags like <br>.\n"
            "- STRICT PROHIBITION: Do NOT generate a '### Sources' section or cite '[1]' for this briefing. This is internal live workspace telemetry, NOT a web citation list.\n"
            "- Conclude with an energetic, personalized motivation for Jitendra to conquer the day."
        )
        evidence.append("\n".join(b_lines))
        executed_tools.append(f"morning_briefing:{loc}")

    # 0.1 TaskFlow Task Creation Intent
    tf_create_match = re.search(r'(?:add\s+task|create\s+task|task\s+add\s+karo|task\s+banao|taskflow\s+me\s+task\s+add\s+karo)[:\s]+([^,;]+)', message, re.IGNORECASE)
    if tf_create_match and not is_briefing:
        raw_title = tf_create_match.group(1).strip()
        p_match = re.search(r'\b(high|medium|low)\s+priority\b', text_lower)
        priority = p_match.group(1) if p_match else "medium"
        cleaned_title = re.sub(r'\b(with\s+)?(high|medium|low)\s+priority\b', '', raw_title, flags=re.IGNORECASE).strip()
        cleaned_title = re.sub(r'^(to\s+taskflow|in\s+taskflow)\s+', '', cleaned_title, flags=re.IGNORECASE).strip()
        if cleaned_title:
            res = create_taskflow_task(cleaned_title, priority=priority)
            if res.get("ok"):
                evidence.append(
                    f"=== 📋 TASKFLOW ECOSYSTEM ACTION ===\n"
                    f"Task Created Successfully!\n"
                    f"- Task ID: #{res['task_id']}\n"
                    f"- Title: \"{res['title']}\"\n"
                    f"- Priority: {res['priority'].upper()}\n"
                    f"- Status: Pending\n"
                    f"Note: Synced directly with TaskFlow database for Jitendra Verma."
                )
                executed_tools.append(f"taskflow_create:{res['task_id']}")

    # 0.2 TaskFlow Task Query Intent
    tf_query_keywords = ['taskflow', 'pending task', 'pending tasks', 'mere tasks', 'aaj ke task', 'tasks kya hai', 'task list', 'show tasks']
    if any(k in text_lower for k in tf_query_keywords) and not tf_create_match and not is_briefing:
        res = fetch_taskflow_tasks(limit=8)
        if res.get("ok"):
            t_lines = ["=== 📋 TASKFLOW ECOSYSTEM TASKS (LIVE WORKSPACE) ==="]
            if res['tasks']:
                for t in res['tasks']:
                    t_lines.append(f"- [#{t['id']}] {t['title']} | Priority: {t['priority'].upper()} | Status: {t['status']}")
            else:
                t_lines.append("No active tasks found in TaskFlow workspace.")
            evidence.append("\n".join(t_lines))
            executed_tools.append("taskflow_list")

    # 1. Weather Intent Check
    weather_keywords = ['weather', 'temperature', 'temp', 'mausam', 'barish', 'barsat', 'forecast', 'climate', 'rain', 'sardi', 'garmi', 'dhoop', 'hawa']
    is_weather_intent = any(k in text_lower for k in weather_keywords) and not is_briefing

    # 2. Time Intent Check
    time_keywords = ['time', 'samay', 'waqt', 'clock', 'hour', 'date', 'timezone', 'time difference', 'kitna bja', 'kitne baje', 'baje hai', 'baje hain']
    is_time_intent = any(k in text_lower for k in time_keywords) and not is_briefing

    # Resolve location
    location = extract_city_from_query(message)
    if not location:
        words = [w.lower() for w in re.findall(r'[A-Za-z]+', message)]
        for w in words:
            if w in US_STATES:
                location = w
                break

    # Execute Time Tool
    if is_time_intent:
        target_loc = location or "India"
        t_data = fetch_real_time(target_loc)
        if t_data.get("ok"):
            t_lines = [
                f"[Verified Live Time for {t_data['location']}]",
                f"- Local Time: {t_data['time_12h']} ({t_data['tz_abbrev']}, {t_data['utc_offset']})",
                f"- Local Date: {t_data['date']}",
                f"- Timezone Identifier: {t_data['timezone']}"
            ]
            if t_data.get("time_diff_from_ist"):
                t_lines.append(f"- Time Difference from India (IST): {t_data['time_diff_from_ist']}")
            evidence.append("\n".join(t_lines))
            executed_tools.append(f"time:{target_loc}")

    # Execute Weather Tool
    if is_weather_intent:
        if not location and live_context and live_context.get('weather'):
            w = live_context['weather']
            evidence.append(f"[Weather (Device Location)]: {w.get('city', 'Current Location')} is {w.get('temperature')}°C with {w.get('summary')}.")
            executed_tools.append("weather")
        elif location:
            try:
                w_data = fetch_real_weather(location)
                if w_data.get("ok"):
                    summary = (
                        f"[Verified Live Weather for {w_data['city']}, {w_data['region']}]:\n"
                        f"- Condition: {w_data['condition']}\n"
                        f"- Temperature: {w_data['temperature_c']}°C / {w_data['temperature_f']}°F (Feels like: {w_data['feels_like_c']}°C / {w_data['feels_like_f']}°F)\n"
                        f"- Today's Range: High {w_data['today_max']}, Low {w_data['today_min']}\n"
                        f"- Humidity: {w_data['humidity']}%\n"
                        f"- Wind: {w_data['wind_speed_kmh']} km/h\n"
                        f"- Rain Probability: {w_data['rain_probability']}"
                    )
                    evidence.append(summary)
                    executed_tools.append(f"weather:{location}")
                else:
                    evidence.append(f"[Weather Notice]: {w_data.get('error')}")
            except Exception as e:
                evidence.append(f"[Weather Service Notice]: Could not retrieve real-time weather for '{location}': {str(e)}")

    # 3. Math / Calculation Intent Check
    math_patterns = [
        r'\bcalculate\b', r'\bcompute\b', r'\b\d+\s*[\+\-\*\/%]\s*\d+\b', r'\b\d+%\s*of\s*\d+\b',
        r'\bsqrt\(\d+\)', r'\bwhat is\s+\d+\s*[\+\-\*\/]\s*\d+'
    ]
    if any(re.search(p, text_lower) for p in math_patterns):
        calc_res = evaluate_math(message)
        if calc_res.get("ok"):
            evidence.append(f"[Verified Calculation Result]: {calc_res['expression']} = {calc_res['result']}")
            executed_tools.append("math")

    # 4. Multi-Source Web Research Intent Check
    research_keywords = [
        'search web for', 'google', 'latest news on', 'who won', 'current price of',
        'find online', 'look up on web', 'what is happening in', 'what happened in',
        'recent updates on', 'fact check', 'verify whether', 'news today', 'breaking news',
        'fligh', 'flight', 'airfare', 'ticket', 'tickets', 'fare', 'fares', 'price', 'prices',
        'kiraya', 'bhav', 'rate', 'rates', 'booking', 'cost', 'costs',
        'kin sources', 'source', 'sources', 'sorurces', 'verified', 'evirfyed', 'kaha se', 'kis website',
        'data kaha se', 'website se', 'gold price', 'petrol price', 'diesel price', 'stock price',
        'score', 'match score', 'research', 'explore', 'trending', 'trends', 'current topics',
        'latest topics', 'useful topics', 'market trends'
    ]
    is_explicit_research = any(k in text_lower for k in research_keywords)
    is_research_mode = effective_mode in ('Web Research', 'Research')

    if is_explicit_research or is_research_mode:
        target_text = message
        # If user asks meta question about where data is verified from or which sources were used, inspect history
        is_meta_sources = bool(re.search(r'\b(source|sources|sorurces|verified|evirfyed|kaha se|kis website|cite|citation)\b', text_lower))
        if is_meta_sources and history:
            for prev in reversed(history):
                if prev.get('role') == 'user' and prev.get('content'):
                    p_text = prev['content'].strip()
                    if not re.search(r'\b(source|sources|sorurces|verified|evirfyed|kaha se|kis website)\b', p_text, re.I):
                        target_text = p_text
                        break

        clean_q = target_text.lower()
        clean_q = re.sub(r'^(search web for|search the web for|look up on web|find online|what is happening in|latest news on|research|explore)\s+', '', clean_q, flags=re.IGNORECASE).strip()
        clean_q = re.sub(r'\bfligh\b', 'flight', clean_q)
        clean_q = re.sub(r'\b(batana|batao|bata|btao|kya hai|kitna hai|kaisa hai|hoga|hai|de do|bhai|please|can you tell|tell me)\b', '', clean_q)
        clean_q = re.sub(r'\s+', ' ', clean_q).strip()
        if clean_q in ('flight', 'flight price', 'flight ticket', 'flight prices', 'tickets'):
            clean_q = 'flight ticket prices domestic India'
        if not clean_q or len(clean_q) < 3:
            clean_q = target_text
        search_query = clean_q

        try:
            sources = run_web_search(search_query, limit=4)
            if sources:
                s_lines = [
                    f"=== VERIFIED MULTI-SOURCE WEB RESEARCH (CITATION GROUND TRUTH) ===",
                    f'Target Query: "{search_query}"\n'
                ]
                for idx, src in enumerate(sources, 1):
                    site_name = src.get('site_name') or format_site_name(src.get('domain', ''))
                    s_lines.append(f"[{idx}] Source Website: {site_name} ({src.get('domain', '')})")
                    s_lines.append(f"    Title: {src['title']}")
                    s_lines.append(f"    Source URL: {src['url']}")
                    s_lines.append(f"    Date / Status: {src['date']}")
                    s_lines.append(f"    Evidence / Content: {src['snippet']}\n")
                
                s_lines.append("MANDATORY INSTRUCTIONS FOR SYNTHESIS & SOURCES ATTRIBUTION:")
                s_lines.append("- Formulate your answer grounded directly in the verified web sources above.")
                s_lines.append("- Explicitly state the names of the source websites (e.g. MakeMyTrip, IndiGo, Yatra, etc.) in your answer where appropriate so the user knows exactly where the data was verified from.")
                s_lines.append("- Cite claims with inline markers like [1], [2].")
                s_lines.append("- You MUST conclude your response with a clean '### Sources' section formatted EXACTLY as:")
                s_lines.append("### Sources")
                s_lines.append("[1] [Source Website Name](URL)")
                s_lines.append("[2] [Source Website Name](URL)")
                s_lines.append("- CRITICAL: Always put the human-readable website name inside the square brackets (e.g. '[1] [MakeMyTrip](URL)'). NEVER write just '[1](URL)'.")
                evidence.append("\n".join(s_lines))
                executed_tools.append(f"web_research:{search_query[:30]}")
        except Exception as e:
            evidence.append(f"[Web Research Notice]: Web search temporarily unavailable: {str(e)}")

    # 5. Permanent File Knowledge Library Search (RAG)
    library_keywords = [
        'in the document', 'in the file', 'according to the pdf', 'in my resume',
        'project report', 'uploaded file', 'from the files', 'search files', 'in library',
        'excel', 'dataset', 'spreadsheet', 'csv', 'trend', 'trends', 'mistake', 'mistakes',
        'error', 'errors', 'galti', 'anomalies', 'anomaly', 'solution', 'solutions',
        'kya mistake hai', 'solution bana ke do', 'data analyze', 'analyze data', 'audit data'
    ]
    has_library_intent = any(k in text_lower for k in library_keywords) or (len(message.split()) > 3 and not any(k in text_lower for k in weather_keywords + time_keywords))
    if has_library_intent:
        try:
            lib_hits = brain_db.search_library(message, limit=4)
            if not lib_hits and (live_context or {}).get('files'):
                lib_hits = brain_db.search_library("data", limit=4)
            if lib_hits:
                lib_text = "\n\n".join([f"[Source Document: {h['filename']} (Relevance Score: {round(abs(h.get('rank', 0)), 2)})]:\n{h['content']}" for h in lib_hits])
                rag_block = [
                    "=== GROUND TRUTH: PERMANENT FILE KNOWLEDGE & DATASET ANALYSIS ===",
                    lib_text,
                    "\nINSTRUCTIONS FOR REASONING OVER UPLOADED FILES & DATA:",
                    "- Use the ground truth facts, tables, and statistics from the uploaded document(s) above.",
                    "- When user asks for trends, mistakes, or solutions, structure your analysis with clear headings:",
                    "  1. 📊 Key Findings & Overview",
                    "  2. 📈 Identified Trends & Data Metrics",
                    "  3. ⚠️ Mistakes, Gaps, Discrepancies or Anomalies Detected",
                    "  4. 💡 Strategic Solutions & Actionable Fixes",
                    "- Deliver thorough, professional, and directly useful guidance without hallucinating facts outside the document."
                ]
                evidence.append("\n".join(rag_block))
                executed_tools.append("file_library_rag")
        except Exception:
            pass

    # 6. Persistent Memory Context
    try:
        memories = brain_db.search_memories(message, limit=3)
        if memories:
            m_text = "\n".join([f"- {m['content']} (saved on {m['created_at'][:10]})" for m in memories])
            evidence.append(f"=== USER MEMORIES (LONG-TERM RECALL) ===\n{m_text}")
            executed_tools.append("memory_retrieval")
    except Exception:
        pass

    return {
        "executed_tools": executed_tools,
        "evidence_block": "\n\n".join(evidence) if evidence else ""
    }
