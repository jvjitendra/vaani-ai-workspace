import os, json, re, mimetypes, io, base64, hashlib, time
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path

import httpx
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv
from openai import OpenAI
import sys
from pathlib import Path

BASE_DIR=Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import brain_db
import tools

APP_VERSION='v1'
load_dotenv(BASE_DIR/'.env')
# Multi-key & backup key pool support for high availability and zero rate-limit downtime
raw_groq = os.getenv('GROQ_API_KEY', '') + ',' + os.getenv('GROQ_BACKUP_API_KEY', '')
GROQ_KEYS = [k.strip() for k in raw_groq.split(',') if k.strip()]
GROQ_API_KEY = GROQ_KEYS[0] if GROQ_KEYS else ''

raw_gemini = os.getenv('GEMINI_API_KEY', '') + ',' + os.getenv('GEMINI_BACKUP_API_KEY', '')
GEMINI_KEYS = [k.strip() for k in raw_gemini.split(',') if k.strip()]
GEMINI_API_KEY = GEMINI_KEYS[0] if GEMINI_KEYS else ''

GROQ_BASE='https://api.groq.com/openai/v1'
GROQ_MODEL=os.getenv('GROQ_MODEL','qwen/qwen3.8-27b')
GROQ_FALLBACK_MODELS=['qwen/qwen3.8-27b','openai/gpt-oss-120b','openai/gpt-oss-20b']
GEMINI_MODEL=os.getenv('GEMINI_MODEL','gemini-3.8-flash')
GEMINI_VISION_FALLBACKS=[x.strip() for x in os.getenv('GEMINI_VISION_FALLBACKS','gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash').split(',') if x.strip()]
if GEMINI_MODEL not in GEMINI_VISION_FALLBACKS: GEMINI_VISION_FALLBACKS.insert(0,GEMINI_MODEL)
GEMINI_IMAGE_MODEL=os.getenv('GEMINI_IMAGE_MODEL','gemini-3.1-flash-image')
GEMINI_VIDEO_MODEL=os.getenv('GEMINI_VIDEO_MODEL','veo-3.1-generate-preview')
FRONTEND_ORIGIN=os.getenv('FRONTEND_ORIGIN','https://vaani-ai-workspace-frontend.vercel.app')

app=Flask(__name__)
app.config['MAX_CONTENT_LENGTH']=20*1024*1024
allowed=[x.strip() for x in FRONTEND_ORIGIN.split(',') if x.strip()]
allowed += ['http://127.0.0.1:5500','http://localhost:5500','http://127.0.0.1:5288','http://localhost:5288','http://127.0.0.1:5050','http://localhost:5050','http://127.0.0.1:8080','http://localhost:8080']
CORS(app, origins=allowed or '*')

groq_clients = [OpenAI(api_key=k, base_url=GROQ_BASE, timeout=90.0) for k in GROQ_KEYS]
groq_client = groq_clients[0] if groq_clients else None

try:
    from google import genai
    from google.genai import types as genai_types
    gemini_clients = [genai.Client(api_key=k) for k in GEMINI_KEYS]
    gemini_client = gemini_clients[0] if gemini_clients else None
except Exception:
    genai=None;genai_types=None;gemini_clients=[];gemini_client=None

MODE_PROMPTS={
 'General':'Answer naturally and helpfully. Handle general knowledge, practical questions, explanations and everyday tasks.',
 'Coding Assistant':'Act as a careful software engineer. Explain architecture, code, debugging, APIs, databases and testing clearly. Prefer runnable examples.',
 'Interview Prep':'Act as an interview coach. Give accurate answers, examples, follow-up questions and practical interview phrasing.',
 'Explain Simply':'Explain difficult topics in simple language with analogies and step-by-step structure. Avoid unnecessary jargon.',
 'Web Research':'Act as an autonomous web researcher. Ground your claims in the verified multi-source research evidence and cite sources with clickable links.'}
BASE_PROMPT='''You are Vaani, an intelligent and bespoke AI workspace assistant.
Be useful, direct, elegant, honest and readable. Use the user's language naturally, including Hinglish when appropriate.
Never refer to yourself as JARVIS or copy any fictional AI assistant. Your identity is strictly Vaani.
Never invent current facts such as weather, time, prices or scores. If verified ground truth tool evidence is supplied, treat it as ground truth.
When the user asks for the time or weather of a specific location, always use the verified live data provided for that location. If the requested location is outside India, include its local time and the dynamic time difference from India (IST). When inside India, avoid redundant comparisons.
For questions requiring external web research, flight prices, travel fares, or live web news where web URLs are provided, ground your statements in the supplied verified search evidence, explicitly state the names of the source websites (e.g. MakeMyTrip, IndiGo, Yatra) in your explanation, cite claims with inline markers [1], [2], and ALWAYS conclude with a clean '### Sources' section containing clean, clickable Markdown links formatted as: [1] [Website Name](URL). Never write just '[1](URL)'.
STRICT CITATION RULE: NEVER cite internal tool evidence, briefings, system state, TaskFlow tasks, or workspace data with [1] markers or include them in a '### Sources' section. '### Sources' is exclusively for external web URLs.
STRICT UI LAYOUT RULE: For daily briefings, agendas, schedules, or dashboard summaries, NEVER use markdown tables (they wrap awkwardly and look broken on mobile/sidebars). Instead, use clean markdown headers (e.g. ### 🌤️ Weather & Time, ### 📋 Active Agenda, ### 🎯 Today's Focus) and bullet points. Never output raw HTML tags like <br>.
Do not claim to have generated, edited, executed, searched or verified something unless the system actually supplied the result.
Prefer structured answers with short paragraphs, bullets, and code blocks when useful.'''
MODEL_FALLBACK=GROQ_MODEL
SUPPORTED_MODELS={GROQ_MODEL}
IMAGE_EXTENSIONS={'.png','.jpg','.jpeg','.webp'}
TEXT_EXTENSIONS={'.txt','.md','.csv','.tsv','.json','.py','.js','.ts','.jsx','.tsx','.html','.css','.java','.cpp','.c','.h','.hpp','.cs','.go','.rs','.php','.sql','.xml','.yaml','.yml','.sh','.bat','.ps1'}
DATA_EXTENSIONS={'.csv','.tsv','.xlsx','.xlsm','.xls'}
MAX_TEXT=180000
MAX_INLINE_FILE_BYTES=18*1024*1024


def now_ist(): return datetime.now(ZoneInfo('Asia/Kolkata')).isoformat()
def sha256(data): return hashlib.sha256(data).hexdigest()[:16]
def json_error(message,status=400,code='bad_request'): return jsonify({'ok':False,'error':message,'code':code}),status

