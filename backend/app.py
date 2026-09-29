import os, json, re, mimetypes, io
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path

import httpx
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv
from openai import OpenAI

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

API_KEY = os.getenv("NVIDIA_API_KEY")
NVIDIA_BASE = os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:5500")

app = Flask(__name__)
CORS(app, origins="*")
client = OpenAI(api_key=API_KEY, base_url=NVIDIA_BASE, timeout=45.0)

MODE_PROMPTS = {
    "General": "Answer naturally and helpfully. Handle general knowledge, everyday questions, India/world topics, explanations and practical tasks.",
    "Coding Assistant": "Act as a careful software engineer. Explain architecture, code, debugging, APIs, databases and testing clearly. Prefer runnable examples.",
    "Interview Prep": "Act as an interview coach. Give concise, accurate answers, examples, follow-up questions and practical interview phrasing.",
    "Explain Simply": "Explain difficult topics in simple language with analogies and step-by-step structure. Avoid unnecessary jargon."
}
BASE_PROMPT = """You are Vaani, an AI workspace assistant.
Be useful, direct and honest. You can answer normal general questions; do not restrict yourself to coding.
Never claim you cannot access live information if the server supplied live context for the current request.
Never invent current weather, time, prices, scores or other live facts. If live context is absent, say that the information needs a live lookup.
Use the user's language naturally, including Hinglish when appropriate.
"""

MODEL_FALLBACK = "openai/gpt-oss-20b"
SUPPORTED_MODELS = {
    "openai/gpt-oss-20b",
    "qwen/qwen3-next-80b-a3b-instruct",
    "deepseek-ai/deepseek-v4-flash",
    "z-ai/glm-5.3",
}

def now_ist():
    return datetime.now(ZoneInfo("Asia/Kolkata")).isoformat()

def weather_code_summary(code):
    m={0:"Clear sky",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Rime fog",
       51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",61:"Light rain",63:"Rain",65:"Heavy rain",
       71:"Light snow",73:"Snow",75:"Heavy snow",80:"Rain showers",81:"Rain showers",82:"Heavy showers",
       95:"Thunderstorm",96:"Thunderstorm with hail",99:"Thunderstorm with hail"}
    return m.get(code,"Current conditions")

async def get_weather(city):
    async with httpx.AsyncClient(timeout=12) as h:
        g=await h.get("https://geocoding-api.open-meteo.com/v1/search",params={"name":city,"count":1,"language":"en","format":"json"})
        g.raise_for_status(); results=g.json().get("results") or []
        if not results: raise ValueError("Location not found")
        loc=results[0]
        return await get_weather_coords(loc["latitude"],loc["longitude"],loc.get("name",city),loc.get("country",""),h)

async def get_weather_coords(lat,lon,label="Your location",country="",client=None):
    own=client is None
    h=client or httpx.AsyncClient(timeout=12)
    try:
        w=await h.get("https://api.open-meteo.com/v1/forecast",params={
            "latitude":lat,"longitude":lon,"current":"temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m","timezone":"auto"
        })
        w.raise_for_status(); data=w.json(); cur=data["current"]
        return {"ok":True,"city":label,"country":country,"timezone":data.get("timezone"),
                "latitude":lat,"longitude":lon,"temperature":cur["temperature_2m"],"feels_like":cur["apparent_temperature"],
                "humidity":cur["relative_humidity_2m"],"wind":cur["wind_speed_10m"],
                "summary":weather_code_summary(cur["weather_code"]),"time":cur["time"]}
    finally:
        if own: await h.aclose()

def build_context(live):
    c=[f"Current server time in India (IST): {now_ist()}"]
    if isinstance(live,dict):
        if live.get("timezone"): c.append(f"Client timezone: {live['timezone']}")
        if live.get("weather"): c.append("Live weather data: "+json.dumps(live["weather"],ensure_ascii=False))
        if live.get("time_lookup"): c.append("Requested live time: "+json.dumps(live["time_lookup"],ensure_ascii=False))
        if live.get("files"): c.append("Uploaded file context: "+live["files"][:12000])
    return "\n".join(c)

def messages_for(message, history, mode, live):
    sys=BASE_PROMPT+"\nMode: "+MODE_PROMPTS.get(mode,MODE_PROMPTS["General"])+"\n\nLIVE CONTEXT:\n"+build_context(live)
    msgs=[{"role":"system","content":sys}]
    for x in (history or [])[-12:]:
        if x.get("role") in ("user","assistant") and x.get("content"):
            msgs.append({"role":x["role"],"content":str(x["content"])[:12000]})
    msgs.append({"role":"user","content":message[:20000]})
    return msgs

def extract_city(text):
    patterns=[r"(?:weather|temperature|forecast)\s+(?:in|at|of)\s+([A-Za-z .'-]+)",
              r"([A-Za-z .'-]+)\s+(?:ka|ki|ke)\s+(?:weather|temperature|mausam)",
              r"(?:weather|temperature|mausam)\s+(?:of|in)?\s*([A-Za-z .'-]+)"]
    for p in patterns:
        m=re.search(p,text,re.I)
        if m:return m.group(1).strip(" .?!,")
    return None

@app.get("/")
def root():
    return jsonify({"app":"Vaani","status":"ok","api_key_configured":bool(API_KEY)})

@app.get("/api/health")
def health():
    return jsonify({"ok":True,"api_key_configured":bool(API_KEY),"time_ist":now_ist()})