def weather_code_summary(code):
    return {0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',80:'Rain showers',81:'Rain showers',82:'Heavy showers',95:'Thunderstorm',96:'Thunderstorm with hail',99:'Thunderstorm with hail'}.get(code,'Current conditions')

async def get_weather_coords(lat,lon,label='Your location',country='',http=None):
    own=http is None; h=http or httpx.AsyncClient(timeout=12)
    try:
        try:
            r=await h.get('https://api.open-meteo.com/v1/forecast',params={'latitude':lat,'longitude':lon,'current':'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m','timezone':'auto'})
            r.raise_for_status()
            d=r.json()
            c=d.get('current') or {}
            temp = c.get('temperature_2m')
            feels = c.get('apparent_temperature', temp)
            humidity = c.get('relative_humidity_2m', 60)
            wind = c.get('wind_speed_10m', 0)
            code = c.get('weather_code', 0)
            time_recorded = c.get('time')
        except Exception:
            r=await h.get('https://api.open-meteo.com/v1/forecast',params={'latitude':lat,'longitude':lon,'current_weather':'true'})
            r.raise_for_status()
            d=r.json()
            cw=d.get('current_weather') or {}
            temp = cw.get('temperature')
            feels = temp
            humidity = 60
            wind = cw.get('windspeed', 0)
            code = cw.get('weathercode', 0)
            time_recorded = cw.get('time')
        return {'ok':True,'city':label,'country':country,'timezone':d.get('timezone'),'latitude':lat,'longitude':lon,'temperature':temp,'feels_like':feels,'humidity':humidity,'wind':wind,'summary':weather_code_summary(code),'time':time_recorded}
    finally:
        if own: await h.aclose()

async def get_weather(city):
    clean = city.strip().lower()
    if clean in tools.US_STATES:
        st = tools.US_STATES[clean]
        return await get_weather_coords(st['lat'], st['lon'], st['city'], 'United States')
    async with httpx.AsyncClient(timeout=12) as h:
        candidates = [re.sub(r'[,.\s]+(america|usa|us|united states|india|uk)\b', '', city, flags=re.I).strip(), city]
        rs = []
        for c in candidates:
            if not c: continue
            g=await h.get('https://geocoding-api.open-meteo.com/v1/search',params={'name':c,'count':5,'language':'en','format':'json'})
            g.raise_for_status()
            rs=g.json().get('results') or []
            if rs: break
        if not rs: raise ValueError('Location not found')
        loc=rs[0]
        if any(term in city.lower() for term in ("america", "usa", "us")):
            us_matches = [r for r in rs if r.get("country") == "United States"]
            if us_matches: loc = us_matches[0]
        return await get_weather_coords(loc['latitude'],loc['longitude'],loc.get('name',city),loc.get('country',''),h)

def build_context(live):
    c=[f"Current server time in India (IST): {now_ist()}"]
    if isinstance(live,dict):
        if live.get('timezone'): c.append('Client timezone: '+str(live['timezone']))
        if live.get('weather'): c.append('Live weather: '+json.dumps(live['weather'],ensure_ascii=False))
        if live.get('workspace'): c.append('Active workspace: '+str(live['workspace']))
        if live.get('memory'): c.append('Explicit user memory notes: '+json.dumps(live['memory'],ensure_ascii=False)[:7000])
        if live.get('files'): c.append('Uploaded file text: '+str(live['files'])[:30000])
    return '\n'.join(c)

def build_text_messages(message,history,mode,live,tool_evidence=''):
    sys=BASE_PROMPT+'\nMode: '+MODE_PROMPTS.get(mode,MODE_PROMPTS['General'])
    if tool_evidence:
        sys+='\n\n=== VERIFIED GROUND TRUTH TOOL EVIDENCE (DO NOT CONTRADICT) ===\n'+tool_evidence
    sys+='\n\nLIVE CONTEXT:\n'+build_context(live)
    msgs=[{'role':'system','content':sys}]
    for x in (history or [])[-12:]:
        if x.get('role') in ('user','assistant') and x.get('content'): msgs.append({'role':x['role'],'content':str(x['content'])[:12000]})
    msgs.append({'role':'user','content':str(message)[:20000]})
    return msgs

def has_attachments(live):
    return bool((live or {}).get('images') or (live or {}).get('attachments'))

def data_url_bytes(data_url):
    if not isinstance(data_url,str) or not data_url.startswith('data:') or ';base64,' not in data_url: raise ValueError('Invalid attachment data')
    header,b64=data_url.split(';base64,',1);mime=header[5:] or 'application/octet-stream'
    return base64.b64decode(b64),mime

def _visual_items(live):
    attachments=(live or {}).get('attachments') or []
    images=(live or {}).get('images') or []
    items=[]; seen=set()
    for item in images+attachments:
        if not isinstance(item,dict):
            continue
        data_url=item.get('data_url')
        if not data_url or data_url in seen:
            continue
        seen.add(data_url)
        data,mime=data_url_bytes(data_url)
        if len(data)>MAX_INLINE_FILE_BYTES:
            continue
        items.append({'name':item.get('name') or 'attachment','data':data,'mime':mime,'b64':data_url.split(';base64,',1)[1]})
    return items

def visual_prompt(message,mode):
    return (BASE_PROMPT + '\nMode: ' + MODE_PROMPTS.get(mode,MODE_PROMPTS['General']) +
            '\n\nIMPORTANT VISUAL-INSTRUCTION:\n'
            'The user has attached one or more files and the attachment bytes are present in this request. '
            'You MUST inspect the actual visual content before answering. Do not ask the user to describe the image, '
            'do not say that you cannot see images, and do not give a generic request for a rundown. '
            'If it is a screenshot, read and explain the visible UI, text, code, error, diagram, or other content as appropriate. '
            'Use only details supported by the attachment. If some text is unreadable, say exactly what part is unclear. '
            'Answer the user directly based on what you can observe.\n\nUSER REQUEST:\n' + str(message)[:20000])

def gemini_contents(message,history,mode,live):
    if not gemini_client or not GEMINI_API_KEY:
        raise RuntimeError('GEMINI_API_KEY is not configured')
    visual_items=_visual_items(live)
    if not visual_items:
        if has_attachments(live):
            raise RuntimeError('The image could not be attached to the vision request. Please reattach it and try again.')
        context=build_context(live)
        prior=[]
        for x in (history or [])[-8:]:
            if x.get('role') in ('user','assistant') and x.get('content'):
                prior.append(f"{x['role'].upper()}: {str(x['content'])[:5000]}")
        prompt=(BASE_PROMPT+'\nMode: '+MODE_PROMPTS.get(mode,MODE_PROMPTS['General'])+'\n'+context+
                '\n\nRECENT CHAT:\n'+('\\n'.join(prior) if prior else '(none)')+
                '\n\nUSER REQUEST:\n'+str(message)[:20000])
        return [genai_types.Content(role='user',parts=[genai_types.Part.from_text(text=prompt)])]
    user_parts=[genai_types.Part.from_bytes(data=x['data'],mime_type=x['mime']) for x in visual_items]
    user_parts.append(genai_types.Part.from_text(text=visual_prompt(message,mode)))
    return [genai_types.Content(role='user',parts=user_parts)]

def gemini_interactions_input(message,mode,live):
    visual_items=_visual_items(live)
    if not visual_items:
        raise RuntimeError('No visual attachment was supplied.')
    inp=[{'type':'text','text':visual_prompt(message,mode)}]
    for x in visual_items:
        if not x['mime'].startswith('image/'):
            raise RuntimeError('This attachment type uses the standard Gemini vision route.')
        inp.append({'type':'image','data':x['b64'],'mime_type':x['mime']})
    return inp, len(visual_items)

def groq_complete(messages,stream=False,model=None,temperature=0.45):
    if not groq_clients: raise RuntimeError('GROQ_API_KEY is not configured. Add it to backend/.env and restart the server.')
    use_model = model or GROQ_MODEL
    last_err = None
    for client in groq_clients:
        try:
            return client.chat.completions.create(model=use_model,messages=messages,temperature=temperature,max_completion_tokens=2200,stream=stream)
        except Exception as e:
            last_err = e
            app.logger.warning('Groq key failed (%s); trying next key in pool if available', e)
    raise last_err or RuntimeError('All Groq keys failed')

def gemini_text_complete(prompt_text):
    """Fallback text completion via Gemini across all configured Gemini keys."""
    if not gemini_clients:
        raise RuntimeError('Gemini client not configured')
    last_err = None
    for g_client in gemini_clients:
        if hasattr(g_client, 'interactions'):
            try:
                inter = g_client.interactions.create(model=GEMINI_MODEL, input=prompt_text)
                txt = getattr(inter, 'output_text', None) or ''
                if txt.strip():
                    return txt.strip(), GEMINI_MODEL
            except Exception as e:
                last_err = e
                app.logger.warning('Gemini interaction text fallback failed: %s', e)
        for model in GEMINI_VISION_FALLBACKS:
            try:
                res = g_client.models.generate_content(model=model, contents=prompt_text)
                txt = getattr(res, 'text', None) or ''
                if txt.strip():
                    return txt.strip(), model
            except Exception as e:
                last_err = e
                app.logger.warning('Gemini generate_content text model %s failed: %s', model, e)
    raise last_err or RuntimeError('All Gemini text completion options failed')

def gemini_text_stream(prompt_text):
    """Fallback streaming via Gemini generate_content_stream across all configured Gemini keys."""
    if not gemini_clients:
        raise RuntimeError('Gemini client not configured')
    last_err = None
    for g_client in gemini_clients:
        for model in GEMINI_VISION_FALLBACKS:
            try:
                return g_client.models.generate_content_stream(model=model, contents=prompt_text), model
            except Exception as e:
                last_err = e
                app.logger.warning('Gemini streaming model %s failed: %s', model, e)
    raise last_err or RuntimeError('All Gemini streaming options failed')

def _gemini_error_code(exc):
    return getattr(exc,'code',None) or getattr(exc,'status_code',None) or getattr(getattr(exc,'response',None),'status_code',None)

def gemini_complete(message,history,mode,live):
    if not gemini_clients:
        raise RuntimeError('Vision is temporarily unavailable.')
    retryable={429,500,502,503,504}
    failures=[]
    has_visual=has_attachments(live)

    for g_client in gemini_clients:
        # For image requests use the current Gemini Interactions multimodal format first.
        # It sends the actual base64 image bytes as an image input, independently of chat history.
        if has_visual and hasattr(g_client,'interactions'):
            try:
                inp,count=gemini_interactions_input(message or 'Inspect the attached image and explain what is visible.',mode,live)
                for model in GEMINI_VISION_FALLBACKS:
                    try:
                        interaction=g_client.interactions.create(model=model,input=inp)
                        text=getattr(interaction,'output_text',None) or ''
                        if text.strip():
                            return text.strip(),model
                        failures.append(f'{model}:empty_interaction_response')
                    except Exception as e:
                        code=_gemini_error_code(e);failures.append(f'{model}:interaction:{code or type(e).__name__}')
                        app.logger.warning('Vision interaction model %s failed (%s); trying next model',model,code or type(e).__name__)
                        if code not in retryable:
                            break
                        time.sleep(0.35)
            except Exception as e:
                failures.append(f'interactions:{type(e).__name__}')
                app.logger.warning('Gemini interaction vision path unavailable: %s; using generateContent fallback',type(e).__name__)

        config=genai_types.GenerateContentConfig(max_output_tokens=2400,thinking_config=genai_types.ThinkingConfig(thinking_level='low'))
        contents=gemini_contents(message,history,mode,live)
        for model in GEMINI_VISION_FALLBACKS:
            try:
                response=g_client.models.generate_content(model=model,contents=contents,config=config)
                text=getattr(response,'text',None) or ''
                if text.strip(): return text.strip(),model
                failures.append(f'{model}:empty_response')
            except Exception as e:
                code=_gemini_error_code(e);failures.append(f'{model}:{code or type(e).__name__}')
                app.logger.warning('Vision model %s failed (%s); trying fallback if available',model,code or type(e).__name__)
                if code not in retryable: break
                time.sleep(0.35)
    app.logger.error('All vision paths failed: %s','; '.join(failures))
    raise RuntimeError('Image analysis is temporarily unavailable. Please try again in a moment.')

def extract_city(text):
    for p in [r'(?:weather|temperature|forecast)\s+(?:in|at|of)\s+([A-Za-z .\'-]+)',r'([A-Za-z .\'-]+)\s+(?:ka|ki|ke)\s+(?:weather|temperature|mausam)',r'(?:weather|temperature|mausam)\s+(?:of|in)?\s*([A-Za-z .\'-]+)']:
        m=re.search(p,text,re.I)
        if m:return m.group(1).strip(' .?!,')
    return None

@app.get('/')
def root(): return jsonify({'app':'Vaani','version':APP_VERSION,'status':'ok','groq_configured':bool(GROQ_KEYS),'groq_keys_count':len(GROQ_KEYS),'gemini_configured':bool(GEMINI_KEYS),'gemini_keys_count':len(GEMINI_KEYS)})
@app.get('/api/health')
def health(): return jsonify({'ok':True,'version':APP_VERSION,'groq_configured':bool(GROQ_KEYS),'groq_keys_count':len(GROQ_KEYS),'gemini_configured':bool(GEMINI_KEYS),'gemini_keys_count':len(GEMINI_KEYS),'vision_model':GEMINI_MODEL,'vision_models':GEMINI_VISION_FALLBACKS,'text_model':GROQ_MODEL,'time_ist':now_ist()})
@app.get('/api/time')
def api_time():
    city = request.args.get('city') or request.args.get('location') or 'India'
    t_data = tools.fetch_real_time(city)
    if t_data.get('ok'):
        t_data['formatted'] = f"{t_data['date']}, {t_data['time_12h']}"
        t_data['time'] = t_data['iso']
        t_data['city'] = t_data['location']
        return jsonify(t_data)
    d = datetime.now(ZoneInfo('Asia/Kolkata'))
    return jsonify({'ok': True, 'city': city, 'timezone': 'Asia/Kolkata', 'time': d.isoformat(), 'formatted': d.strftime('%d %b %Y, %I:%M:%S %p')})
@app.get('/api/weather')
def api_weather():
    import asyncio
    try:
        lat=request.args.get('lat');lon=request.args.get('lon')
        if lat is not None and lon is not None:
            a,b=float(lat),float(lon)
            if not(-90<=a<=90 and -180<=b<=180): raise ValueError('Invalid coordinates')
            return jsonify(asyncio.run(get_weather_coords(a,b)))
        city=request.args.get('city','New Delhi').strip() or 'New Delhi';return jsonify(asyncio.run(get_weather(city)))
    except Exception as e:return json_error(str(e),502,'weather_error')

def search_web(query, limit=10):
    """Fetch general web results with resilient DuckDuckGo HTML POST endpoints."""
    from bs4 import BeautifulSoup
    import urllib.parse
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-IN,en;q=0.9'
    }
    items = []
    seen = set()
    errors = []
    with httpx.Client(timeout=15, headers=headers, follow_redirects=True) as h:
        for url, is_post in [('https://html.duckduckgo.com/html/', True), ('https://lite.duckduckgo.com/lite/', True), ('https://html.duckduckgo.com/html/', False)]:
            try:
                if is_post:
                    r = h.post(url, data={'q': query})
                else:
                    r = h.get(url, params={'q': query})
                if r.status_code != 200:
                    continue
                soup = BeautifulSoup(r.text, 'html.parser')
                for res in soup.select('.result, .results_links_deep, tr'):
                    # Skip sponsored / ad results
                    if res.select_one('.result--ad, .badge--ad'):
                        continue
                    a = res.select_one('.result__a, a.result-link, a')
                    sn = res.select_one('.result__snippet, .result-snippet, td.result-snippet')
                    if not a:
                        continue
                    href = (a.get('href') or '').strip()
                    title = a.get_text(' ', strip=True)
                    text = sn.get_text(' ', strip=True) if sn else ''
                    
                    if 'uddg=' in href:
                        try:
                            parsed_qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
                            if 'uddg' in parsed_qs:
                                href = parsed_qs['uddg'][0]
                        except Exception:
                            pass

                    if href.startswith(('http://', 'https://')) and not href.startswith('https://duckduckgo.com/y.js') and href not in seen and title:
                        seen.add(href)
                        items.append({'title': title, 'text': text, 'url': href})
                    if len(items) >= limit:
                        return items[:limit], 'DuckDuckGo'
                if items:
                    return items[:limit], 'DuckDuckGo'
            except Exception as e:
                errors.append(f'{type(e).__name__}: {str(e)}')

        # Fallback to DuckDuckGo Instant Answer API
        try:
            api_r = h.get('https://api.duckduckgo.com/', params={'q': query, 'format': 'json'})
            if api_r.status_code == 200:
                data = api_r.json()
                if data.get('AbstractText') and data.get('AbstractURL'):
                    items.append({'title': data.get('Heading', query), 'text': data.get('AbstractText'), 'url': data.get('AbstractURL')})
                for topic in data.get('RelatedTopics', []):
                    if isinstance(topic, dict) and topic.get('Text') and topic.get('FirstURL'):
                        items.append({'title': topic.get('Text')[:60], 'text': topic.get('Text'), 'url': topic.get('FirstURL')})
                if items:
                    return items[:limit], 'DuckDuckGo API'
        except Exception:
            pass

    if items:
        return items[:limit], 'DuckDuckGo'
    raise RuntimeError('Web search provider returned no usable results. ' + '; '.join(errors))

@app.get('/api/search')
def api_search():
    q=request.args.get('q','').strip()
    if not q:return json_error('Missing query')
    try:
        items,source=search_web(q,10)
        return jsonify({'ok':True,'query':q,'results':items,'source':source})
    except Exception as e:return json_error(str(e),502,'search_error')

def validate_image_bytes(data,mime,ext):
    if ext not in IMAGE_EXTENSIONS and not mime.startswith('image/'): return False
    if data.startswith(b'\x89PNG\r\n\x1a\n'): return mime in ('image/png','application/octet-stream')
    if data.startswith(b'\xff\xd8\xff'): return mime in ('image/jpeg','image/jpg','application/octet-stream')
    if data[:12]==b'RIFF'+data[4:8]+b'WEBP': return mime in ('image/webp','application/octet-stream')
    return False

def extract_docx(data):
    from docx import Document
    doc=Document(io.BytesIO(data));parts=[p.text for p in doc.paragraphs if p.text.strip()]
    for ti,table in enumerate(doc.tables,1):
        rows=[]
        for row in table.rows: rows.append(' | '.join(cell.text.replace('\n',' ') for cell in row.cells))
        if rows:parts.append(f'Table {ti}:\n'+'\n'.join(rows))
    return '\n\n'.join(parts)

@app.post('/api/files/analyze')
def analyze_file():
    f=request.files.get('file')
    if not f:return json_error('No file provided')
    data=f.read();name=Path(f.filename or 'file').name;ext=Path(name).suffix.lower();mime=f.mimetype or mimetypes.guess_type(name)[0] or 'application/octet-stream'
    if len(data)>20*1024*1024:return json_error('File exceeds the 20 MB upload limit',413,'file_too_large')
    try:
        if ext in IMAGE_EXTENSIONS or mime.startswith('image/'):
            if ext not in IMAGE_EXTENSIONS or not validate_image_bytes(data,mime,ext):return json_error('Supported images are valid PNG, JPG/JPEG or WebP files.',400,'invalid_image')
            b64=base64.b64encode(data).decode('ascii');return jsonify({'ok':True,'name':name,'type':ext[1:],'mime':mime if mime.startswith('image/') else ('image/jpeg' if ext in {'.jpg','.jpeg'} else 'image/'+ext[1:]),'kind':'image','text':'Image uploaded. Ask Vaani to describe, inspect or reason about what is visible.','data_url':f"data:{mime if mime.startswith('image/') else 'image/jpeg'};base64,{b64}",'characters':0,'size':len(data),'sha256':sha256(data)})
        if ext in {'.xlsx', '.xlsm', '.xls', '.csv', '.tsv'}:
            import pandas as pd
            frames = load_frames(data, ext)
            profile = compute_profile(frames)
            parts = [
                f"=== DATASET PROFILE & STATISTICAL OVERVIEW ({name}) ===",
                f"• Total Rows: {profile['total_rows']}",
                f"• Sheets / Tables: {', '.join(frames.keys())}"
            ]
            for sname, sheet_data in profile['sheets'].items():
                parts.append(f"\n[Sheet: {sname}]")
                parts.append(f"• Dimensions: {sheet_data['rows']} rows × {sheet_data['columns']} columns")
                parts.append(f"• Columns: {', '.join(sheet_data['column_names'])}")
                if sheet_data['duplicates'] > 0:
                    parts.append(f"• ⚠️ Duplicate Rows Detected: {sheet_data['duplicates']}")
                missing = [f"{col}: {cnt} nulls" for col, cnt in sheet_data['missing'].items() if cnt > 0]
                if missing:
                    parts.append(f"• ⚠️ Missing / Null Values: {', '.join(missing[:8])}")
                if sheet_data['numeric_summary']:
                    parts.append("• Summary Statistics (Numerical Columns):")
                    for col, stats in list(sheet_data['numeric_summary'].items())[:6]:
                        parts.append(f"  - {col}: Mean={stats.get('mean')}, Min={stats.get('min')}, Max={stats.get('max')}")
                df_curr = frames[sname]
                parts.append(f"• Data Sample (Preview Rows):\n{df_curr.head(35).to_csv(index=False)}")
            text = "\n".join(parts)
        elif ext == '.pdf':
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            pages = []
            for i, p in enumerate(reader.pages, 1):
                p_text = p.extract_text() or ''
                if p_text.strip():
                    pages.append(f"--- Page {i} ---\n{p_text}")
            text = "\n".join(pages)
            if not text.strip():
                text = '[PDF contains no extractable text. Scanned or image-only format.]'
        elif ext == '.docx':
            text = extract_docx(data)
        elif ext in TEXT_EXTENSIONS:
            text = data.decode('utf-8', 'ignore')
        else:
            return json_error(f'Unsupported file type: {ext or mime}', 400, 'unsupported_file')
        text = text[:MAX_TEXT]
        try:
            brain_db.index_document(name, data, ext[1:] if ext else 'doc', text)
        except Exception:
            pass
        payload={'ok':True,'name':name,'type':ext[1:] if ext else mime,'mime':mime,'kind':'document','text':text,'characters':len(text),'size':len(data),'sha256':sha256(data),'note':'Gemini will use the native PDF when the file is small enough for inline transfer.' if ext=='.pdf' and len(data)<=MAX_INLINE_FILE_BYTES else ''}
        if ext=='.pdf' and len(data)<=MAX_INLINE_FILE_BYTES: payload['data_url']='data:application/pdf;base64,'+base64.b64encode(data).decode('ascii')
        return jsonify(payload)
    except Exception as e:return json_error(str(e),422,'file_parse_error')