@app.get("/api/time")
def api_time():
    city=request.args.get("city","India")
    zones={"india":"Asia/Kolkata","delhi":"Asia/Kolkata","mumbai":"Asia/Kolkata","london":"Europe/London","new york":"America/New_York","tokyo":"Asia/Tokyo","dubai":"Asia/Dubai","singapore":"Asia/Singapore","sydney":"Australia/Sydney"}
    zone=zones.get(city.lower(),"Asia/Kolkata")
    d=datetime.now(ZoneInfo(zone))
    return jsonify({"ok":True,"city":city,"timezone":zone,"time":d.isoformat(),"formatted":d.strftime("%d %b %Y, %I:%M:%S %p")})

@app.get("/api/weather")
def api_weather():
    import asyncio
    lat=request.args.get("lat")
    lon=request.args.get("lon")
    try:
        if lat is not None and lon is not None:
            latf=float(lat); lonf=float(lon)
            if not (-90<=latf<=90 and -180<=lonf<=180): raise ValueError("Invalid coordinates")
            return jsonify(asyncio.run(get_weather_coords(latf,lonf,"Your location","")))
        city=request.args.get("city","India").strip()
        if city.lower() in ("india","bharat","all india"):
            city="New Delhi"
        return jsonify(asyncio.run(get_weather(city)))
    except Exception as e:return jsonify({"ok":False,"error":str(e)}),502

@app.get("/api/search")
def api_search():
    q=request.args.get("q","").strip()
    if not q:return jsonify({"ok":False,"error":"Missing query"}),400
    try:
        with httpx.Client(timeout=12,headers={"User-Agent":"Vaani/2.0"}) as h:
            r=h.get("https://api.duckduckgo.com/",params={"q":q,"format":"json","no_html":1,"skip_disambig":0})
            r.raise_for_status(); d=r.json()
        items=[]
        if d.get("AbstractText"): items.append({"title":d.get("Heading") or q,"text":d["AbstractText"],"url":d.get("AbstractURL")})
        for x in d.get("RelatedTopics",[])[:6]:
            if isinstance(x,dict) and x.get("Text"): items.append({"title":x.get("Text","")[:80],"text":x.get("Text"),"url":x.get("FirstURL")})
        return jsonify({"ok":True,"query":q,"results":items})
    except Exception as e:return jsonify({"ok":False,"error":str(e)}),502

@app.post("/api/files/analyze")
def analyze_file():
    f=request.files.get("file")
    if not f:return jsonify({"ok":False,"error":"No file"}),400
    if f.content_length and f.content_length>15*1024*1024:return jsonify({"ok":False,"error":"File exceeds 15 MB limit"}),413
    data=f.read()
    name=f.filename or "file"
    ext=Path(name).suffix.lower()
    try:
        text=""
        if ext in {".txt",".md",".csv",".json",".py",".js",".html",".css",".java",".cpp",".c"}:
            text=data.decode("utf-8","ignore")
        elif ext==".pdf":
            from pypdf import PdfReader
            text="\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages)
        elif ext in {".xlsx",".xlsm",".xls"}:
            import pandas as pd
            book=pd.ExcelFile(io.BytesIO(data))
            parts=[]
            for sheet in book.sheet_names[:10]:
                df=book.parse(sheet).head(100)
                parts.append(f"Sheet: {sheet}\n{df.to_csv(index=False)}")
            text="\n\n".join(parts)
        elif ext==".docx":
            from docx import Document
            doc=Document(io.BytesIO(data))
            text="\n".join(p.text for p in doc.paragraphs)
        else:
            return jsonify({"ok":False,"error":f"Unsupported file type: {ext}"}),400
        return jsonify({"ok":True,"name":name,"type":ext,"text":text[:120000],"characters":len(text)})
    except Exception as e:return jsonify({"ok":False,"error":str(e)}),422

def call_chat(model, msgs, stream=False):
    """Call NVIDIA and transparently fall back to the known-good GPT OSS 20B model on a transient/model failure."""
    try:
        return client.chat.completions.create(model=model,messages=msgs,temperature=0.45,max_tokens=1024,stream=stream)
    except Exception as first_error:
        if model != MODEL_FALLBACK:
            return client.chat.completions.create(model=MODEL_FALLBACK,messages=msgs,temperature=0.45,max_tokens=1024,stream=stream)
        raise first_error

@app.post("/api/chat")
def chat():
    data=request.get_json(force=True) or {}
    if not API_KEY:return jsonify({"error":"NVIDIA_API_KEY is not configured"}),500
    model=data.get("model") or MODEL_FALLBACK
    if model not in SUPPORTED_MODELS:
        model=MODEL_FALLBACK
    try:
        r=call_chat(model,messages_for(data.get("message",""),data.get("history"),data.get("mode","General"),data.get("live_context",{})),stream=False)
        return jsonify({"ok":True,"text":r.choices[0].message.content})
    except Exception as e:return jsonify({"error":str(e)}),502

@app.post("/api/chat/stream")
def chat_stream():
    data=request.get_json(force=True) or {}
    if not API_KEY:return jsonify({"error":"NVIDIA_API_KEY is not configured"}),500
    model=data.get("model") or MODEL_FALLBACK
    if model not in SUPPORTED_MODELS:
        model=MODEL_FALLBACK
    msgs=messages_for(data.get("message",""),data.get("history"),data.get("mode","General"),data.get("live_context",{}))
    def generate():
        try:
            stream=call_chat(model,msgs,stream=True)
            for chunk in stream:
                delta=chunk.choices[0].delta.content if chunk.choices else None
                if delta: yield "data: "+json.dumps({"text":delta})+"\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield "data: "+json.dumps({"error":str(e)})+"\n\n"
            yield "data: [DONE]\n\n"
    return Response(stream_with_context(generate()),mimetype="text/event-stream",headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})

if __name__=="__main__":
    print("Vaani backend:",BASE_DIR)
    print("NVIDIA API key configured:",bool(API_KEY))
    app.run(host="127.0.0.1",port=int(os.getenv("PORT","5288")),debug=True)