def load_frames(data,ext):
    import pandas as pd
    if ext=='.csv':return {'CSV':pd.read_csv(io.BytesIO(data))}
    if ext=='.tsv':return {'TSV':pd.read_csv(io.BytesIO(data),sep='\t')}
    if ext in {'.xlsx','.xlsm','.xls'}:
        book=pd.ExcelFile(io.BytesIO(data));return {s:book.parse(s) for s in book.sheet_names}
    raise ValueError('Data Analysis supports CSV, TSV, XLSX, XLSM and XLS.')

def compute_profile(frames):
    import pandas as pd
    sheets={};total=0
    for sheet,df in frames.items():
        total+=len(df);num=df.select_dtypes(include='number');numeric={}
        if not num.empty:
            for col,row in num.describe().to_dict().items():numeric[str(col)]={k:(None if pd.isna(v) else float(v)) for k,v in row.items() if k in {'count','mean','std','min','25%','50%','75%','max'}}
        cats={}
        for col in df.select_dtypes(exclude='number').columns[:20]:
            vc=df[col].astype(str).replace('nan','').value_counts().head(5);cats[str(col)]={str(k):int(v) for k,v in vc.items()}
        sheets[sheet]={'rows':len(df),'columns':len(df.columns),'column_names':[str(c) for c in df.columns],'dtypes':{str(c):str(t) for c,t in df.dtypes.items()},'missing':{str(k):int(v) for k,v in df.isna().sum().items()},'duplicates':int(df.duplicated().sum()),'numeric_summary':numeric,'top_values':cats,'sample':df.head(12).fillna('').astype(str).to_dict(orient='records')}
    return {'total_rows':total,'sheets':sheets}

def compute_question(frames,q):
    import pandas as pd
    ql=q.lower();answers=[]
    for sheet,df in frames.items():
        cols={str(c).lower():c for c in df.columns}
        if 'duplicate' in ql: answers.append(f'{sheet}: {int(df.duplicated().sum())} duplicate rows.')
        if 'missing' in ql:
            miss=df.isna().sum().sort_values(ascending=False);top=miss[miss>0].head(5)
            answers.append(f"{sheet} missing: "+(', '.join(f'{c}={int(v)}' for c,v in top.items()) if len(top) else 'no missing values.'))
        for op,word in [('sum','sum'),('mean','average'),('mean','mean'),('max','maximum'),('min','minimum')]:
            if word in ql:
                candidates=[orig for low,orig in cols.items() if low in ql and pd.api.types.is_numeric_dtype(df[orig])]
                for col in candidates[:3]:
                    val=getattr(df[col],op)();answers.append(f'{sheet}: {op} of {col} = {float(val):.4f}.')
        if 'count' in ql and not any(x in ql for x in ['discount','account']): answers.append(f'{sheet}: {len(df)} rows.')
    return answers[:12]

@app.post('/api/data/analyze')
def data_analyze():
    f=request.files.get('file')
    if not f:return json_error('No CSV/Excel file provided')
    data=f.read();name=Path(f.filename or 'data').name;ext=Path(name).suffix.lower();question=request.form.get('question','').strip()
    if len(data)>20*1024*1024:return json_error('File exceeds the 20 MB upload limit',413,'file_too_large')
    try:
        frames=load_frames(data,ext);profile=compute_profile(frames);computed=compute_question(frames,question);answer=f'{name} contains {len(frames)} sheet(s) and {profile["total_rows"]} total rows.'
        if computed:answer+='\n\nComputed results:\n- '+'\n- '.join(computed)
        if question and GROQ_API_KEY:
            prompt=f'Use only the computed dataset facts below. Do not invent values. If the facts do not answer the question, say so.\nQUESTION: {question}\nCOMPUTED RESULTS: {json.dumps(computed,ensure_ascii=False)}\nPROFILE: {json.dumps(profile,ensure_ascii=False)[:50000]}'
            r=groq_complete([{'role':'system','content':'You are Vaani Data Analysis. Explain only grounded computed facts.'},{'role':'user','content':prompt}],False);answer=(r.choices[0].message.content or answer).strip()
        return jsonify({'ok':True,'name':name,'rows':profile['total_rows'],'sheets':len(frames),'columns':sum(len(x.columns) for x in frames.values()),'profile':profile,'computed':computed,'answer':answer})
    except Exception as e:return json_error(str(e),422,'data_analysis_error')

@app.get('/api/research')
def api_research():
    q=request.args.get('q','').strip()
    if not q:return json_error('Missing query')
    try:
        results=[]; seen=set()
        for qq in (q,f'{q} official source',f'{q} documentation'):
            try: found,_=search_web(qq,7)
            except Exception: continue
            for item in found:
                if item['url'] not in seen:
                    seen.add(item['url']); results.append(item)
        if not results:return json_error('Research search returned no usable sources.',502,'research_no_results')
        summary=''
        if GROQ_API_KEY:
            src='\n'.join(f"{x['title']}\n{x['text']}\n{x['url']}" for x in results[:15])
            r=groq_complete([{'role':'system','content':'Summarize only claims supported by the supplied search snippets. Distinguish uncertainty. Keep source URLs visible and do not invent facts.'},{'role':'user','content':f'Question: {q}\nSources:\n{src}'}],False)
            summary=(r.choices[0].message.content or '').strip()
        return jsonify({'ok':True,'query':q,'results':results[:15],'summary':summary,'source':'DuckDuckGo'})
    except Exception as e:return json_error(str(e),502,'research_error')


@app.post('/api/generate/image')
def generate_image():
    if not gemini_clients:return json_error('GEMINI_API_KEY is not configured',503,'missing_gemini_key')
    data=request.get_json(silent=True) or {};prompt=str(data.get('prompt','')).strip();images=data.get('images') or []
    if not prompt:return json_error('Missing image prompt')
    try:
        contents=[prompt]
        for item in images[:3]:
            if item.get('data_url'):
                raw,mime=data_url_bytes(item['data_url']);contents.append(genai_types.Part.from_bytes(data=raw,mime_type=mime))
        for g_client in gemini_clients:
            try:
                response=g_client.models.generate_content(model=GEMINI_IMAGE_MODEL,contents=contents,config=genai_types.GenerateContentConfig(response_modalities=['IMAGE','TEXT']))
                for part in response.parts or []:
                    inline=getattr(part,'inline_data',None)
                    if inline and getattr(inline,'data',None):
                        mime=getattr(inline,'mime_type',None) or 'image/png';return jsonify({'ok':True,'data_url':f'data:{mime};base64,{base64.b64encode(inline.data).decode("ascii")}','kind':'image','model':GEMINI_IMAGE_MODEL})
            except Exception as ge:
                app.logger.warning('Gemini image key failed (%s); trying next key if available', ge)
        return json_error('Gemini image model returned no image.',502,'empty_image_result')
    except Exception as e:
        app.logger.exception('image_generation_error')
        return json_error('Image creation is temporarily unavailable. Please try again in a moment.',503,'image_generation_error')

@app.post('/api/generate/edit')
def generate_edit():
    if not gemini_clients:return json_error('GEMINI_API_KEY is not configured',503,'missing_gemini_key')
    data=request.get_json(silent=True) or {};prompt=str(data.get('prompt','')).strip();images=data.get('images') or []
    if not prompt:return json_error('Missing edit prompt')
    if not images or not images[0].get('data_url'):return json_error('Upload an image before editing')
    try:
        raw,mime=data_url_bytes(images[0]['data_url'])
        contents=[prompt,genai_types.Part.from_bytes(data=raw,mime_type=mime)]
        for g_client in gemini_clients:
            try:
                response=g_client.models.generate_content(model=GEMINI_IMAGE_MODEL,contents=contents,config=genai_types.GenerateContentConfig(response_modalities=['IMAGE','TEXT']))
                for part in response.parts or []:
                    inline=getattr(part,'inline_data',None)
                    if inline and getattr(inline,'data',None):
                        outmime=getattr(inline,'mime_type',None) or 'image/png';return jsonify({'ok':True,'data_url':f'data:{outmime};base64,{base64.b64encode(inline.data).decode("ascii")}','kind':'image','model':GEMINI_IMAGE_MODEL})
            except Exception as ge:
                app.logger.warning('Gemini edit key failed (%s); trying next key if available', ge)
        return json_error('Gemini image model returned no edited image.',502,'empty_edit_result')
    except Exception as e:
        app.logger.exception('image_edit_error')
        return json_error('Image editing is temporarily unavailable. Please try again in a moment.',503,'image_edit_error')

@app.post('/api/generate/video')
def generate_video():
    if not gemini_clients:return json_error('GEMINI_API_KEY is not configured',503,'missing_gemini_key')
    data=request.get_json(silent=True) or {};prompt=str(data.get('prompt','')).strip()
    if not prompt:return json_error('Missing video prompt')
    try:
        import time
        for g_client in gemini_clients:
            try:
                operation=g_client.models.generate_videos(model=GEMINI_VIDEO_MODEL,prompt=prompt)
                while not operation.done:
                    time.sleep(8);operation=g_client.operations.get(operation)
                video=operation.response.generated_videos[0]
                uri = getattr(getattr(video,'video',None),'uri',None)
                return jsonify({
                    'ok':True,
                    'video_file': uri,
                    'video_url': uri,
                    'kind':'video',
                    'model':GEMINI_VIDEO_MODEL,
                    'note':'Video generation completed. Use the returned Gemini file URI with the Gemini Files API.'
                })
            except Exception as ge:
                app.logger.warning('Gemini video key failed (%s); trying next key if available', ge)
        return json_error('Video creation is temporarily unavailable. Please try again in a moment.',503,'video_generation_error')
    except Exception as e:
        app.logger.exception('video_generation_error')
        return json_error('Video creation is temporarily unavailable. Please try again in a moment.',503,'video_generation_error')

def check_auto_memory(text):
    """Detects explicit user preference/memory statements and stores them permanently."""
    if not text: return
    pats = [
        r'^(?:remember\s+(?:that|this)?\s*[:,-]?\s*)(.+)',
        r'^(?:my\s+name\s+is\s+)(.+)',
        r'^(?:i\s+prefer\s+)(.+)',
        r'^(?:i\s+live\s+in\s+)(.+)'
    ]
    for p in pats:
        m = re.search(p, text.strip(), re.IGNORECASE)
        if m:
            fact = m.group(1).strip()
            if len(fact) > 3:
                try:
                    brain_db.save_memory(fact, category="preference", source="user_explicit")
                except Exception:
                    pass

@app.post('/api/chat')
def chat():
    data=request.get_json(silent=True) or {};message=str(data.get('message','')).strip()
    if not message and not has_attachments(data.get('live_context') or {}):return json_error('Message or attachment is required')
    live=data.get('live_context') or {};history=data.get('history') or [];mode=data.get('mode','General')
    selected_model=data.get('model','Saturn')
    chat_id=str(data.get('chat_id') or int(time.time()))
    
    # 1. Execute deterministic tools (Weather, Math, Search, Document RAG, Memory)
    tool_data = tools.route_and_execute_tools(message, live, history=history, mode=mode)
    tool_evidence = tool_data.get("evidence_block", "")
    
    try:
        # Save user message to persistent DB
        if message:
            brain_db.save_chat_message(chat_id, 'user', message)
            check_auto_memory(message)
            
        if has_attachments(live):
            image_count=len(live.get('images') or [])
            attachment_count=len(live.get('attachments') or [])
            app.logger.info('Vision request: images=%s attachments=%s',image_count,attachment_count)
            text,vision_model=gemini_complete(message or 'Inspect the attached file/image and explain what is important.',history,mode,live)
            brain_db.save_chat_message(chat_id, 'assistant', text)
            return jsonify({'ok':True,'text':text,'model_used':vision_model,'vision_routed':True,'vision_image_count':len(live.get('images') or []),'vision_attachment_count':len(live.get('attachments') or [])})
        
        # Multi-Tier Resilient Text Completion
        text_messages = build_text_messages(message, history, mode, live, tool_evidence)
        temp = 0.2 if mode == 'Coding Assistant' or selected_model == 'Uranus' else (0.3 if selected_model == 'Neptune' else 0.45)
        
        full_text = None
        provider_used = 'groq'
        model_used = GROQ_MODEL

        # Tier 1: Groq Fast Models
        if selected_model != 'Mars' and GROQ_API_KEY:
            for g_model in GROQ_FALLBACK_MODELS:
                try:
                    r = groq_complete(text_messages, False, model=g_model, temperature=temp)
                    ans = (r.choices[0].message.content or '').strip()
                    if ans:
                        full_text = ans
                        model_used = g_model
                        provider_used = 'groq'
                        break
                except Exception as ge:
                    app.logger.warning('Groq model %s failed: %s; attempting fallback', g_model, ge)

        # Tier 2: Gemini Direct Intelligence
        if not full_text and gemini_client:
            try:
                g_prompt = BASE_PROMPT + '\nMode: ' + MODE_PROMPTS.get(mode, MODE_PROMPTS['General'])
                if tool_evidence: g_prompt += '\n\n' + tool_evidence
                g_prompt += '\n\nLIVE CONTEXT:\n' + build_context(live)
                g_prompt += '\n\nUSER REQUEST: ' + message
                ans, gem_model = gemini_text_complete(g_prompt)
                if ans:
                    full_text = ans
                    model_used = gem_model
                    provider_used = 'gemini'
            except Exception as gme:
                app.logger.warning('Gemini text fallback failed: %s', gme)

        # Tier 3: Groq Emergency Fallback
        if not full_text and GROQ_API_KEY:
            try:
                r = groq_complete(text_messages, False, model='qwen/qwen3.8-27b', temperature=temp)
                full_text = (r.choices[0].message.content or '').strip()
                provider_used = 'groq'
                model_used = 'qwen/qwen3.8-27b'
            except Exception:
                pass

        if not full_text:
            raise RuntimeError('All intelligence providers are currently busy. Please retry in a moment.')
            
        brain_db.save_chat_message(chat_id, 'assistant', full_text)
        return jsonify({'ok':True,'text':full_text,'provider':provider_used,'model_used':model_used,'vision_routed':False,'tools_used':tool_data.get('executed_tools',[])})
    except Exception as e:
        app.logger.exception('Chat request failed')
        msg=str(e)
        safe=msg if msg.startswith(('Image analysis is','GROQ_API_KEY is')) else 'Vaani could not complete that request right now. Please try again.'
        return json_error(safe,503 if 'Image analysis is' in safe else 502,'chat_error')

@app.post('/api/chat/stream')
def chat_stream():
    data=request.get_json(silent=True) or {};message=str(data.get('message','')).strip();live=data.get('live_context') or {};history=data.get('history') or [];mode=data.get('mode','General')
    selected_model=data.get('model','Saturn')
    chat_id=str(data.get('chat_id') or int(time.time()))
    if has_attachments(live):return jsonify({'ok':False,'error':'Multimodal requests use the non-streaming Gemini route.','code':'multimodal_use_chat'}),409
    if not message:return json_error('Message is required')
    
    # Save user message to persistent DB
    brain_db.save_chat_message(chat_id, 'user', message)
    check_auto_memory(message)
    
    # Run deterministic intent tools
    tool_data = tools.route_and_execute_tools(message, live, history=history, mode=mode)
    tool_evidence = tool_data.get("evidence_block", "")
    
    def generate():
        collected = []
        streamed_any = False
        provider_used = 'groq'
        model_used = GROQ_MODEL
        temp = 0.2 if mode == 'Coding Assistant' or selected_model == 'Uranus' else (0.3 if selected_model == 'Neptune' else 0.45)
        text_messages = build_text_messages(message,history,mode,live,tool_evidence)

        # Tier 1: Try Primary Groq Streaming
        if selected_model != 'Mars' and GROQ_API_KEY:
            for g_model in GROQ_FALLBACK_MODELS:
                try:
                    stream = groq_complete(text_messages, True, model=g_model, temperature=temp)
                    for chunk in stream:
                        delta = chunk.choices[0].delta.content if chunk.choices else None
                        if delta:
                            collected.append(delta)
                            streamed_any = True
                            yield 'data: '+json.dumps({'text':delta})+'\n\n'
                    if streamed_any:
                        model_used = g_model
                        provider_used = 'groq'
                        break
                except Exception as ge:
                    app.logger.warning('Groq stream model %s failed: %s', g_model, ge)
                    if streamed_any:
                        break

        # Tier 2: Try Gemini Streaming if Groq has not yielded text
        if not streamed_any and gemini_client:
            try:
                g_prompt = BASE_PROMPT + '\nMode: ' + MODE_PROMPTS.get(mode, MODE_PROMPTS['General'])
                if tool_evidence: g_prompt += '\n\n' + tool_evidence
                g_prompt += '\n\nLIVE CONTEXT:\n' + build_context(live)
                g_prompt += '\n\nUSER REQUEST: ' + message
                gem_stream, gem_model = gemini_text_stream(g_prompt)
                for chunk in gem_stream:
                    delta = getattr(chunk, 'text', '') or ''
                    if delta:
                        collected.append(delta)
                        streamed_any = True
                        yield 'data: '+json.dumps({'text':delta})+'\n\n'
                if streamed_any:
                    model_used = gem_model
                    provider_used = 'gemini'
            except Exception as gme:
                app.logger.warning('Gemini streaming fallback failed: %s', gme)

        # Tier 3: Non-streaming fallback if neither streamed
        if not streamed_any:
            try:
                g_prompt = BASE_PROMPT + '\nMode: ' + MODE_PROMPTS.get(mode, MODE_PROMPTS['General'])
                if tool_evidence: g_prompt += '\n\n' + tool_evidence
                g_prompt += '\n\nUSER REQUEST: ' + message
                ans, gem_model = gemini_text_complete(g_prompt)
                if ans:
                    collected.append(ans)
                    streamed_any = True
                    yield 'data: '+json.dumps({'text':ans})+'\n\n'
                    model_used = gem_model
                    provider_used = 'gemini'
            except Exception:
                pass

        full_reply = "".join(collected)
        if full_reply:
            brain_db.save_chat_message(chat_id, 'assistant', full_reply)
            
        yield 'data: '+json.dumps({'meta':{'model_used':model_used,'provider':provider_used,'vision_routed':False,'tools_used':tool_data.get('executed_tools',[])}})+'\n\n'
        yield 'data: [DONE]\n\n'

    return Response(stream_with_context(generate()),mimetype='text/event-stream',headers={'Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','Connection':'keep-alive'})

# ----------------- Brain DB API Routes -----------------

@app.route('/api/brain/memory', methods=['GET', 'POST', 'DELETE'])
def api_brain_memory():
    if request.method == 'GET':
        q = request.args.get('q', '').strip()
        mems = brain_db.search_memories(q) if q else brain_db.list_memories()
        return jsonify({'ok': True, 'memories': mems})
    elif request.method == 'POST':
        d = request.get_json(silent=True) or {}
        content = str(d.get('content', '')).strip()
        if not content: return json_error('Memory content is required')
        cat = d.get('category', 'general')
        m = brain_db.save_memory(content, cat, source="user_explicit")
        return jsonify({'ok': True, 'id': m.get('id'), 'memory': m})
    elif request.method == 'DELETE':
        mid = request.args.get('id') or (request.get_json(silent=True) or {}).get('id')
        if not mid: return json_error('Memory ID required')
        deleted = brain_db.delete_memory(int(mid))
        return jsonify({'ok': deleted})

@app.route('/api/brain/history', methods=['GET'])
def api_brain_history():
    q = request.args.get('q', '').strip()
    if q:
        results = brain_db.search_history(q)
        return jsonify({'ok': True, 'results': results})
    convs = brain_db.list_conversations()
    return jsonify({'ok': True, 'conversations': convs})

@app.route('/api/brain/history/<cid>', methods=['GET'])
def api_brain_history_detail(cid):
    msgs = brain_db.get_conversation_messages(cid)
    return jsonify({'ok': True, 'conversation_id': cid, 'messages': msgs})

@app.route('/api/brain/library', methods=['GET', 'POST', 'DELETE'])
def api_brain_library():
    if request.method == 'GET':
        docs = brain_db.list_library_documents()
        return jsonify({'ok': True, 'documents': docs})
    elif request.method == 'POST':
        f = request.files.get('file')
        if not f: return json_error('No file provided')
        data = f.read()
        name = Path(f.filename or 'document').name
        ext = Path(name).suffix.lower()
        if ext in TEXT_EXTENSIONS: text = data.decode('utf-8', 'ignore')
        elif ext == '.pdf':
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            text = '\n'.join([p.extract_text() or '' for p in reader.pages])
        elif ext == '.docx': text = extract_docx(data)
        elif ext in {'.xlsx', '.xlsm', '.xls'}:
            import pandas as pd
            book = pd.ExcelFile(io.BytesIO(data))
            text = '\n\n'.join([f"Sheet: {s}\n{book.parse(s).head(50).to_csv()}" for s in book.sheet_names])
        else: text = data.decode('utf-8', 'ignore')
        doc = brain_db.index_document(name, data, ext[1:] if ext else 'txt', text)
        return jsonify({'ok': True, 'document': doc})
    elif request.method == 'DELETE':
        doc_id = request.args.get('id') or (request.get_json(silent=True) or {}).get('id')
        if not doc_id: return json_error('Document ID required')
        deleted = brain_db.delete_library_document(doc_id)
        return jsonify({'ok': deleted})

@app.route('/api/brain/library/search', methods=['GET'])
def api_brain_library_search():
    q = request.args.get('q', '').strip()
    if not q: return json_error('Query required')
    results = brain_db.search_library(q)
    return jsonify({'ok': True, 'query': q, 'results': results})

@app.get('/api/models')
def models():
    return jsonify({
        'ok':True,
        'selected_supported':[GROQ_MODEL, GEMINI_MODEL],
        'models':[
            {'id':'Saturn', 'name':'Saturn', 'provider':'groq', 'tag':'GPT-OSS 20B Fast Assistant', 'modalities':['text']},
            {'id':'Uranus', 'name':'Uranus', 'provider':'groq', 'tag':'Code & Architecture Specialist', 'modalities':['text', 'code']},
            {'id':'Neptune', 'name':'Neptune', 'provider':'groq', 'tag':'Deep Analysis & Reasoning', 'modalities':['text', 'research']},
            {'id':'Mars', 'name':'Mars', 'provider':'gemini', 'tag':'Multimodal & Vision Intelligence', 'modalities':['text', 'image', 'video']}
        ],
        'vision':{'available':bool(gemini_client),'model':GEMINI_MODEL,'fallback_count':len(GEMINI_VISION_FALLBACKS)}
    })

@app.errorhandler(413)
def too_large(_):return json_error('Request/file exceeds the 20 MB limit.',413,'file_too_large')
@app.errorhandler(500)
def internal(_):return json_error('Unexpected backend error.',500,'internal_error')

if __name__=='__main__':
    print('Vaani backend '+APP_VERSION+':',BASE_DIR);print('Groq configured:',bool(GROQ_API_KEY),'Gemini configured:',bool(GEMINI_API_KEY));app.run(host='127.0.0.1',port=int(os.getenv('PORT','5288')),debug=True)

