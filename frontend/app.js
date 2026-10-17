const IS_LOCAL=["127.0.0.1","localhost","0.0.0.0"].includes(location.hostname)||location.hostname.startsWith("192.168.")||location.hostname.startsWith("10.")||location.protocol==="file:";
const API_BASE=IS_LOCAL?"http://127.0.0.1:5288":"https://vaani-ai-workspace.vercel.app";
async function apiFetch(path,options={}){
  // Never hide a local backend/provider error by silently switching to the
  // deployed backend. During local development the local API is the source
  // of truth; production uses only the deployed API.
  const r=await fetch(API_BASE+path,options);
  return r;
}

async function chatRequest(body,signal){
  const multimodal=Boolean(body?.live_context?.images?.length||body?.live_context?.attachments?.length);
  const options={method:"POST",headers:{"Content-Type":"application/json"},signal,body:JSON.stringify(body)};
  // Text stays streaming on Groq. Any attachment always goes directly to Gemini's
  // non-streaming multimodal route; this prevents SSE fallbacks from eating the image.
  return apiFetch(multimodal?"/api/chat":"/api/chat/stream",options);
}
const state={model:"Saturn",mode:"General",history:[],controller:null,files:[],images:[],chatId:null,focus:false,workspace:"Personal",memory:JSON.parse(localStorage.getItem("vaani_memory")||"[]"),workspaces:JSON.parse(localStorage.getItem("vaani_workspaces")||'["Personal","Projects","Job Search"]'),voice:{recognition:null,listening:false,manualStop:false,targetId:"promptInput",baseText:""},models:{
 Saturn:{tag:"GPT-OSS 20B",id:"openai/gpt-oss-20b",cls:"model-saturn",accent:"#e7a64f"},
 Uranus:{tag:"GPT-OSS 20B",id:"openai/gpt-oss-20b",cls:"model-uranus",accent:"#71d7e8"},
 Neptune:{tag:"GPT-OSS 20B",id:"openai/gpt-oss-20b",cls:"model-neptune",accent:"#c18cff"},
 Mars:{tag:"GPT-OSS 20B",id:"openai/gpt-oss-20b",cls:"model-mars",accent:"#e6a0a8"}
}};
const $=id=>document.getElementById(id), scene=$("scene"),hero=$("hero"),chatShell=$("chatShell"),messages=$("messages"),chatScroll=$("chatScroll"),drawer=$("drawer"),backdrop=$("backdrop"),toastEl=$("toast");
function toast(m,type=""){toastEl.textContent=(type==="warning"?"⚠ ":"")+m;toastEl.classList.toggle("warning",type==="warning");toastEl.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>toastEl.classList.remove("show"),type==="warning"?4500:2300)}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function inlineMd(t){
  let s=esc(t);
  s=s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img class="md-image" src="$2" alt="$1">');
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg><span>$1</span></a>');
  // Auto-link plain URLs that are not already inside href
  s=s.replace(/(^|[^"'>])(https?:\/\/[^\s<)"]+)/g,'$1<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$2</a>');
  // Numbered citation pills like [1], [2], [3]
  s=s.replace(/\[(\d{1,2})\]/g,'<span class="citation-pill">[$1]</span>');
  s=s.replace(/`([^`]+)`/g,'<code>$1</code>');
  s=s.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/__(.*?)__/g,'<strong>$1</strong>');
  s=s.replace(/\*(.*?)\*/g,'<em>$1</em>').replace(/_(.*?)_/g,'<em>$1</em>');
  return s;
}
function normalizeMarkdown(raw){
  return String(raw??'').replace(/\r\n/g,'\n').replace(/^\\(#{1,6}\s)/gm,'$1').replace(/^\\(---+\s*)$/gm,'$1').replace(/^\\(\*\*\*+\s*)$/gm,'$1').replace(/^\\(\-\-\-+\s*)$/gm,'$1');
}
function renderMCQBlock(raw){
  let question = "";
  let options = [];
  let explanation = "";

  try {
    const trimmed = raw.trim();
    if(trimmed.startsWith("{") && trimmed.endsWith("}")){
      const obj = JSON.parse(trimmed);
      if(obj.question && Array.isArray(obj.options)){
        question = obj.question;
        explanation = obj.explanation || "";
        const ans = String(obj.answer || "").trim().toUpperCase();
        options = obj.options.map((opt, idx) => {
          let label = String(opt);
          const isCorrect = (ans === String(idx)) || (ans === String.fromCharCode(65 + idx)) || label.startsWith("*");
          label = label.replace(/^\*\s*/, "");
          return { label, isCorrect };
        });
      }
    }
  } catch(_) {}

  if(!question) {
    const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
    let parsingOptions = false;
    for(const l of lines){
      if(/^Q(uestion)?[:\s]/i.test(l)){
        question = l.replace(/^Q(uestion)?[:\s]+/i, "").trim();
      } else if(/^\*?[A-Da-d][\).:]\s+/.test(l) || /^\*\s+[A-Da-d][\).:]\s+/.test(l)){
        parsingOptions = true;
        const isCorrect = l.startsWith("*") || /\(correct\)|\[correct\]/i.test(l);
        let clean = l.replace(/^\*\s*/, "").replace(/\s*[\(\[]correct[\)\]]/i, "").trim();
        options.push({ label: clean, isCorrect });
      } else if(/^Exp(lanation)?[:\s]/i.test(l)){
        parsingOptions = false;
        explanation = l.replace(/^Exp(lanation)?[:\s]+/i, "").trim();
      } else if(!parsingOptions && !question){
        question = l;
      } else if(parsingOptions && /^[A-Da-d]\s+/.test(l)){
        options.push({ label: l, isCorrect: false });
      } else if(explanation){
        explanation += " " + l;
      }
    }
  }

  if(!question || options.length < 2){
    return `<pre data-lang="mcq"><code class="language-mcq">${esc(raw)}</code></pre>`;
  }

  const mcqId = "mcq_" + Math.random().toString(36).slice(2, 9);
  const optionsHtml = options.map((opt, i) => {
    const letter = String.fromCharCode(65 + i);
    const textOnly = opt.label.replace(/^[A-Da-d][\).:]\s*/, "");
    return `<div class="mcq-opt" data-index="${i}" data-correct="${opt.isCorrect ? '1' : '0'}">
      <span class="mcq-opt-marker">${letter}</span>
      <span>${esc(textOnly)}</span>
    </div>`;
  }).join("");

  return `<div class="mcq-container" id="${mcqId}">
    <div class="mcq-card">
      <div class="mcq-header">
        <span class="mcq-title">🧠 Interactive Knowledge Check</span>
        <span class="mcq-score">MCQ</span>
      </div>
      <div class="mcq-question">${esc(question)}</div>
      <div class="mcq-options">${optionsHtml}</div>
      <div class="mcq-actions">
        <button type="button" class="mcq-btn submit-btn" onclick="submitMCQ('${mcqId}')">Submit Answer</button>
        <button type="button" class="mcq-btn" onclick="resetMCQ('${mcqId}')">Reset</button>
      </div>
      <div class="mcq-explanation" id="${mcqId}_exp">${esc(explanation || "Review the option logic above.")}</div>
    </div>
  </div>`;
}

function renderChecklistBlock(items){
  const clId = "chk_" + Math.random().toString(36).slice(2, 9);
  const total = items.length;
  const checkedCount = items.filter(x => x.checked).length;
  const rows = items.map((it, idx) => `
    <label class="checklist-item ${it.checked ? 'checked' : ''}" data-idx="${idx}">
      <input type="checkbox" ${it.checked ? 'checked' : ''} onchange="toggleChecklistItem(this)">
      <span>${inlineMd(it.text)}</span>
    </label>
  `).join("");

  return `<div class="interactive-checklist" id="${clId}">
    <div class="checklist-head">
      <b style="font-size:12px;color:#eee;">📋 Interactive Action Checklist</b>
      <span class="checklist-progress-pill">${checkedCount}/${total} Completed</span>
    </div>
    <div class="checklist-items">${rows}</div>
    <div class="checklist-foot">
      <button type="button" onclick="resetChecklist('${clId}')">Reset All</button>
      <button type="button" onclick="copyChecklist('${clId}')">Copy Text</button>
    </div>
  </div>`;
}

window.submitMCQ = function(id){
  const container = $(id);
  if(!container) return;
  const selected = container.querySelector(".mcq-opt.selected");
  if(!selected){
    toast("Please select an option first", "warning");
    return;
  }
  const opts = container.querySelectorAll(".mcq-opt");
  opts.forEach(opt => {
    opt.style.pointerEvents = "none";
    if(opt.dataset.correct === "1"){
      opt.classList.add("correct");
    } else if(opt.classList.contains("selected")){
      opt.classList.add("incorrect");
    }
  });
  const exp = $(id + "_exp");
  if(exp) exp.classList.add("show");
  const isRight = selected.dataset.correct === "1";
  toast(isRight ? "🎉 Correct answer!" : "Incorrect — see explanation.");
};

window.resetMCQ = function(id){
  const container = $(id);
  if(!container) return;
  const opts = container.querySelectorAll(".mcq-opt");
  opts.forEach(opt => {
    opt.style.pointerEvents = "";
    opt.classList.remove("selected", "correct", "incorrect");
  });
  const exp = $(id + "_exp");
  if(exp) exp.classList.remove("show");
};

window.toggleChecklistItem = function(cb){
  const label = cb.closest(".checklist-item");
  if(label){
    label.classList.toggle("checked", cb.checked);
  }
  const cl = cb.closest(".interactive-checklist");
  if(cl){
    const items = cl.querySelectorAll(".checklist-item input[type='checkbox']");
    const checked = [...items].filter(c => c.checked).length;
    const pill = cl.querySelector(".checklist-progress-pill");
    if(pill) pill.textContent = `${checked}/${items.length} Completed`;
  }
};

window.resetChecklist = function(id){
  const cl = $(id);
  if(!cl) return;
  const cbs = cl.querySelectorAll(".checklist-item input[type='checkbox']");
  cbs.forEach(cb => {
    cb.checked = false;
    cb.closest(".checklist-item")?.classList.remove("checked");
  });
  const pill = cl.querySelector(".checklist-progress-pill");
  if(pill) pill.textContent = `0/${cbs.length} Completed`;
};

window.copyChecklist = function(id){
  const cl = $(id);
  if(!cl) return;
  const items = cl.querySelectorAll(".checklist-item");
  const text = [...items].map(it => {
    const chk = it.querySelector("input").checked ? "[x]" : "[ ]";
    const label = it.querySelector("span").innerText;
    return `- ${chk} ${label}`;
  }).join("\n");
  navigator.clipboard.writeText(text);
  toast("Checklist copied to clipboard");
};

let speechState = {
  activeBtn: null,
  bodyEl: null,
  chunks: [],
  chunkIndex: 0,
  paused: false,
  timer: null
};

function cleanSpeechText(raw){
  if(!raw) return "";
  let t = raw;
  t = t.replace(/```[\s\S]*?```/g, " Code block omitted. ");
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2");
  t = t.replace(/(\*|_)(.*?)\1/g, "$2");
  t = t.replace(/\|[^\n]+\|/g, "");
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+\.\s+/gm, "");
  t = t.replace(/---+|\*\*\*+/g, "");
  return t.replace(/\s+/g, " ").trim();
}

function chunkSpeechText(text, maxChars = 200){
  if(!text) return [];
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
  const chunks = [];
  let cur = "";
  for(const s of sentences){
    const trimmed = s.trim();
    if(!trimmed) continue;
    if((cur + " " + trimmed).length <= maxChars){
      cur = cur ? (cur + " " + trimmed) : trimmed;
    } else {
      if(cur) chunks.push(cur);
      if(trimmed.length > maxChars){
        const words = trimmed.split(" ");
        let sub = "";
        for(const w of words){
          if((sub + " " + w).length <= maxChars) sub = sub ? (sub + " " + w) : w;
          else { chunks.push(sub); sub = w; }
        }
        if(sub) cur = sub;
        else cur = "";
      } else {
        cur = trimmed;
      }
    }
  }
  if(cur) chunks.push(cur);
  return chunks;
}

function stopSpeech(){
  if(window.speechSynthesis){
    try { window.speechSynthesis.cancel(); } catch(_) {}
  }
  if(speechState.timer){
    clearInterval(speechState.timer);
    speechState.timer = null;
  }
  if(speechState.activeBtn){
    speechState.activeBtn.classList.remove("speaking", "paused");
    speechState.activeBtn.innerHTML = "🔊 Read aloud";
  }
  speechState.activeBtn = null;
  speechState.bodyEl = null;
  speechState.chunks = [];
  speechState.chunkIndex = 0;
  speechState.paused = false;
}

function toggleSpeech(btn, bodyEl){
  if(!window.speechSynthesis){
    toast("Speech synthesis is not supported in this browser", "warning");
    return;
  }

  if(speechState.activeBtn === btn){
    stopSpeech();
    toast("Read aloud stopped");
    return;
  }

  stopSpeech();

  const textToRead = cleanSpeechText(bodyEl.innerText || bodyEl.textContent || "");
  if(!textToRead){
    toast("No text to read aloud");
    return;
  }

  const chunks = chunkSpeechText(textToRead, 220);
  if(!chunks.length){
    toast("No speakable text found");
    return;
  }

  speechState.activeBtn = btn;
  speechState.bodyEl = bodyEl;
  speechState.chunks = chunks;
  speechState.chunkIndex = 0;
  speechState.paused = false;

  btn.classList.add("speaking");
  btn.innerHTML = "⏹ Stop";

  speechState.timer = setInterval(() => {
    if(window.speechSynthesis && window.speechSynthesis.speaking && !window.speechSynthesis.paused){
      window.speechSynthesis.resume();
    }
  }, 10000);

  const voices = window.speechSynthesis.getVoices();
  const femaleVoice = voices.find(v => /female|zira|samantha|kavya|priya|veena|victoria|susan|google.*female/i.test(v.name) && (v.lang.includes("en") || v.lang.includes("hi"))) || voices.find(v => (v.lang && (v.lang.includes("en-IN") || v.lang.includes("hi-IN") || v.lang.includes("en-GB") || v.lang.includes("en-US")))) || null;

  function speakChunk(idx){
    if(idx >= speechState.chunks.length || speechState.activeBtn !== btn){
      stopSpeech();
      return;
    }
    const utter = new SpeechSynthesisUtterance(speechState.chunks[idx]);
    utter.rate = 1.25;
    utter.pitch = 1.0;
    if(femaleVoice) utter.voice = femaleVoice;

    utter.onend = () => {
      speechState.chunkIndex = idx + 1;
      speakChunk(idx + 1);
    };
    utter.onerror = (err) => {
      if(err.error !== "canceled" && err.error !== "interrupted"){
        toast(`Speech error: ${err.error || "unavailable"}`);
      }
      stopSpeech();
    };

    window.speechSynthesis.speak(utter);
  }

  speakChunk(0);
}

function renderSourcesWidget(sources){
  if(!sources || !sources.length) return '';
  const cardsHtml = sources.map((s, idx) => {
    let domain = s.domain || '';
    if(!domain && s.url){
      const dm = String(s.url).match(/^https?:\/\/([^/?#:]+)/i);
      if(dm) domain = dm[1].replace(/^www\./i, '');
      else {
        try { domain = new URL(s.url).hostname.replace(/^www\./i, ''); } catch(_) { domain = 'web source'; }
      }
    }
    const faviconUrl = domain && domain !== 'web source' ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32` : '';
    const title = s.title || domain || 'Source Link';
    const num = s.num || (idx + 1);

    return `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" class="source-card" title="${esc(title)}">
      <div class="source-card-top">
        <span class="source-card-badge">${num}</span>
        ${faviconUrl ? `<img class="source-card-favicon" src="${esc(faviconUrl)}" alt="${esc(domain)}" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='inline-flex'">` : ''}
        <span class="source-card-fallback-icon" style="${faviconUrl ? 'display:none;' : ''}"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg></span>
        <span class="source-card-domain">${esc(domain)}</span>
        <svg class="source-card-ext" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </div>
      <div class="source-card-title">${esc(title)}</div>
    </a>`;
  }).join('');

  return `<div class="sources-widget">
    <div class="sources-head">
      <div class="sources-head-left">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
        <strong>Verified Web Sources</strong>
      </div>
      <span class="sources-count">${sources.length} cited source${sources.length > 1 ? 's' : ''}</span>
    </div>
    <div class="sources-grid">
      ${cardsHtml}
    </div>
  </div>`;
}

function md(t){
  const raw=normalizeMarkdown(t).trim();
  if(!raw)return '<p></p>';
  const lines=raw.split('\n'),out=[];let i=0,paragraph=[];
  const flush=()=>{if(paragraph.length){out.push(`<p>${paragraph.map(inlineMd).join('<br>')}</p>`);paragraph=[]}};
  const parseRow=x=>x.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(v=>v.trim());
  const isTableSeparator=x=>/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(x);
  while(i<lines.length){
    const line=lines[i];
    const isSourcesHeader = /^\s*(?:#{1,6}\s*(?:Sources|Citations|Verified Sources)\b|\*{0,2}(?:Sources|Verified Sources)\*{0,2}:?\s*$)/i.test(line);
    if(isSourcesHeader){
      flush();
      i++;
      const sources = [];
      while(i < lines.length){
        const sLine = lines[i].trim();
        if(!sLine){
          i++;
          continue;
        }
        if(/^#{1,6}\s+/.test(sLine) || /^```/.test(sLine) || /^(?:---+|\*\*\*+|___+)$/.test(sLine)){
          break;
        }
        const linkMatch = sLine.match(/(?:\[(\d{1,2})\]|\b(\d{1,2})[.)])\s*(?:\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+))/i) || sLine.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/i);
        if(linkMatch){
          const num = linkMatch[1] || linkMatch[2] || (sources.length + 1);
          let title = linkMatch[3] || linkMatch[0] || '';
          const url = (linkMatch[4] || linkMatch[5] || (linkMatch[2] && linkMatch[2].startsWith('http') ? linkMatch[2] : '') || '').trim();
          title = title.replace(/^\[\d+\]\s*/, '').replace(/^\[([^\]]+)\]\([^)]+\)/, '$1').trim();
          if(url.startsWith('http')){
            sources.push({ num, title: title || url, url });
          }
        }
        i++;
      }
      if(sources.length > 0){
        out.push(renderSourcesWidget(sources));
      }
      continue;
    }
    if(/^```/.test(line.trim())){
      flush();const lang=line.trim().slice(3).trim();const code=[];i++;
      while(i<lines.length&&!/^```/.test(lines[i].trim())){code.push(lines[i]);i++}
      if(i<lines.length)i++;
      if(lang.toLowerCase()==='mcq'){
        out.push(renderMCQBlock(code.join('\n')));
      } else {
        out.push(`<pre data-lang="${esc(lang||'text')}"><code class="language-${esc(lang)}">${esc(code.join('\n'))}</code></pre>`);
      }
      continue;
    }
    if(/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)){
      flush();out.push('<hr class="md-divider">');i++;continue;
    }
    const tableStart=/^\s*\|?.+\|.+\|?\s*$/.test(line)&&i+1<lines.length&&isTableSeparator(lines[i+1]);
    if(tableStart){
      flush();const head=parseRow(line);i+=2;const rows=[];
      while(i<lines.length&&/^\s*\|.*\|\s*$/.test(lines[i])){rows.push(parseRow(lines[i]));i++}
      const cells=(row,tag)=>`<tr>${head.map((_,j)=>`<${tag}>${inlineMd(row[j]??'')}</${tag}>`).join('')}</tr>`;
      out.push(`<div class="table-wrap"><table><thead>${cells(head,'th')}</thead><tbody>${rows.map(r=>cells(r,'td')).join('')}</tbody></table></div>`);continue;
    }
    const h=line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if(h){flush();const level=Math.min(h[1].length,4);out.push(`<h${level}>${inlineMd(h[2])}</h${level}>`);i++;continue}
    if(/^\s*[-*+]\s+\[([ xX])\]\s+/.test(line)){
      flush();const items=[];
      while(i<lines.length&&/^\s*[-*+]\s+\[([ xX])\]\s+/.test(lines[i])){
        const m=lines[i].match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
        if(m)items.push({checked:m[1].toLowerCase()==='x',text:m[2]});
        i++;
      }
      out.push(renderChecklistBlock(items));
      continue;
    }
    if(/^\s*[-*+]\s+/.test(line)){
      flush();const items=[];while(i<lines.length&&/^\s*[-*+]\s+/.test(lines[i])){items.push(lines[i].replace(/^\s*[-*+]\s+/,''));i++}out.push(`<ul>${items.map(x=>`<li>${inlineMd(x)}</li>`).join('')}</ul>`);continue;
    }
    if(/^\s*\d+[.)]\s+/.test(line)){
      flush();const items=[];while(i<lines.length&&/^\s*\d+[.)]\s+/.test(lines[i])){items.push(lines[i].replace(/^\s*\d+[.)]\s+/,''));i++}out.push(`<ol>${items.map(x=>`<li>${inlineMd(x)}</li>`).join('')}</ol>`);continue;
    }
    if(!line.trim()){flush();i++;continue}
    paragraph.push(line);i++;
  }
  flush();return out.join('');
}
function applyModelTheme(n){const m=state.models[n];const classes=["model-saturn","model-uranus","model-neptune","model-mars"];scene.classList.remove(...classes);scene.classList.add(m.cls);document.documentElement.style.setProperty("--accent",m.accent);document.documentElement.style.setProperty("--model-accent",m.accent);document.documentElement.dataset.model=n.toLowerCase();const dot=document.querySelector(".model-dot");if(dot){dot.style.background=m.accent;dot.style.boxShadow=`0 0 16px ${m.accent}`}}
function setModel(n){if(!state.models[n])return;state.model=n;const m=state.models[n];applyModelTheme(n);$("modelName").textContent=n;$("modelTag").textContent="";$("chatContext").textContent=`${state.mode} · ${n}`;document.querySelectorAll(".model-option").forEach(x=>x.classList.toggle("selected",x.dataset.model===n));$("modelMenu").classList.remove("open");pulseWorld();toast(n)}
function renderModels(){$("modelMenu").innerHTML=Object.entries(state.models).map(([n,m])=>`<button class="model-option" data-model="${n}"><span style="--dot:${m.accent}"></span><div><b>${n}</b></div></button>`).join("");document.querySelectorAll(".model-option").forEach(b=>b.onclick=()=>setModel(b.dataset.model))}
const MODE_ICONS = {
  'General': `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
  'Coding Assistant': `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m8 10 3 2-3 2"/><path d="M13 14h3"/></svg>`,
  'Interview Prep': `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
  'Explain Simply': `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
  'Web Research': `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`
};

function renderModes(){
  const modes=[
    ['General','Everyday questions and practical help'],
    ['Coding Assistant','Code, APIs, debugging and architecture'],
    ['Interview Prep','Interview questions, answers and practice'],
    ['Explain Simply','Simple explanations with less jargon'],
    ['Web Research','Live multi-source web search & citations']
  ];
  $("modeMenu").innerHTML=modes.map(([n,d])=>`<button class="mode-option ${state.mode===n?'selected':''}" role="menuitem" data-mode="${n}"><span class="mode-opt-icon">${MODE_ICONS[n]||''}</span><div class="mode-opt-copy"><b>${n}</b><small>${d}</small></div></button>`).join("");
  document.querySelectorAll(".mode-option").forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
}
function setMode(mode){
  state.mode=mode||state.mode;
  const icon = MODE_ICONS[state.mode] || MODE_ICONS['General'];
  $("modeBtn").innerHTML = `<span class="btn-icon">${icon}</span><span id="modeText">${state.mode}</span><span class="mode-arrow" aria-hidden="true" style="margin-left:2px;">⌄</span>`;
  $("chatContext").textContent=`${state.mode} · ${state.model}`;
  $("modeMenu").classList.remove("open");
  $("modeBtn").setAttribute("aria-expanded","false");
  document.querySelectorAll(".mode-option").forEach(x=>x.classList.toggle("selected",x.dataset.mode===state.mode));
  toast(`Mode: ${state.mode}`);
}

function cycleMode(){
  const modes=['General','Coding Assistant','Interview Prep','Explain Simply','Web Research'];
  const curIdx=modes.indexOf(state.mode);
  const nextIdx=(curIdx>=0?(curIdx+1)%modes.length:0);
  setMode(modes[nextIdx]);
}

function cycleModel(){
  const models=Object.keys(state.models);
  const curIdx=models.indexOf(state.model);
  const nextIdx=(curIdx>=0?(curIdx+1)%models.length:0);
  setModel(models[nextIdx]);
}

function triggerPrompt(promptText){
  if(!$("chatShell").classList.contains("open")){
    openChat();
  }
  const input=$("chatInput");
  if(input){
    input.value=promptText;
    $("chatSendBtn")?.click();
  }
}
function openDrawer(title,html){$("drawerTitle").textContent=title;$("drawerBody").innerHTML=html;drawer.classList.toggle("developer-drawer",title==="About Vaani");drawer.classList.toggle("history-drawer",title==="History");drawer.classList.add("open");backdrop.classList.add("show")}
function closeDrawer(){drawer.classList.remove("open");backdrop.classList.remove("show")}
function pulseWorld(){scene.classList.remove("world-pulse");requestAnimationFrame(()=>scene.classList.add("world-pulse"))}
function newChat(){stopSpeech();scene.classList.remove("chat-active");state.history=[];state.chatId=crypto.randomUUID?.()||Date.now();messages.innerHTML="";hero.classList.remove("hidden");chatShell.classList.remove("open");chatShell.setAttribute("aria-hidden","true");closeDrawer()}
function openChat(){scene.classList.add("chat-active");hero.classList.add("hidden");chatShell.classList.add("open");chatShell.setAttribute("aria-hidden","false");setTimeout(()=>$("chatInput").focus(),120)}
function addMessage(role,text="",streaming=false,attachments=[]){const el=document.createElement("article");el.className=`message ${role}`;const media=(role==="user"&&attachments.length)?`<div class="message-attachments">${attachments.map(x=>{const src=x.data_url||x.preview_url||"";return src?`<div class="message-attachment-image"><img src="${src}" alt="${esc(x.name||"Attachment")}" loading="lazy"><span>${esc(x.name||"Attachment")}</span></div>`:`<span>${esc(x.name||"File")}</span>`}).join("")}</div>`:"";el.innerHTML=`<div class="message-head"><span>${role==="user"?"You":"Vaani"}</span><small>${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</small></div><div class="message-body">${streaming?"<span class='cursor'></span>":md(text)}${media}</div>${role==="assistant"?`<div class="message-actions"><button data-act="speak">🔊 Listen</button><button data-act="copy">Copy</button><button data-act="improve">Improve</button><button data-act="save">Save</button><button data-act="continue">Continue from here</button></div>`:""}`;messages.appendChild(el);chatScroll.scrollTop=chatScroll.scrollHeight;return el}
function setAssistant(el,text,streaming=false){const body=el.querySelector(".message-body");body.classList.toggle("streaming",!!streaming);body.innerHTML=md(text)+(streaming?'<span class="stream-caret" aria-hidden="true"></span>':'');el.querySelectorAll("pre").forEach(pre=>{if(pre.querySelector(".code-copy"))return;const b=document.createElement("button");b.className="code-copy";b.textContent="Copy code";b.onclick=()=>navigator.clipboard.writeText(pre.querySelector("code")?.innerText??pre.innerText);pre.appendChild(b)})}
let stickToBottom=true;
chatScroll?.addEventListener("scroll",()=>{stickToBottom=(chatScroll.scrollHeight-chatScroll.scrollTop-chatScroll.clientHeight)<90});
function pushHistory(role,content){state.history.push({role,content});if(state.history.length>24)state.history.shift()}
function setComposerLocked(locked){
  document.querySelectorAll("#promptInput,#chatInput,#sendBtn,#chatSendBtn,#attachBtn,#chatAttachBtn,#voiceBtn,#chatVoiceBtn").forEach(el=>{if(el)el.disabled=locked});
  document.querySelectorAll(".composer").forEach(el=>el.classList.toggle("locked",locked));
}
function focusComposer(){const input=$("chatShell").classList.contains("open")?$("chatInput"):$("promptInput");if(input&&!input.disabled){input.focus();if(input.setSelectionRange)input.setSelectionRange(input.value.length,input.value.length)}}
function startVisionActivity(el,kind="image") {
  if(!el) return ()=>{};
  const label=kind==="image"?"Reading your image…":"Reading your file…";
  const stages=kind==="image"?[
    [8,"Uploading image…"],[28,"Image received…"],[48,"Reading image…"],[66,"Understanding what’s visible…"],[82,"Analyzing details…"],[91,"Preparing your answer…"]
  ]:[[8,"Uploading file…"],[30,"File received…"],[52,"Reading contents…"],[72,"Understanding the file…"],[88,"Preparing your answer…"]];
  const body=el.querySelector(".message-body");
  if(!body) return ()=>{};
  body.innerHTML=`<div class="vision-activity" role="status" aria-live="polite"><div class="vision-activity-head"><span class="vision-orb" aria-hidden="true"></span><div><strong>${label}</strong><small>Vaani is working on the attachment</small></div><b class="vision-percent">8%</b></div><div class="vision-progress"><i></i></div><div class="vision-stage">Uploading image…</div></div>`;
  const fill=body.querySelector(".vision-progress i"),pct=body.querySelector(".vision-percent"),stage=body.querySelector(".vision-stage");
  let index=0,timer=null;
  const advance=()=>{
    index=Math.min(index+1,stages.length-1);
    const [value,text]=stages[index];
    if(fill)fill.style.setProperty("--vision-progress",value+"%");
    if(pct)pct.textContent=value+"%";
    if(stage)stage.textContent=text;
    if(index<stages.length-1) timer=setTimeout(advance,index<2?650:950);
  };
  timer=setTimeout(advance,650);
  return ()=>{if(timer)clearTimeout(timer)};
}
async function send(text){
  stopSpeech();
  text=(text||"").trim();
  const hasImage=state.images.length>0;
  const hasFile=state.files.length>0;
  if((!text&&!hasImage&&!hasFile)||state.controller)return;
  const messageText=text||"Please inspect the attached file/image and help me understand it.";
  const attachedFiles=state.files.slice();
  const attachedImages=state.images.slice();
  const attachmentPayload=attachedFiles.map(f=>({name:f.name,mime:f.mime,kind:f.kind,text:f.text||"",data_url:f.data_url||""}));
  openChat();
  pushHistory("user",messageText);
  const sentAttachments=[...attachedImages, ...attachedFiles.filter(f=>(f.data_url||f.preview_url) && !attachedImages.some(x=>x.fileId===f.id))];
  addMessage("user",messageText,false,sentAttachments);
  const a=addMessage("assistant","",true);
  stickToBottom=true;
  const stopVisionActivity=(hasImage||hasFile)?startVisionActivity(a,hasImage?"image":"file"):()=>{};
  $("stopBtn").disabled=false;
  $("latencyBadge").textContent=hasImage||hasFile?"Reading…":"Crafting…";
  scene.classList.add("generating");
  setComposerLocked(true);
  const started=performance.now();
  state.controller=new AbortController();
  const safetyTimer=setTimeout(()=>{try{state.controller&&state.controller.abort()}catch(_){}},45000);
  let live={client_timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,workspace:state.workspace,memory:state.memory.slice(-12),files:attachedFiles.length?attachedFiles.map(f=>`${f.name}:\n${f.text||""}`).join("\n\n").slice(0,30000):"",images:attachedImages.map(x=>({fileId:x.fileId,name:x.name,data_url:x.data_url||"",mime:x.mime})).slice(0,8),attachments:attachmentPayload.slice(0,8)};
  try{
    const requestBody={message:messageText,history:state.history.slice(0,-1),mode:state.mode,model:state.models[state.model].id,live_context:live};
    const r=await chatRequest(requestBody,state.controller.signal);
    if(!r.ok){let d=await r.json().catch(()=>({}));throw Object.assign(new Error(d.error||`HTTP ${r.status}`),{status:r.status})}
    const contentType=(r.headers.get("content-type")||"").toLowerCase();
    if(!contentType.includes("text/event-stream")){
      const d=await r.json();
      if(d.error)throw new Error(d.error);
      const full=String(d.text||"");
      if(!full)throw new Error("No response returned.");
      stopVisionActivity();setAssistant(a,full);pushHistory("assistant",full);
      state.files=[];state.images=[];renderFileChip();
      $("latencyBadge").textContent=`${((performance.now()-started)/1000).toFixed(1)}s`;
      persistChat(messageText,full);return;
    }
    const reader=r.body.getReader(),dec=new TextDecoder();let buf="",full="";
    let rafPending=false;
    const flushRender=()=>{rafPending=false;setAssistant(a,full,true);if(stickToBottom)chatScroll.scrollTop=chatScroll.scrollHeight};
    const scheduleRender=()=>{if(rafPending)return;rafPending=true;requestAnimationFrame(flushRender)};
    streamLoop: while(true){const {done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const lines=buf.split("\n");buf=lines.pop()||"";for(const line of lines){if(!line.startsWith("data:"))continue;const raw=line.slice(5).trim();if(raw==="[DONE]"){try{await reader.cancel()}catch(_){}break streamLoop}let d;try{d=JSON.parse(raw)}catch{continue}if(d.error)throw new Error(d.error);if(d.text){full+=d.text;scheduleRender()}}}
    if(!full.trim())throw new Error("No response returned.");
    setAssistant(a,full,false);
    if(stickToBottom)chatScroll.scrollTop=chatScroll.scrollHeight;
    stopVisionActivity();pushHistory("assistant",full);state.files=[];state.images=[];renderFileChip();$("latencyBadge").textContent=`${((performance.now()-started)/1000).toFixed(1)}s`;persistChat(messageText,full);
  }catch(e){
    stopVisionActivity();
    if(e.name==="AbortError"){setAssistant(a,`_Response stopped by you._`)}
    else{state.files=attachedFiles;state.images=attachedImages;renderFileChip();setAssistant(a,`**Vaani couldn't complete that request.**\n\n${e.message}`);toast("Request failed — attachment kept for retry.","warning")}
  }finally{
    clearTimeout(safetyTimer);
    state.controller=null;$("stopBtn").disabled=true;scene.classList.remove("generating");setComposerLocked(false);setTimeout(()=>$("latencyBadge").textContent="Ready",2400);setTimeout(focusComposer,40);
  }
}
function persistChat(user,assistant){const arr=JSON.parse(localStorage.getItem("vaani_chats")||"[]");arr.unshift({id:state.chatId||Date.now(),title:user.slice(0,54),model:state.model,time:Date.now(),messages:[...state.history]});localStorage.setItem("vaani_chats",JSON.stringify(arr.slice(0,40)))}
async function analyzeFile(file,onProgress){
  let upload=file;
  if(file.type.startsWith("image/")&&file.size>4*1024*1024){
    upload=await new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{const max=2200,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));c.getContext("2d").drawImage(img,0,0,c.width,c.height);c.toBlob(b=>{URL.revokeObjectURL(url);b?resolve(new File([b],file.name.replace(/\.(png|webp)$/i,".jpg"),{type:"image/jpeg"})):reject(new Error("Could not prepare image"))},"image/jpeg",.88)};img.onerror=()=>reject(new Error("Could not read image"));img.src=url})
  }
  const fd=()=>{const x=new FormData();x.append("file",upload);return x};
  const base=API_BASE;
  return await new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open("POST",base+"/api/files/analyze");
    xhr.responseType="json";
    xhr.upload.onprogress=e=>{if(e.lengthComputable&&onProgress)onProgress(Math.round(e.loaded/e.total*100),"Uploading")};
    xhr.onload=()=>{const d=xhr.response||{};if(xhr.status>=200&&xhr.status<300&&d.ok)resolve(d);else reject(Object.assign(new Error(d.error||`Upload failed (${xhr.status})`),{status:xhr.status}))};
    xhr.onerror=()=>reject(Object.assign(new Error("Network error while uploading"),{status:0}));
    xhr.ontimeout=()=>reject(Object.assign(new Error("Upload timed out"),{status:0}));
    xhr.timeout=120000;
    xhr.send(fd());
  });
}
function formatBytes(n){if(n<1024)return `${n} B`;if(n<1048576)return `${(n/1024).toFixed(1)} KB`;return `${(n/1048576).toFixed(1)} MB`}
function renderFileChip(){
  const containers=[$("heroAttachments"),$("chatAttachments")].filter(Boolean);
  const legacy=$("fileChip");
  if(!state.files.length){
    containers.forEach(el=>{el.innerHTML="";el.classList.remove("has-files")});
    if(legacy){legacy.innerHTML="";legacy.classList.remove("has-files")}
    return;
  }
  const markup=state.files.map((f,i)=>{
    const thumb=f.kind==="image"&&(f.data_url||f.preview_url)?`<img class="file-thumb" src="${f.data_url||f.preview_url}" alt="${esc(f.name)}">`:`<span class="file-symbol">${f.kind==="image"?"▧":"▤"}</span>`;
    const stateText=f.status==='ready'?'✓ Ready':f.status==='error'?'⚠ Failed':`${esc(f.statusText||'Uploading')} ${f.progress||0}%`;
    return `<div class="file-pill" data-file-id="${esc(f.id)}"><span class="file-visual">${thumb}</span><span class="file-meta"><b title="${esc(f.name)}">${esc(f.name)}</b><small>${esc((f.mime||"application/octet-stream").toUpperCase())} · ${formatBytes(f.size||0)}</small></span><span class="file-state ${f.status==='ready'?'ready':f.status==='error'?'error':''}">${stateText}<button type="button" data-remove-file="${i}" aria-label="Remove ${esc(f.name)}">×</button></span>${f.status!=='ready'?`<span class="upload-track"><i style="--progress:${f.progress||0}%"></i></span>`:""}<span class="file-live-note">${esc(f.note||"")}</span></div>`;
  }).join("");
  containers.forEach(el=>{el.classList.add("has-files");el.innerHTML=markup;el.querySelectorAll("[data-remove-file]").forEach(b=>b.onclick=()=>{const idx=Number(b.dataset.removeFile),removed=state.files[idx];state.files.splice(idx,1);state.images=state.images.filter(x=>x.fileId!==removed?.id);renderFileChip()})});
  if(legacy){legacy.innerHTML="";legacy.classList.remove("has-files")}
}
async function attach(files){
  const incoming=[...files].filter(Boolean);
  if(incoming.length>10){toast('You can upload a maximum of 10 files at a time.','warning');return;}
  if(!incoming.length)return;
  for(const f of incoming){
    const id=crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;
    const previewUrl=(f.type||"").startsWith("image/")?URL.createObjectURL(f):"";
    const item={id,name:f.name,size:f.size,mime:f.type||"application/octet-stream",type:(f.name.split(".").pop()||"").toLowerCase(),kind:(f.type||"").startsWith("image/")?"image":"document",status:"uploading",progress:0,statusText:"Uploading",note:"Vaani is receiving your file…",preview_url:previewUrl};
    state.files.push(item);renderFileChip();
    try{
      const d=await analyzeFile(f,(p,st)=>{item.progress=p;item.statusText=st;item.note=p<100?"Sending the file to Vaani…":"Upload complete. Reading the file…";renderFileChip()});
      item.status="processing";item.progress=100;item.statusText="Processing";item.note=item.kind==="image"?"Image is ready for visual questions…":"Vaani is reading the file contents…";renderFileChip();
      item.text=d.text||"";item.data_url=d.data_url||"";item.type=d.type||item.type;item.mime=d.mime||item.mime;item.kind=d.kind||item.kind;item.status="ready";item.statusText="Ready";item.note=item.kind==="image"?"Image attached. Your next message will use this image as context.":"File content is ready for your next question.";
      if(item.kind==="image"&&d.data_url)state.images.push({fileId:item.id,name:d.name,data_url:d.data_url,preview_url:item.preview_url,mime:d.mime||item.mime});
      renderFileChip();toast(`${d.name} is ready`);
    }catch(e){item.status="error";item.statusText="Failed";item.note=e.message;renderFileChip();toast(`${f.name}: ${e.message}`)}
  }
}
function showModelGuide(){
  const entries=Object.entries(state.models);
  openDrawer("Model Guide",`
    <p class="muted">Click any model below to instantly switch Vaani's active intelligence world.</p>
    <div class="model-guide">
      ${entries.map(([n,m])=>`
        <article class="guide-card ${state.model===n?'active':''}" data-guide-model="${n}" style="cursor:pointer;padding:12px 14px;margin-bottom:8px;border:1px solid ${state.model===n?'color-mix(in srgb,var(--accent) 55%,rgba(255,255,255,.12))':'rgba(255,255,255,.08)'};border-radius:12px;background:rgba(255,255,255,.03);transition:.2s;">
          <div class="guide-head" style="display:flex;justify-content:space-between;align-items:center;">
            <b style="font-size:13px;color:#fff;">${n}</b>
            <span style="font-size:10px;font-weight:600;color:var(--accent);">${state.model===n?'✓ Active':'Select ›'}</span>
          </div>
          <p style="font-size:11.5px;color:#9fa1a9;margin:6px 0 0;line-height:1.5;">${n==='Saturn'?'General chat, everyday tasks, and broad reasoning.':n==='Uranus'?'Coding, technical architecture, debugging and complex reasoning.':n==='Neptune'?'Long-context synthesis, complex analysis and reasoning.':'Creative workflows, visual intelligence and multimodal analysis.'}</p>
        </article>
      `).join('')}
      <div class="guide-note" style="margin-top:12px;font-size:11px;color:#7e8088;">Selected model takes effect immediately across all chats in this workspace.</div>
    </div>
  `);
  drawer.querySelectorAll("[data-guide-model]").forEach(el => {
    el.onclick = () => {
      setModel(el.dataset.guideModel);
      showModelGuide();
    };
  });
}
const CMD_ICONS = {
  plus: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
  target: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m13 2-8 12h6l-1 8 8-12h-6l1-8Z"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
  info: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`,
  sparkle: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  book: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10M6 10h10"/></svg>`,
  layers: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/></svg>`,
  table: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>`,
  workspace: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/></svg>`,
  pulse: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  developer: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="5" rx="2"/><path d="m7 15 3-3-3-3M13 15h4"/></svg>`,
  export: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>`,
  attach: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
  code: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  compass: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
  image: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  video: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg>`
};
let plusAnchorId="attachBtn";
function positionPlusMenu(anchor){
  const p=$('plusMenu');if(!p.classList.contains('open'))return;
  const r=(anchor||$(plusAnchorId)||$('attachBtn'))?.getBoundingClientRect();if(!r)return;
  const gap=7,pad=10,maxW=Math.min(370,window.innerWidth-pad*2),maxH=Math.min(560,Math.max(300,window.innerHeight-135));
  p.style.width=`${maxW}px`;p.style.maxHeight=`${maxH}px`;
  const h=Math.min(p.scrollHeight,maxH),w=maxW;let left=Math.min(Math.max(pad,r.left),Math.max(pad,window.innerWidth-w-pad));
  let top=r.top-gap-h;if(top<pad)top=Math.min(r.bottom+gap,window.innerHeight-h-pad);
  p.style.left=`${Math.round(left)}px`;p.style.top=`${Math.round(Math.max(pad,top))}px`;p.style.bottom='auto';
}
function openPlusMenu(anchorId){
  if(anchorId)plusAnchorId=anchorId;const p=$('plusMenu');
  p.innerHTML=`<div class="plus-title"><b>CREATE & ATTACH</b><small>Add context, research or creation tools.</small></div><div class="plus-group">INPUT & UNDERSTAND</div><button class="plus-item" data-plus="files"><span class="plus-icon">${CMD_ICONS.attach}</span><span class="plus-copy"><b>Add Photos & Files</b><small>Images, screenshots, PDFs, documents and code</small></span><em>ADD</em></button><button class="plus-item" data-plus="data"><span class="plus-icon">${CMD_ICONS.table}</span><span class="plus-copy"><b>Analyze Data</b><small>CSV and Excel analysis</small></span><em>DATA</em></button><button class="plus-item" data-plus="code"><span class="plus-icon">${CMD_ICONS.code}</span><span class="plus-copy"><b>Code & Files</b><small>Review, explain and debug files</small></span><em>CODE</em></button><div class="plus-divider"></div><div class="plus-group">DISCOVER & CREATE</div><button class="plus-item" data-plus="research"><span class="plus-icon">${CMD_ICONS.search}</span><span class="plus-copy"><b>Web Search</b><small>Current information and sources</small></span><em>WEB</em></button><button class="plus-item" data-plus="deep"><span class="plus-icon">${CMD_ICONS.compass}</span><span class="plus-copy"><b>Deep Research</b><small>Multi-source research workflow</small></span><em>DEEP</em></button><button class="plus-item" data-plus="image"><span class="plus-icon">${CMD_ICONS.image}</span><span class="plus-copy"><b>Create Image</b><small>Generate a new image</small></span><em>GEN</em></button><button class="plus-item" data-plus="edit"><span class="plus-icon">${CMD_ICONS.edit}</span><span class="plus-copy"><b>Edit Image</b><small>Edit an attached image</small></span><em>EDIT</em></button><button class="plus-item" data-plus="video"><span class="plus-icon">${CMD_ICONS.video}</span><span class="plus-copy"><b>Create Video</b><small>Generate a short video with audio</small></span><em>VIDEO</em></button><div class="plus-divider"></div><div class="plus-group">WORKSPACE</div><button class="plus-item" data-plus="workspace"><span class="plus-icon">${CMD_ICONS.workspace}</span><span class="plus-copy"><b>Add to Workspace</b><small>Keep work under the active workspace</small></span><em>SPACE</em></button><button class="plus-item" data-plus="new"><span class="plus-icon">${CMD_ICONS.plus}</span><span class="plus-copy"><b>New Chat</b><small>Start a clean conversation</small></span><em>NEW</em></button>`;
  p.classList.add('open');p.setAttribute('aria-hidden','false');p.querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>plusAction(b.dataset.plus));requestAnimationFrame(()=>positionPlusMenu($(plusAnchorId)));
}
function closePlus(){const p=$('plusMenu');p.classList.remove('open');p.setAttribute('aria-hidden','true')}
function plusAction(a){
  closePlus();
  if(a==='files'||a==='code') return ($("chatShell").classList.contains("open")?$('chatFileInput'):$('fileInput')).click();
  if(a==='data') return showDataAnalysis();
  if(a==='research') return showResearch();
  if(a==='deep') return showDeepResearch();
  if(a==='image') return showCreateImage();
  if(a==='edit') return showEditImage();
  if(a==='video') return showCreateVideo();
  if(a==='workspace') return showWorkspaces();
  if(a==='new') return newChat();
}

function setupChipGroup(containerId){
  const el = $(containerId);
  if(!el) return;
  el.querySelectorAll(".studio-chip, .aspect-card").forEach(btn => {
    btn.onclick = () => {
      el.querySelectorAll(".studio-chip, .aspect-card").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    };
  });
}

function setupChipToggle(containerId){
  const el = $(containerId);
  if(!el) return;
  el.querySelectorAll(".studio-chip").forEach(btn => {
    btn.onclick = () => btn.classList.toggle("active");
  });
}

function downloadFile(url, filename){
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast(`Downloading ${filename}…`);
}

function showDeepResearch(){
  openDrawer("Deep Research",`
    <div class="drawer-hero-badge">
      <div class="drawer-hero-icon">${CMD_ICONS.compass}</div>
      <div>
        <h4 style="margin:0;font-size:14px;color:#fff;font-weight:600;">Deep Research Terminal</h4>
        <small style="color:#9da0a8;font-size:11px;">Multi-source autonomous intelligence &amp; citation engine</small>
      </div>
    </div>
    <div class="studio-container">
      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.bolt} Research Depth &amp; Mode</label>
        <div class="studio-chips" id="deepDepthChips">
          <button class="studio-chip active" data-depth="fast">⚡ Quick Scan <small>(3-5 sources)</small></button>
          <button class="studio-chip" data-depth="deep">🔍 Comprehensive <small>(10+ sources)</small></button>
          <button class="studio-chip" data-depth="academic">🧠 Academic / Technical</button>
        </div>
      </div>

      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.globe} Domain Focus</label>
        <div class="studio-chips" id="deepDomainChips">
          <button class="studio-chip active" data-domain="all">🌐 All Web</button>
          <button class="studio-chip" data-domain="tech">🔬 Tech &amp; AI</button>
          <button class="studio-chip" data-domain="finance">📊 Finance &amp; Market</button>
          <button class="studio-chip" data-domain="papers">📄 Research Papers</button>
        </div>
      </div>

      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.sparkle} Quick Topics</label>
        <div class="prompt-ideas">
          <button class="prompt-idea-btn" data-topic="Latest Quantum Computing breakthroughs and commercial timeline"><span>⚡</span> Quantum computing milestones &amp; commercial timeline</button>
          <button class="prompt-idea-btn" data-topic="State of Small Language Models (SLMs) on Edge Devices 2026"><span>⚡</span> Small Language Models (SLMs) on edge hardware</button>
          <button class="prompt-idea-btn" data-topic="Autonomous AI agent architectures and Model Context Protocol (MCP)"><span>⚡</span> Autonomous AI agent architectures &amp; tool benchmarks</button>
        </div>
      </div>

      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.search} Investigation Query</label>
        <div class="research-box" style="margin-top:2px;">
          <input id="deepInput" placeholder="What should Vaani investigate in-depth?">
          <button id="deepGo">${CMD_ICONS.search} Investigate</button>
        </div>
      </div>

      <div id="deepPipeline" style="display:none;" class="research-pipeline">
        <div class="pipeline-step" id="pipeStep1"><span class="pipeline-dot">1</span><span>Expanding query into sub-topics &amp; documentation paths…</span></div>
        <div class="pipeline-step" id="pipeStep2"><span class="pipeline-dot">2</span><span>Crawling verified web sources &amp; academic indexes…</span></div>
        <div class="pipeline-step" id="pipeStep3"><span class="pipeline-dot">3</span><span>Cross-verifying claims, dates &amp; source authority…</span></div>
        <div class="pipeline-step" id="pipeStep4"><span class="pipeline-dot">4</span><span>Synthesizing structured executive intelligence report…</span></div>
      </div>

      <div id="deepResults" class="research-results" style="margin-top:4px;">
        <div class="muted">Select a topic or enter a query above to initiate multi-source research.</div>
      </div>
    </div>
  `);

  setupChipGroup("deepDepthChips");
  setupChipGroup("deepDomainChips");

  drawer.querySelectorAll("[data-topic]").forEach(btn => {
    btn.onclick = () => {
      $("deepInput").value = btn.dataset.topic;
      $("deepGo").click();
    };
  });

  $("deepGo").onclick = async () => {
    const q = $("deepInput").value.trim();
    if(!q) return toast("Enter a topic to investigate");
    const pipe = $("deepPipeline");
    const resBox = $("deepResults");
    pipe.style.display = "flex";
    resBox.innerHTML = "";
    $("deepGo").disabled = true;

    const s1 = $("pipeStep1"), s2 = $("pipeStep2"), s3 = $("pipeStep3"), s4 = $("pipeStep4");
    [s1,s2,s3,s4].forEach(s => s.className = "pipeline-step");
    s1.classList.add("active");
    const t1 = setTimeout(() => { s1.className = "pipeline-step done"; s2.classList.add("active"); }, 900);
    const t2 = setTimeout(() => { s2.className = "pipeline-step done"; s3.classList.add("active"); }, 2000);
    const t3 = setTimeout(() => { s3.className = "pipeline-step done"; s4.classList.add("active"); }, 3400);

    try {
      const r = await fetch(API_BASE + "/api/research?q=" + encodeURIComponent(q));
      const d = await r.json();
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      [s1,s2,s3,s4].forEach(s => s.className = "pipeline-step done");
      if(!r.ok || !d.ok) throw new Error(d.error || "Research synthesis failed");

      resBox.innerHTML = `
        <div class="data-summary" style="margin-top:10px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <b>${esc(d.query)}</b>
            <span style="font-size:10px;padding:3px 7px;border-radius:6px;background:rgba(255,255,255,.06);color:var(--accent);">● ${d.results?.length || 0} SOURCES VERIFIED</span>
          </div>
          <div style="font-size:13px;line-height:1.65;color:#e1e3ea;margin-bottom:12px;">${md(d.summary || "No executive summary produced.")}</div>
          <div class="studio-action-bar">
            <button class="studio-action-btn primary" id="deepSendChat">💬 Send Report to Chat</button>
            <button class="studio-action-btn" id="deepCopyReport">📋 Copy Summary</button>
          </div>
          <h5 style="font-size:11px;color:#aaa;margin:16px 0 8px;text-transform:uppercase;letter-spacing:.05em;">Verified Source Evidence:</h5>
          ${(d.results || []).map((x, i) => `
            <a target="_blank" rel="noopener" href="${esc(x.url || '#')}" style="display:block;margin-top:7px;padding:9px 12px;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(255,255,255,.02);text-decoration:none;">
              <b style="font-size:12px;color:#fff;">[${i+1}] ${esc(x.title || 'Source')}</b>
              <span style="font-size:11px;color:#bbb;display:block;margin-top:3px;line-height:1.4;">${esc(x.text || '')}</span>
              <small style="color:var(--accent);font-size:10px;display:block;margin-top:4px;">${esc(x.url || '')}</small>
            </a>
          `).join('')}
        </div>
      `;

      $("deepSendChat").onclick = () => {
        closeDrawer();
        openChat();
        addMessage('assistant', `### 🔍 Deep Research: ${d.query}\n\n${d.summary}\n\n**Sources Consulted:**\n${(d.results || []).slice(0, 5).map((x, i) => `${i+1}. [${x.title}](${x.url})`).join('\n')}`);
        toast("Report sent to chat");
      };

      $("deepCopyReport").onclick = () => {
        navigator.clipboard.writeText(`Deep Research: ${d.query}\n\n${d.summary}\n\nSources:\n${(d.results || []).map(x => `- ${x.title}: ${x.url}`).join('\n')}`);
        toast("Report copied to clipboard");
      };

    } catch(e) {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      resBox.innerHTML = `<div class='muted' style="color:#f87171;">${esc(e.message)}</div>`;
    } finally {
      $("deepGo").disabled = false;
    }
  };
  $("deepInput").onkeydown = e => { if(e.key === "Enter") $("deepGo").click(); };
}

function showCreateImage(){
  openDrawer("Create Image",`
    <div class="drawer-hero-badge">
      <div class="drawer-hero-icon">${CMD_ICONS.image}</div>
      <div>
        <h4 style="margin:0;font-size:14px;color:#fff;font-weight:600;">AI Image Studio</h4>
        <small style="color:#9da0a8;font-size:11px;">Generate high-fidelity visual artwork from text</small>
      </div>
    </div>
    <div class="studio-container">
      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.sparkle} Visual Style Presets</label>
        <div class="studio-chips" id="imgStyleChips">
          <button class="studio-chip active" data-style="Photorealistic 8K, highly detailed, shot on 35mm lens">📸 Photorealistic 8K</button>
          <button class="studio-chip" data-style="Cyberpunk aesthetics, neon glow, wet reflections, Tokyo night">🌆 Cyberpunk Neon</button>
          <button class="studio-chip" data-style="Anime visual masterpiece, Makoto Shinkai style, vibrant sky">⛩️ Anime Aesthetic</button>
          <button class="studio-chip" data-style="Dramatic studio lighting portrait, Hasselblad medium format">🎨 Studio Portrait</button>
          <button class="studio-chip" data-style="Cinematic 35mm film still, Kodak Portra 400, soft grain">🎬 35mm Film Still</button>
          <button class="studio-chip" data-style="3D isometric render, blender clay, soft pastel ambient occlusion">🧊 3D Minimal Clay</button>
          <button class="studio-chip" data-style="Oil painting, impressionist thick impasto brushstrokes, dramatic light">🖼️ Oil Painting</button>
        </div>
      </div>

      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.layers} Aspect Ratio</label>
        <div class="aspect-grid" id="imgAspectGrid">
          <button class="aspect-card active" data-aspect="1:1">
            <span class="aspect-shape sq"></span>
            <b>1:1</b>
            <small>Square</small>
          </button>
          <button class="aspect-card" data-aspect="16:9">
            <span class="aspect-shape wide"></span>
            <b>16:9</b>
            <small>Landscape</small>
          </button>
          <button class="aspect-card" data-aspect="9:16">
            <span class="aspect-shape tall"></span>
            <b>9:16</b>
            <small>Portrait</small>
          </button>
          <button class="aspect-card" data-aspect="4:3">
            <span class="aspect-shape classic"></span>
            <b>4:3</b>
            <small>Classic</small>
          </button>
        </div>
      </div>

      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.sun} Lighting &amp; Atmosphere</label>
        <div class="studio-chips" id="imgLightingChips">
          <button class="studio-chip" data-light="golden hour warm sunlight, soft long shadows">Golden Hour</button>
          <button class="studio-chip" data-light="moody volumetric neon lighting, lens flare">Neon Glow</button>
          <button class="studio-chip" data-light="soft diffused cloudy overcast daylight">Soft Daylight</button>
          <button class="studio-chip" data-light="bioluminescent blue and purple glowing particles">Bioluminescent</button>
        </div>
      </div>

      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.compass} Prompt Inspiration</label>
        <div class="prompt-ideas">
          <button class="prompt-idea-btn" data-fill="A futuristic glass research laboratory in Tokyo at midnight, floating holographic AI models, rain on window"><span>✦</span> Futuristic Tokyo glass AI laboratory with holograms</button>
          <button class="prompt-idea-btn" data-fill="An intricate mechanical steampunk owl with glowing sapphire crystal eyes and brass clockwork gears"><span>✦</span> Steampunk mechanical owl with sapphire eyes &amp; gears</button>
          <button class="prompt-idea-btn" data-fill="A serene minimalist Scandinavian cabin over a misty Norwegian fjord at twilight, warm glowing interior"><span>✦</span> Minimalist Nordic cabin over misty twilight fjord</button>
        </div>
      </div>

      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.edit} Prompt Description</label>
        <div class="data-tool" style="padding:0;">
          <textarea id="imgPrompt" rows="4" placeholder="Describe the artwork you want to create (e.g. A cybernetic tiger prowling in a bamboo forest with glowing stripes)..."></textarea>
          <button id="imgRun" class="btn-primary">${CMD_ICONS.image} <span>Generate Artwork</span></button>
          <div id="imgOutput" class="data-output" style="margin-top:10px;"></div>
        </div>
      </div>
    </div>
  `);

  setupChipGroup("imgStyleChips");
  setupChipGroup("imgAspectGrid");
  setupChipToggle("imgLightingChips");

  drawer.querySelectorAll("[data-fill]").forEach(btn => {
    btn.onclick = () => {
      $("imgPrompt").value = btn.dataset.fill;
      $("imgPrompt").focus();
    };
  });

  $("imgRun").onclick = async () => {
    const basePrompt = $("imgPrompt").value.trim();
    if(!basePrompt) return toast("Describe the image you want first");
    const styleChip = drawer.querySelector("#imgStyleChips .active");
    const aspectChip = drawer.querySelector("#imgAspectGrid .active");
    const lightChips = Array.from(drawer.querySelectorAll("#imgLightingChips .active")).map(c => c.dataset.light);

    let fullPrompt = basePrompt;
    if(styleChip?.dataset.style) fullPrompt += `, style: ${styleChip.dataset.style}`;
    if(lightChips.length) fullPrompt += `, lighting: ${lightChips.join(', ')}`;
    if(aspectChip?.dataset.aspect) fullPrompt += `, aspect ratio ${aspectChip.dataset.aspect}`;

    $("imgRun").disabled = true;
    $("imgOutput").innerHTML = "<div class='muted'>Crafting artwork with Gemini Image Model… please wait.</div>";

    try {
      const r = await fetch(API_BASE + '/api/generate/image', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({prompt: fullPrompt, images: state.images.slice(0, 3)})
      });
      const d = await r.json();
      if(!r.ok || !d.ok) throw new Error(d.error || 'Image generation is temporarily unavailable.');
      if(!d.data_url) throw new Error('No image was returned.');

      $("imgOutput").innerHTML = `
        <div style="margin-top:6px;">
          <img class="generated-preview" src="${d.data_url}" alt="AI Generated Image" id="latestGenImg" style="cursor:zoom-in;">
          <div class="studio-action-bar">
            <button class="studio-action-btn primary" id="imgDownload">⬇ Download PNG</button>
            <button class="studio-action-btn" id="imgSendChat">💬 Insert to Chat</button>
            <button class="studio-action-btn" id="imgRetouch">✨ Retouch This</button>
          </div>
        </div>
      `;

      $("latestGenImg").onclick = () => openImageLightbox(d.data_url, basePrompt);
      $("imgDownload").onclick = () => downloadFile(d.data_url, `vaani-art-${Date.now()}.png`);
      $("imgSendChat").onclick = () => {
        closeDrawer();
        openChat();
        addMessage('assistant', `### 🎨 AI Generated Artwork\n\nPrompt: *"${basePrompt}"*\n\n![Generated Art](${d.data_url})`);
        toast("Inserted into chat");
      };
      $("imgRetouch").onclick = () => {
        state.images.unshift({name: 'generated-art.png', data_url: d.data_url, size: d.data_url.length, type: 'image/png'});
        showEditImage(d.data_url);
      };

    } catch(e) {
      $("imgOutput").innerHTML = `<div class='muted' style="color:#f87171;">${esc(e.message)}</div>`;
    } finally {
      $("imgRun").disabled = false;
    }
  };
}

function showEditImage(initialDataUrl = null){
  let selectedDataUrl = initialDataUrl || (state.images.length ? state.images[0].data_url : null);
  let selectedName = state.images.length ? state.images[0].name : "Selected photo";

  openDrawer("Edit Image",`
    <div class="drawer-hero-badge">
      <div class="drawer-hero-icon">${CMD_ICONS.edit}</div>
      <div>
        <h4 style="margin:0;font-size:14px;color:#fff;font-weight:600;">AI Image Retouch &amp; Edit Lab</h4>
        <small style="color:#9da0a8;font-size:11px;">Transform, restyle and modify existing photos</small>
      </div>
    </div>
    <div class="studio-container">
      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.image} 1. Select Base Image</label>
        <div id="editSourceContainer">
          ${selectedDataUrl ? `
            <div style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.09);">
              <img id="editSourceThumb" src="${selectedDataUrl}" style="width:54px;height:54px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,.12);">
              <div style="flex:1;overflow:hidden;">
                <b id="editSourceLabel" style="font-size:12px;display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;">${esc(selectedName)}</b>
                <small style="color:#888;font-size:11px;">Active image for modification</small>
              </div>
              <button id="editChangeImgBtn" class="studio-action-btn" style="min-width:auto;padding:5px 9px;">Change</button>
            </div>
          ` : `
            <div class="library-upload-box" style="margin-bottom:4px;">
              <input type="file" id="editFileInput" accept="image/png,image/jpeg,image/webp">
              <label for="editFileInput" class="library-upload-btn">＋ Click to upload photo to edit</label>
            </div>
          `}
        </div>

        ${state.images.length > 1 ? `
          <div style="margin-top:6px;">
            <small style="color:#888;font-size:10.5px;display:block;margin-bottom:4px;">Or pick from attached chat images:</small>
            <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;">
              ${state.images.map((img, i) => `
                <img src="${img.data_url}" data-img-idx="${i}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;cursor:pointer;border:1.5px solid ${selectedDataUrl === img.data_url ? 'var(--accent)' : 'rgba(255,255,255,.1)'};">
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.sparkle} 2. Quick Transformation Actions</label>
        <div class="studio-chips" id="editPresetChips">
          <button class="studio-chip" data-edit="Change background to a starry night cosmic galaxy with purple nebulae">🌌 Galaxy Background</button>
          <button class="studio-chip" data-edit="Add cyberpunk neon lighting, rain reflections, and glowing futuristic accents">🏙️ Cyberpunk Restyle</button>
          <button class="studio-chip" data-edit="Apply vintage Kodachrome 35mm film aesthetic with warm grain">🎞️ Vintage Film</button>
          <button class="studio-chip" data-edit="Enhance lighting with warm sunset golden hour glow and lens flare">🌅 Golden Hour</button>
          <button class="studio-chip" data-edit="Replace background with a clean modern studio backdrop with soft shadows">📸 Studio Backdrop</button>
          <button class="studio-chip" data-edit="Turn this into a vibrant anime watercolor illustration">⛩️ Anime Illustration</button>
        </div>
      </div>

      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.edit} 3. Modification Instructions</label>
        <div class="data-tool" style="padding:0;">
          <textarea id="editPrompt" rows="3" placeholder="Describe the changes (e.g. Change the shirt color to dark navy, add sunglasses, sharpen details)..."></textarea>
          <button id="editRun" class="btn-primary">${CMD_ICONS.edit} <span>Apply AI Modifications</span></button>
          <div id="editOutput" class="data-output" style="margin-top:10px;"></div>
        </div>
      </div>
    </div>
  `);

  const attachPickers = () => {
    const fileIn = $("editFileInput");
    if(fileIn){
      fileIn.onchange = (e) => {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          selectedDataUrl = ev.target.result;
          selectedName = file.name;
          state.images.unshift({name: file.name, data_url: selectedDataUrl, size: file.size, type: file.type});
          showEditImage(selectedDataUrl);
        };
        reader.readAsDataURL(file);
      };
    }
    const changeBtn = $("editChangeImgBtn");
    if(changeBtn){
      changeBtn.onclick = () => {
        selectedDataUrl = null;
        showEditImage(null);
      };
    }
    drawer.querySelectorAll("[data-img-idx]").forEach(thumb => {
      thumb.onclick = () => {
        const idx = Number(thumb.dataset.imgIdx);
        if(state.images[idx]){
          selectedDataUrl = state.images[idx].data_url;
          selectedName = state.images[idx].name;
          showEditImage(selectedDataUrl);
        }
      };
    });
  };
  attachPickers();

  drawer.querySelectorAll("#editPresetChips .studio-chip").forEach(chip => {
    chip.onclick = () => {
      $("editPrompt").value = chip.dataset.edit;
      $("editPrompt").focus();
    };
  });

  $("editRun").onclick = async () => {
    const prompt = $("editPrompt").value.trim();
    if(!selectedDataUrl) return toast("Select or upload an image first");
    if(!prompt) return toast("Describe what changes to make");

    $("editRun").disabled = true;
    $("editOutput").innerHTML = "<div class='muted'>Analyzing image &amp; applying AI transformation…</div>";

    try {
      const r = await fetch(API_BASE + '/api/generate/edit', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({prompt, images: [{data_url: selectedDataUrl, name: selectedName}]})
      });
      const d = await r.json();
      if(!r.ok || !d.ok) throw new Error(d.error || 'Edit failed.');

      $("editOutput").innerHTML = `
        <div class="compare-grid">
          <div class="compare-card">
            <span class="compare-header">Original</span>
            <img class="compare-img" src="${selectedDataUrl}" alt="Original image">
          </div>
          <div class="compare-card">
            <span class="compare-header" style="color:var(--accent);">Edited (AI)</span>
            <img class="compare-img" src="${d.data_url}" alt="Edited image" id="latestEditImg" style="cursor:zoom-in;">
          </div>
        </div>
        <div class="studio-action-bar">
          <button class="studio-action-btn primary" id="editDownload">⬇ Download Result</button>
          <button class="studio-action-btn" id="editSendChat">💬 Insert to Chat</button>
        </div>
      `;

      $("latestEditImg").onclick = () => openImageLightbox(d.data_url, prompt);
      $("editDownload").onclick = () => downloadFile(d.data_url, `vaani-edit-${Date.now()}.png`);
      $("editSendChat").onclick = () => {
        closeDrawer();
        openChat();
        addMessage('assistant', `### ✨ AI Image Transformation\n\nModifications: *"${prompt}"*\n\n![Edited Image](${d.data_url})`);
        toast("Inserted into chat");
      };

    } catch(e) {
      $("editOutput").innerHTML = `<div class='muted' style="color:#f87171;">${esc(e.message)}</div>`;
    } finally {
      $("editRun").disabled = false;
    }
  };
}

function showCreateVideo(){
  openDrawer("Create Video",`
    <div class="drawer-hero-badge">
      <div class="drawer-hero-icon">${CMD_ICONS.video}</div>
      <div>
        <h4 style="margin:0;font-size:14px;color:#fff;font-weight:600;">Cinematic AI Video Director</h4>
        <small style="color:#9da0a8;font-size:11px;">Generate short cinematic video scenes with camera motion</small>
      </div>
    </div>
    <div class="studio-container">
      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.video} Camera Movement</label>
        <div class="studio-chips" id="videoCamChips">
          <button class="studio-chip active" data-cam="FPV drone diving forward with smooth dynamic banking">🚁 FPV Drone Dive</button>
          <button class="studio-chip" data-cam="Slow cinematic push-in zoom with high focal depth">🔍 Slow Cinematic Zoom</button>
          <button class="studio-chip" data-cam="360-degree orbital rotation around the central subject">🔄 360° Orbit Shot</button>
          <button class="studio-chip" data-cam="Lateral dolly tracking shot from left to right">➡️ Lateral Dolly Right</button>
          <button class="studio-chip" data-cam="Static locked-off macro tripod shot with subtle depth of field">🎥 Static Tripod Macro</button>
        </div>
      </div>

      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.sparkle} Lighting &amp; Atmosphere</label>
        <div class="studio-chips" id="videoAtmoChips">
          <button class="studio-chip" data-atmo="4K 60fps cinematic hyperrealism, sharp details">4K 60fps</button>
          <button class="studio-chip" data-atmo="120fps slow-motion with liquid fluid dynamics">Slow Motion</button>
          <button class="studio-chip" data-atmo="heavy volumetric fog and morning god-rays">Misty Fog &amp; Rays</button>
          <button class="studio-chip" data-atmo="anamorphic cinema lens flare and cinematic letterbox">Anamorphic Flare</button>
          <button class="studio-chip" data-atmo="cyberpunk heavy rainfall with reflective puddles">Neon Rain</button>
        </div>
      </div>

      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.layers} Frame Format</label>
        <div class="aspect-grid" id="videoAspectGrid" style="grid-template-columns:1fr 1fr;">
          <button class="aspect-card active" data-ratio="16:9 widescreen cinematic format">
            <span class="aspect-shape wide"></span>
            <b>16:9 Widescreen</b>
            <small>Film / Desktop</small>
          </button>
          <button class="aspect-card" data-ratio="9:16 vertical mobile format">
            <span class="aspect-shape tall"></span>
            <b>9:16 Vertical</b>
            <small>Reels / Shorts</small>
          </button>
        </div>
      </div>

      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.compass} Director Inspiration Scenes</label>
        <div class="prompt-ideas">
          <button class="prompt-idea-btn" data-vfill="FPV drone sweeping over emerald mountain waterfalls at sunrise, misty golden light, ultra realistic"><span>🎬</span> FPV drone sweeping over emerald mountain waterfalls at sunrise</button>
          <button class="prompt-idea-btn" data-vfill="Futuristic electric supercar accelerating through neon rainy Tokyo highway at night, water spray reflections"><span>🎬</span> Futuristic supercar accelerating through rainy Tokyo at night</button>
          <button class="prompt-idea-btn" data-vfill="An astronaut walking towards a giant ancient glowing alien structure on a red desert planet"><span>🎬</span> Astronaut walking towards ancient glowing alien monument on Mars</button>
        </div>
      </div>

      <div class="studio-section">
        <label class="studio-label">${CMD_ICONS.edit} Scene Description</label>
        <div class="data-tool" style="padding:0;">
          <textarea id="videoPrompt" rows="4" placeholder="Describe the scene, motion, subject, and atmosphere (e.g. A robotic hummingbird hovering over a crystal flower, flapping in slow motion)..."></textarea>
          <button id="videoRun" class="btn-primary">${CMD_ICONS.video} <span>Render Cinematic Video</span></button>
          <div id="videoOutput" class="data-output" style="margin-top:10px;"></div>
        </div>
      </div>
    </div>
  `);

  setupChipGroup("videoCamChips");
  setupChipToggle("videoAtmoChips");
  setupChipGroup("videoAspectGrid");

  drawer.querySelectorAll("[data-vfill]").forEach(btn => {
    btn.onclick = () => {
      $("videoPrompt").value = btn.dataset.vfill;
      $("videoPrompt").focus();
    };
  });

  $("videoRun").onclick = async () => {
    const basePrompt = $("videoPrompt").value.trim();
    if(!basePrompt) return toast("Describe the video scene first");
    const camChip = drawer.querySelector("#videoCamChips .active");
    const aspectChip = drawer.querySelector("#videoAspectGrid .active");
    const atmoChips = Array.from(drawer.querySelectorAll("#videoAtmoChips .active")).map(c => c.dataset.atmo);

    let fullPrompt = basePrompt;
    if(camChip?.dataset.cam) fullPrompt += `, camera movement: ${camChip.dataset.cam}`;
    if(atmoChips.length) fullPrompt += `, atmosphere: ${atmoChips.join(', ')}`;
    if(aspectChip?.dataset.ratio) fullPrompt += `, aspect: ${aspectChip.dataset.ratio}`;

    $("videoRun").disabled = true;
    $("videoOutput").innerHTML = `
      <div class="research-pipeline" style="margin-top:6px;">
        <div class="pipeline-step active">
          <span class="pipeline-dot">●</span>
          <span>Initiating video generation with Gemini Veo… Rendering frames (typically 20-40s).</span>
        </div>
      </div>
    `;

    try {
      const r = await fetch(API_BASE + '/api/generate/video', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({prompt: fullPrompt})
      });
      const d = await r.json();
      if(!r.ok || !d.ok) throw new Error(d.error || 'Video generation is temporarily unavailable.');

      if(d.video_url){
        $("videoOutput").innerHTML = `
          <div style="margin-top:8px;">
            <video controls autoplay loop class="generated-video" src="${esc(d.video_url)}"></video>
            <div class="studio-action-bar">
              <button class="studio-action-btn primary" id="videoDownload">⬇ Download Video</button>
              <button class="studio-action-btn" id="videoSendChat">💬 Insert into Chat</button>
            </div>
          </div>
        `;
        $("videoDownload").onclick = () => downloadFile(d.video_url, `vaani-video-${Date.now()}.mp4`);
        $("videoSendChat").onclick = () => {
          closeDrawer();
          openChat();
          addMessage('assistant', `### 🎬 AI Generated Video\n\nPrompt: *"${basePrompt}"*\n\n<video controls class="generated-video" src="${esc(d.video_url)}"></video>`);
          toast("Video inserted into chat");
        };
      } else {
        $("videoOutput").innerHTML = `
          <div class="data-summary" style="margin-top:8px;">
            <b>Video Render Complete</b>
            <p style="font-size:12px;margin:6px 0;color:#bbb;">${esc(d.note || 'Generation finished.')}</p>
            ${d.video_file ? `<small style="color:var(--accent);">${esc(d.video_file)}</small>` : ''}
          </div>
        `;
      }

    } catch(e) {
      $("videoOutput").innerHTML = `<div class='muted' style="color:#f87171;">${esc(e.message)}</div>`;
    } finally {
      $("videoRun").disabled = false;
    }
  };
}

function showGeneration(kind){
  if(kind==='image') return showCreateImage();
  if(kind==='edit') return showEditImage();
  if(kind==='video') return showCreateVideo();
}

function showTools(){
  openDrawer("Vaani Tools", `
    <div class="tools-intro"><span>EXTEND VAANI</span><p>Live capabilities connected to this workspace.</p></div>
    <div class="tool-grid">
      <button class="tool-card" data-tool="research"><span class="tool-icon tool-cyan">${CMD_ICONS.search}</span><span class="tool-copy"><b>Web Research</b><small>Search current information and inspect sources</small></span><em class="tool-state">● LIVE</em></button>
      <button class="tool-card" data-tool="library"><span class="tool-icon tool-emerald">${CMD_ICONS.book}</span><span class="tool-copy"><b>File Library</b><small>Search &amp; manage permanent document knowledge</small></span><em class="tool-state">● LIVE</em></button>
      <button class="tool-card" data-tool="memory"><span class="tool-icon tool-pink">${CMD_ICONS.layers}</span><span class="tool-copy"><b>Memory</b><small>Save and manage explicit Vaani context</small></span><em class="tool-state">● PERSISTENT</em></button>
      <button class="tool-card" data-tool="data"><span class="tool-icon tool-gold">${CMD_ICONS.table}</span><span class="tool-copy"><b>Data Analysis</b><small>Real CSV/Excel profiling and calculations</small></span><em class="tool-state">● LIVE</em></button>
      <button class="tool-card" data-tool="workspace"><span class="tool-icon tool-violet">${CMD_ICONS.workspace}</span><span class="tool-copy"><b>Workspace</b><small>Keep chats and context under a working space</small></span><em class="tool-state">● LIVE</em></button>
      <button class="tool-card" data-tool="voice"><span class="tool-icon tool-crimson">${CMD_ICONS.mic}</span><span class="tool-copy"><b>Voice</b><small>Continuous microphone input when browser supports it</small></span><em class="tool-state">${window.SpeechRecognition || window.webkitSpeechRecognition ? "● READY" : "UNAVAILABLE"}</em></button>
      <button class="tool-card" data-tool="diagnostics"><span class="tool-icon tool-silver">${CMD_ICONS.pulse}</span><span class="tool-copy"><b>Diagnostics</b><small>Check backend and AI provider visibility</small></span><em class="tool-state">● LIVE</em></button>
    </div>
    <div class="drawer-note tool-foot"><i></i> Vaani keeps each tool explicit: every visible action has a real handler.</div>
  `);
  drawer.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => toolAction(b.dataset.tool));
}

function toolAction(t){
  if(t === "memory") return showMemory();
  if(t === "library") return showLibrary();
  if(t === "workspace") return showWorkspaces();
  if(t === "diagnostics") return showDiagnostics();
  if(t === "research") return showResearch();
  if(t === "data") return showDataAnalysis();
  if(t === "voice") return showVoiceTool();
}

async function showLibrary(){
  openDrawer("File Knowledge Library", `
    <div class="drawer-hero-badge">
      <div class="drawer-hero-icon">${CMD_ICONS.book}</div>
      <div>
        <h4 style="margin:0;font-size:14px;color:#fff;font-weight:600;">File Knowledge Library</h4>
        <small style="color:#9da0a8;font-size:11px;">Permanent semantic index with multi-file Q&amp;A</small>
      </div>
    </div>
    <p class="muted" style="margin-top:0;font-size:12px;line-height:1.5;">Upload documents to Vaani's permanent library. All uploaded content is indexed into searchable knowledge with source citations.</p>
    <div class="library-upload-box">
      <input type="file" id="libFileInput" accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.xls,.py,.js,.html,.css,.json">
      <label for="libFileInput" class="library-upload-btn">＋ Click to upload &amp; index document into permanent library</label>
    </div>
    <div class="research-box">
      <input id="libSearchInput" placeholder="Search indexed library documents…">
      <button id="libSearchGo">Search</button>
    </div>
    <div class="memory-add" style="margin-top:8px;">
      <input id="libAskInput" placeholder="Ask a question about your indexed library files…">
      <button id="libAskGo">Ask Library</button>
    </div>
    <div id="libAskAnswer" style="display:none;margin:10px 0;padding:12px;border-radius:10px;background:rgba(255,255,255,.04);border-left:3px solid var(--accent);font-size:13px;line-height:1.6;"></div>
    <div id="libDocList" class="library-list"><div class="muted">Loading indexed documents…</div></div>
  `);
  
  const refreshDocs = async () => {
    try {
      const r = await fetch(API_BASE + "/api/brain/library");
      const d = await r.json();
      const list = $("libDocList");
      if(!list) return;
      if(!d.documents?.length){
        list.innerHTML = "<div class='muted'>No documents indexed in library yet. Upload a PDF, DOCX, or text file above!</div>";
        return;
      }
      list.innerHTML = d.documents.map(doc => `
        <div class="library-doc-item">
          <div class="library-doc-meta">
            <b>${esc(doc.filename)}</b>
            <small>${(doc.file_type || 'doc').toUpperCase()} · ${formatBytes(doc.file_size)} · ${doc.chunk_count} chunk(s) indexed</small>
          </div>
          <button class="library-doc-del" title="Delete document" onclick="deleteLibraryDoc('${doc.id}')">×</button>
        </div>
      `).join('');
    } catch(e) {
      const list = $("libDocList");
      if(list) list.innerHTML = `<div class='muted'>${esc(e.message)}</div>`;
    }
  };

  refreshDocs();

  $("libFileInput").onchange = async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    toast(`Indexing ${file.name}…`);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch(API_BASE + "/api/brain/library", {method: "POST", body: fd});
      const d = await r.json();
      if(!r.ok || !d.ok) throw new Error(d.error || "Upload failed");
      toast(`Indexed ${file.name} successfully`);
      refreshDocs();
    } catch(err) {
      toast(`Upload error: ${err.message}`, "warning");
    }
  };

  $("libSearchGo").onclick = async () => {
    const q = $("libSearchInput").value.trim();
    if(!q){ refreshDocs(); return; }
    $("libDocList").innerHTML = "<div class='muted'>Searching library…</div>";
    try {
      const r = await fetch(API_BASE + "/api/brain/library/search?q=" + encodeURIComponent(q));
      const d = await r.json();
      if(!r.ok || !d.ok) throw new Error(d.error);
      if(!d.results?.length){
        $("libDocList").innerHTML = "<div class='muted'>No matching document passages found.</div>";
        return;
      }
      $("libDocList").innerHTML = d.results.map(res => `
        <div class="library-doc-item" style="flex-direction:column;align-items:flex-start;gap:6px;">
          <div class="library-doc-meta">
            <b>${esc(res.filename)} — Chunk #${res.chunk_index}</b>
            <p style="font-size:11px;color:#ccc;margin:4px 0 0;line-height:1.4;">${esc(res.content.slice(0, 240))}…</p>
          </div>
        </div>
      `).join('');
    } catch(err) {
      $("libDocList").innerHTML = `<div class='muted'>${esc(err.message)}</div>`;
    }
  };

  $("libAskGo").onclick = async () => {
    const q = $("libAskInput").value.trim();
    if(!q) return toast("Enter a question first");
    const ansBox = $("libAskAnswer");
    ansBox.style.display = "block";
    ansBox.innerHTML = "<span class='muted'>Searching library and formulating answer…</span>";
    try {
      const searchR = await fetch(API_BASE + "/api/brain/library/search?q=" + encodeURIComponent(q));
      const searchD = await searchR.json();
      const passages = (searchD.results || []).map(r => `From ${r.filename}: ${r.content}`).join("\n\n");
      const chatR = await fetch(API_BASE + "/api/chat", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          message: `Answer this question based on the library documents:\nQuestion: ${q}\n\nLibrary Passages:\n${passages || "No explicit match in library."}`,
          history: [],
          mode: "General",
          model: state.models[state.model].id,
          live_context: { files: passages }
        })
      });
      const chatD = await chatR.json();
      ansBox.innerHTML = `<b>Library Answer:</b><div style="margin-top:6px;">${md(chatD.text || "No answer generated.")}</div>`;
    } catch(err) {
      ansBox.innerHTML = `<span style="color:#f87171;">Error: ${esc(err.message)}</span>`;
    }
  };
}

window.deleteLibraryDoc = async function(id){
  try {
    const r = await fetch(API_BASE + `/api/brain/library?id=${encodeURIComponent(id)}`, {method: "DELETE"});
    const d = await r.json();
    if(d.ok){
      toast("Document deleted from library");
      showLibrary();
    }
  } catch(e) {
    toast(`Delete error: ${e.message}`, "warning");
  }
};

async function showMemory(){
  openDrawer("Vaani Memory", `
    <div class="drawer-hero-badge">
      <div class="drawer-hero-icon">${CMD_ICONS.layers}</div>
      <div>
        <h4 style="margin:0;font-size:14px;color:#fff;font-weight:600;">Vaani Memory</h4>
        <small style="color:#9da0a8;font-size:11px;">Persistent facts, instructions &amp; preferences in SQLite</small>
      </div>
    </div>
    <p class="muted" style="margin-top:0;font-size:12px;line-height:1.5;">Manage explicit facts and preferences permanently remembered by Vaani (persisted in SQLite).</p>
    <div class="memory-add">
      <input id="memoryInput" placeholder="e.g. I prefer concise Python code with type hints">
      <button id="memoryAdd">Remember</button>
    </div>
    <div class="research-box" style="margin-top:10px;">
      <input id="memorySearchInput" placeholder="Search saved memories…">
      <button id="memorySearchGo">Search</button>
    </div>
    <div class="memory-list" id="memoryListContainer"><p class='muted'>Loading memories…</p></div>
  `);

  const refreshMems = async (searchQuery = "") => {
    try {
      const url = searchQuery ? `${API_BASE}/api/brain/memory?q=${encodeURIComponent(searchQuery)}` : `${API_BASE}/api/brain/memory`;
      const r = await fetch(url);
      const d = await r.json();
      const mems = d.memories || [];
      const container = $("memoryListContainer");
      if(!container) return;
      if(!mems.length){
        container.innerHTML = `<p class='muted'>${searchQuery ? "No matching memories found." : "Nothing saved yet. Add a fact or preference above!"}</p>`;
        return;
      }
      container.innerHTML = mems.map(m => `
        <div>
          <span>${esc(m.content)} <small style="color:var(--accent);font-size:9.5px;margin-left:6px;">(${esc(m.category || 'general')})</small></span>
          <button onclick="removePersistentMemory(${m.id})" title="Delete memory">×</button>
        </div>
      `).join('');
    } catch(_) {
      $("memoryListContainer").innerHTML = state.memory.length ? state.memory.map((m,i)=>`<div><span>${esc(m)}</span><button onclick="removeMemory(${i})">×</button></div>`).join("") : "<p class='muted'>Nothing saved yet.</p>";
    }
  };

  refreshMems();

  $("memoryAdd").onclick = async () => {
    const v = $("memoryInput").value.trim();
    if(!v) return;
    try {
      await fetch(API_BASE + "/api/brain/memory", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({content: v, category: "preference"})
      });
      state.memory.push(v);
      localStorage.setItem("vaani_memory", JSON.stringify(state.memory));
      toast("Saved to Vaani memory");
      $("memoryInput").value = "";
      refreshMems();
    } catch(_) {
      state.memory.push(v);
      localStorage.setItem("vaani_memory", JSON.stringify(state.memory));
      showMemory();
    }
  };

  $("memorySearchGo").onclick = () => {
    const q = $("memorySearchInput").value.trim();
    refreshMems(q);
  };
  $("memorySearchInput").onkeydown = (e) => {
    if(e.key === "Enter") $("memorySearchGo").click();
  };
}

window.removePersistentMemory = async function(id){
  try {
    await fetch(API_BASE + `/api/brain/memory?id=${id}`, {method: "DELETE"});
    showMemory();
    toast("Memory removed");
  } catch(_) {
    showMemory();
  }
};

window.removeMemory = i => {
  state.memory.splice(i,1);
  localStorage.setItem("vaani_memory", JSON.stringify(state.memory));
  showMemory();
};

function showWorkspaces(){
  const allChats = JSON.parse(localStorage.getItem("vaani_chats") || "[]");
  const wsChats = allChats.filter(c => (c.workspace || "Personal") === state.workspace);

  openDrawer("Workspaces", `
    <div class="drawer-hero-badge">
      <div class="drawer-hero-icon">${CMD_ICONS.workspace}</div>
      <div>
        <h4 style="margin:0;font-size:14px;color:#fff;font-weight:600;">Workspaces</h4>
        <small style="color:#9da0a8;font-size:11px;">Context isolation across projects and domains</small>
      </div>
    </div>
    <p class="muted" style="margin-top:0;font-size:12px;line-height:1.5;">Choose where this chat belongs. The active workspace isolates conversation context and is sent with every request.</p>
    <div class="workspace-list">
      ${state.workspaces.map(w => `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <button class="${state.workspace === w ? "selected" : ""}" data-ws="${esc(w)}" style="flex:1;">
            ${esc(w)} <span>${state.workspace === w ? "✓ Active" : "Select ›"}</span>
          </button>
          ${!["Personal", "Projects", "Job Search"].includes(w) ? `
            <button class="library-doc-del" title="Delete workspace" onclick="deleteWorkspace('${esc(w)}')">×</button>
          ` : ''}
        </div>
      `).join("")}
    </div>

    <div class="memory-add" style="margin-top:12px;">
      <input id="wsInput" placeholder="New workspace…">
      <button id="wsAdd">Add</button>
    </div>

    <div style="margin-top:18px;">
      <h4 style="font-size:12px;color:#eee;margin-bottom:8px;">Chats in ${esc(state.workspace)} (${wsChats.length}):</h4>
      <div class="history-list" style="display:flex;flex-direction:column;gap:6px;">
        ${wsChats.length ? wsChats.slice(0, 10).map(c => `
          <button class="history-item" data-chat-id="${c.id}" style="text-align:left;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.025);cursor:pointer;">
            <b>${esc(c.title || "Conversation")}</b>
            <small style="display:block;color:#888;font-size:10px;margin-top:2px;">${c.model} · ${new Date(c.time).toLocaleDateString()}</small>
          </button>
        `).join('') : '<p class="muted">No conversations in this workspace yet. Start chatting to save conversations here!</p>'}
      </div>
    </div>
  `);

  drawer.querySelectorAll("[data-ws]").forEach(b => {
    b.onclick = () => {
      state.workspace = b.dataset.ws;
      localStorage.setItem("vaani_active_workspace", state.workspace);
      showWorkspaces();
      toast(`Active Workspace: ${state.workspace}`);
    };
  });

  drawer.querySelectorAll("[data-chat-id]").forEach(b => {
    b.onclick = () => {
      const c = allChats.find(x => String(x.id) === b.dataset.chatId);
      if(c){
        newChat();
        openChat();
        c.messages.forEach(m => {
          addMessage(m.role, m.content);
          state.history.push(m);
        });
      }
    };
  });

  $("wsAdd").onclick = () => {
    const v = $("wsInput").value.trim();
    if(v && !state.workspaces.includes(v)){
      state.workspaces.push(v);
      localStorage.setItem("vaani_workspaces", JSON.stringify(state.workspaces));
      state.workspace = v;
      localStorage.setItem("vaani_active_workspace", v);
      showWorkspaces();
      toast(`Created & switched to workspace: ${v}`);
    }
  };
}

window.deleteWorkspace = function(w){
  if(["Personal", "Projects", "Job Search"].includes(w)) return;
  state.workspaces = state.workspaces.filter(x => x !== w);
  localStorage.setItem("vaani_workspaces", JSON.stringify(state.workspaces));
  if(state.workspace === w){
    state.workspace = "Personal";
    localStorage.setItem("vaani_active_workspace", "Personal");
  }
  showWorkspaces();
  toast(`Removed workspace: ${w}`);
};

async function showDataAnalysis(){
  openDrawer("Data Analysis", `
    <div class="drawer-hero-badge">
      <div class="drawer-hero-icon">${CMD_ICONS.table}</div>
      <div>
        <h4 style="margin:0;font-size:14px;color:#fff;font-weight:600;">Data Analysis</h4>
        <small style="color:#9da0a8;font-size:11px;">Automated tabular profiling, stats &amp; pandas computation</small>
      </div>
    </div>
    <div class="data-tool">
      <p class="muted" style="margin:0;font-size:12px;line-height:1.5;">Upload a CSV or Excel spreadsheet to profile distributions, check missing values, and calculate statistical facts.</p>
      <div class="library-upload-box" style="margin-top:10px;margin-bottom:10px;">
        <input id="dataFile" type="file" accept=".csv,.xlsx,.xls,.xlsm">
        <label for="dataFile" class="library-upload-btn" id="dataFileName">＋ Choose CSV / Excel spreadsheet</label>
      </div>
      <div class="memory-add" style="margin-top:10px;">
        <input id="dataQuestion" placeholder="e.g. Which column has the highest value? Summarize key metrics">
        <button id="dataRun">${CMD_ICONS.chart} Analyze</button>
      </div>
      <div id="dataOutput" class="data-output"></div>
    </div>
  `);

  $("dataFile").onchange = (e) => {
    const f = e.target.files[0];
    if(f && $("dataFileName")){
      $("dataFileName").innerHTML = `📄 <b>${esc(f.name)}</b> (${formatBytes(f.size)})`;
    }
  };

  $("dataRun").onclick = async () => {
    const file = $("dataFile").files[0];
    const q = $("dataQuestion").value.trim();
    if(!file) return toast("Choose a CSV or Excel file first");
    $("dataOutput").innerHTML = '<div class="muted">Profiling dataset with Pandas…</div>';
    const fd = new FormData();
    fd.append("file", file);
    fd.append("question", q);
    try {
      const r = await fetch(API_BASE + "/api/data/analyze", {method: "POST", body: fd});
      const d = await r.json();
      if(!r.ok || !d.ok) throw new Error(d.error || "Data analysis failed");
      $("dataOutput").innerHTML = `
        <div class="data-summary">
          <b>${esc(d.name)}</b>
          <span>${d.rows} rows · ${d.columns} columns · ${d.sheets} sheet(s)</span>
          <p style="margin:10px 0;line-height:1.5;">${esc(d.answer || "Analysis complete.")}</p>
          <h5 style="font-size:11px;color:#aaa;margin:10px 0 4px;">Dataset Profile:</h5>
          <pre style="max-height:180px;overflow-y:auto;font-size:11px;">${esc(JSON.stringify(d.profile, null, 2))}</pre>
        </div>
      `;
    } catch(e) {
      $("dataOutput").innerHTML = `<div class="muted" style="color:#f87171;">${esc(e.message)}</div>`;
    }
  };
}

function showVoiceTool(){
  const hasRecognition = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  openDrawer("Voice & Speech Recognition", `
    <div class="drawer-hero-badge">
      <div class="drawer-hero-icon">${CMD_ICONS.mic}</div>
      <div>
        <h4 style="margin:0;font-size:14px;color:#fff;font-weight:600;">Voice Recognition</h4>
        <small style="color:#9da0a8;font-size:11px;">Continuous Web Speech API microphone dictation</small>
      </div>
    </div>
    <div class="data-tool" style="text-align:center;padding:16px 10px;">
      <div style="margin-bottom:14px;">
        <div id="voiceOrbVisual" style="width:64px;height:64px;margin:0 auto 10px;border-radius:50%;background:rgba(255,255,255,0.04);border:1px solid ${state.voice.listening ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.12)'};display:flex;align-items:center;justify-content:center;color:${state.voice.listening ? '#4ade80' : 'var(--accent)'};transition:all .3s ease;box-shadow:${state.voice.listening ? '0 0 24px rgba(74,222,128,0.2)' : 'none'};">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
        </div>
        <div style="margin-top:6px;font-weight:600;font-size:14px;color:${state.voice.listening ? '#4ade80' : '#d4d6dc'};" id="voiceDrawerState">
          ${!hasRecognition ? 'Browser Speech API Not Supported' : state.voice.listening ? '● Listening… Speak now' : 'Ready to listen'}
        </div>
        <small style="color:#888;font-size:11px;display:block;margin-top:4px;">
          ${hasRecognition ? 'Continuous recognition in en-IN / en-US. Supported in Chrome, Edge, and Safari.' : 'Web Speech Recognition is supported in Chrome, Edge, and Safari.'}
        </small>
      </div>

      <div style="display:flex;gap:10px;justify-content:center;margin-bottom:14px;">
        <button id="voiceDrawerToggle" class="mcq-btn submit-btn" ${!hasRecognition ? 'disabled' : ''}>
          ${state.voice.listening ? '⏹ Stop Listening' : '▶ Start Listening'}
        </button>
      </div>

      <div class="research-box" style="flex-direction:column;align-items:stretch;text-align:left;">
        <b style="font-size:11px;color:#aaa;margin-bottom:4px;">Recognized Speech Transcript:</b>
        <textarea id="voiceDrawerTranscript" rows="4" style="width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;padding:8px;font-size:13px;resize:vertical;" placeholder="Spoken words will appear here in real-time…"></textarea>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
        <button id="voiceSendToChat" class="mcq-btn" style="background:var(--accent);color:#111;font-weight:700;">Send to Chat ↵</button>
      </div>
    </div>
  `);

  if(!hasRecognition) return;

  const transcriptBox = $("voiceDrawerTranscript");
  const stateLabel = $("voiceDrawerState");
  const toggleBtn = $("voiceDrawerToggle");
  const orb = $("voiceOrbVisual");

  toggleBtn.onclick = () => {
    if(state.voice.listening){
      state.voice.manualStop = true;
      try { state.voice.recognition.stop(); } catch(_) {}
      toggleBtn.textContent = "▶ Start Listening";
      if(stateLabel){ stateLabel.textContent = "Ready to listen"; stateLabel.style.color = "#d4d6dc"; }
      if(orb){ orb.style.borderColor = "rgba(255,255,255,0.12)"; orb.style.color = "var(--accent)"; orb.style.boxShadow = "none"; }
    } else {
      state.voice.manualStop = false;
      state.voice.targetId = "chatInput";
      const existing = transcriptBox.value.trim();
      state.voice.baseText = existing;
      try {
        state.voice.recognition.start();
        toggleBtn.textContent = "⏹ Stop Listening";
        if(stateLabel){ stateLabel.textContent = "● Listening… Speak now"; stateLabel.style.color = "#4ade80"; }
        if(orb){ orb.style.borderColor = "rgba(74,222,128,0.4)"; orb.style.color = "#4ade80"; orb.style.boxShadow = "0 0 24px rgba(74,222,128,0.2)"; }
      } catch(e) {
        toast(`Microphone error: ${e.message}`, "warning");
      }
    }
  };

  const oldOnResult = state.voice.recognition.onresult;
  state.voice.recognition.onresult = (e) => {
    if(oldOnResult) oldOnResult(e);
    let final = "", interim = "";
    for(let i = 0; i < e.results.length; i++){
      if(e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    const t = (final + (interim ? " " + interim : "")).trim();
    if(transcriptBox) transcriptBox.value = t;
  };

  $("voiceSendToChat").onclick = () => {
    const text = transcriptBox.value.trim();
    if(!text) return toast("No spoken text to send", "warning");
    closeDrawer();
    openChat();
    send(text);
  };
}

async function showDiagnostics(){
  openDrawer("Vaani Diagnostics", `
    <div class="drawer-hero-badge">
      <div class="drawer-hero-icon">${CMD_ICONS.pulse}</div>
      <div>
        <h4 style="margin:0;font-size:14px;color:#fff;font-weight:600;">System Diagnostics</h4>
        <small style="color:#9da0a8;font-size:11px;">Real-time health check of providers, APIs &amp; local DB</small>
      </div>
    </div>
    <p class="muted" style="margin-top:0;font-size:12px;line-height:1.5;">Live status of backend connections, AI providers, SQLite Brain DB, and tools.</p>
    <div class="diag-grid">
      <span>Frontend</span><b>● Online</b>
      <span>Backend Latency</span><b id="diagBack">Pinging…</b>
      <span>Groq AI (Text)</span><b id="diagGroq">Checking…</b>
      <span>Gemini AI (Vision)</span><b id="diagGemini">Checking…</b>
      <span>Brain DB (FTS5)</span><b id="diagBrain">Checking…</b>
      <span>Weather (Open-Meteo)</span><b id="diagWeather">Checking…</b>
      <span>Safe Math Sandbox</span><b id="diagMath">● Active (AST)</b>
      <span>Web Search</span><b id="diagSearch">● Active (DuckDuckGo)</b>
      <span>Voice Recognition</span><b>${window.SpeechRecognition || window.webkitSpeechRecognition ? "● Ready" : "Unavailable"}</b>
      <span>Speech Synthesis</span><b>${window.speechSynthesis ? "● Ready" : "Unavailable"}</b>
    </div>
    <div style="margin-top:14px;display:flex;justify-content:flex-end;">
      <button class="mcq-btn" onclick="showDiagnostics()">↻ Re-run Checks</button>
    </div>
  `);

  const t0 = performance.now();
  try {
    const r = await fetch(API_BASE + "/api/health");
    const lat = Math.round(performance.now() - t0);
    const d = await r.json();
    $("diagBack").textContent = r.ok ? `● Online (${lat}ms)` : "● Offline";
    $("diagGroq").textContent = d.groq_configured ? "● Groq (openai/gpt-oss-20b)" : "Missing GROQ_API_KEY";
    $("diagGemini").textContent = d.gemini_configured ? "● Gemini (gemini-2.5-flash)" : "Missing GEMINI_API_KEY";
  } catch(e) {
    $("diagBack").textContent = "● Offline";
    $("diagGroq").textContent = "Unreachable";
    $("diagGemini").textContent = "Unreachable";
  }

  try {
    const memR = await fetch(API_BASE + "/api/brain/memory");
    const memD = await memR.json();
    const libR = await fetch(API_BASE + "/api/brain/library");
    const libD = await libR.json();
    const memCount = (memD.memories || []).length;
    const docCount = (libD.documents || []).length;
    $("diagBrain").textContent = `● Connected (${memCount} mem, ${docCount} docs)`;
  } catch(_) {
    $("diagBrain").textContent = "● Local Fallback";
  }

  try {
    const wR = await fetch(API_BASE + "/api/weather?city=Delhi");
    const wD = await wR.json();
    $("diagWeather").textContent = wD.ok ? `● Live (${Math.round(wD.temperature)}°C)` : "● Unreachable";
  } catch(_) {
    $("diagWeather").textContent = "● Unreachable";
  }
}

function showResearch(){
  openDrawer("Web Research", `
    <div class="drawer-hero-badge">
      <div class="drawer-hero-icon">${CMD_ICONS.search}</div>
      <div>
        <h4 style="margin:0;font-size:14px;color:#fff;font-weight:600;">Web Research</h4>
        <small style="color:#9da0a8;font-size:11px;">Real-time search with verified source attribution</small>
      </div>
    </div>
    <p class="muted" style="margin-top:0;font-size:12px;line-height:1.5;">Search current web information with verifiable citations and sources.</p>
    <div class="research-box">
      <input id="researchInput" placeholder="What would you like to investigate? (e.g. latest Python 3.13 features)">
      <button id="researchGo">Search</button>
    </div>
    <div id="researchResults" class="research-results">
      <div class="muted">Enter a query above to execute real-time research.</div>
    </div>
  `);
  $("researchGo").onclick = runResearch;
  $("researchInput").onkeydown = e => { if(e.key === "Enter") runResearch(); };
}

async function runResearch(){
  const q = $("researchInput").value.trim();
  if(!q) return;
  const container = $("researchResults");
  container.innerHTML = "<div class='muted'>Gathering verified sources and synthesizing answer…</div>";
  try {
    const r = await fetch(API_BASE + "/api/research?q=" + encodeURIComponent(q));
    const d = await r.json();
    if(!r.ok || !d.ok){
      const fallbackR = await fetch(API_BASE + "/api/search?q=" + encodeURIComponent(q));
      const fallbackD = await fallbackR.json();
      if(!fallbackR.ok || !fallbackD.ok) throw new Error(d.error || fallbackD.error || "Web search provider returned no results.");
      container.innerHTML = `
        <div class="data-summary">
          <b>Sources found for: "${esc(q)}"</b>
          ${(fallbackD.results || []).map((x, i) => `
            <a target="_blank" rel="noopener" href="${esc(x.url || '#')}" style="display:block;margin-top:8px;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:8px;">
              <b>[${i+1}] ${esc(x.title || 'Source')}</b>
              <span style="font-size:11px;color:#bbb;display:block;margin-top:3px;">${esc(x.text || '')}</span>
              <small style="color:var(--accent);font-size:10px;">${esc(x.url || '')}</small>
            </a>
          `).join('')}
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="data-summary">
        <b>${esc(d.query)}</b>
        ${d.summary ? `<div class="research-summary" style="margin:10px 0;padding:12px;background:rgba(255,255,255,.04);border-radius:10px;line-height:1.6;font-size:13px;border-left:3px solid var(--accent);">${inlineMd(d.summary)}</div>` : ''}
        <h4 style="font-size:12px;margin:12px 0 6px;color:#aaa;">Verified Sources (${(d.results || []).length}):</h4>
        ${(d.results || []).map((x, i) => `
          <a target="_blank" rel="noopener" href="${esc(x.url || '#')}" style="display:block;margin-top:6px;padding:8px 10px;border:1px solid rgba(255,255,255,.07);border-radius:8px;background:rgba(255,255,255,.02);">
            <b>[${i+1}] ${esc(x.title || 'Source')}</b>
            <span style="font-size:11px;color:#bbb;display:block;margin-top:3px;line-height:1.4;">${esc(x.text || '')}</span>
            <small style="color:var(--accent);font-size:9.5px;display:block;margin-top:4px;">${esc(x.url || '')}</small>
          </a>
        `).join('')}
      </div>
    `;
  } catch(e) {
    container.innerHTML = `
      <div class="muted" style="color:#f87171;line-height:1.5;">
        <b>Search failed:</b> ${esc(e.message)}<br>
        <small style="color:#999;margin-top:4px;display:block;">Check network connection and backend /api/search connectivity.</small>
      </div>
    `;
  }
}
function showHistory(){const chats=JSON.parse(localStorage.getItem("vaani_chats")||"[]");openDrawer("History",chats.length?chats.map(c=>`<button class="history-item" data-id="${c.id}"><b>${esc(c.title)}</b><small>${c.model} · ${new Date(c.time).toLocaleDateString()}</small></button>`).join(""):"<div class='muted'>Your conversations will appear here.</div>");drawer.querySelectorAll(".history-item").forEach(b=>b.onclick=()=>{const c=chats.find(x=>String(x.id)===b.dataset.id);if(c){newChat();openChat();c.messages.forEach(m=>{addMessage(m.role,m.content);state.history.push(m)})}})}

function showDeveloper(){openDrawer("About Vaani",`<div class="dev-hero"><div class="dev-avatar">JV</div><div><h2>Jitendra Kumar Verma</h2><p>Software Engineer · Computer Science</p><small>Ranchi, Jharkhand · India</small></div></div><p class="dev-copy">Computer Science developer building practical software across AI, backend engineering, databases and cloud technologies.</p><p class="dev-copy">Focused on turning ideas into usable products — from Vaani and DevPilot to TaskFlow, backend systems and AI applications.</p><div class="dev-section"><h4>Education</h4><div class="education-card"><b>B.E. Computer Science &amp; Engineering</b><span>Chandigarh University · 2023–2026</span></div></div><div class="dev-section"><h4>Leadership &amp; Campus Experience</h4><div class="leadership-card"><b>Class Representative — LEET Student</b><span>Chandigarh University · 3rd–6th Semester · 2023–2025</span><p>Took ownership of high-pressure, time-sensitive coordination challenges, aligning students, faculty, schedules and requirements to get critical tasks completed within tight deadlines.</p><small class="leadership-badge">4 Consecutive Semesters</small></div></div><div class="dev-section"><h4>What I Build</h4><div class="project-grid"><article><b>AI &amp; Intelligent Systems</b><span>AI applications · Vaani · AI workflows</span></article><article><b>Backend Engineering</b><span>REST APIs · Databases · Server-side development</span></article><article><b>Data &amp; Analytics</b><span>SQL · Python · Power BI · Data processing</span></article><article><b>Product Development</b><span>DevPilot · TaskFlow · AI builds</span></article></div></div><div class="dev-section"><h4>Technical Skills</h4><div class="skill-list"><span>Python</span><span>Java</span><span>C++</span><span>JavaScript</span><span>SQL</span><span>REST APIs</span><span>MySQL</span><span>PostgreSQL</span><span>Git</span><span>GitHub</span><span>Power BI</span><span>Pandas</span><span>HTML</span><span>CSS</span><span>Basic MERN</span></div></div><div class="dev-section"><h4>Flagship Projects</h4><div class="project-grid"><article><b>DevPilot</b><span>AI Software Engineering Assistant</span><small style="display:flex;gap:8px;margin-top:6px;"><a href="https://dev-pilot-ten.vercel.app" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline;">Live Demo</a><a href="https://github.com/jvjitendra/DevPilot" target="_blank" rel="noopener" style="color:#aaa;text-decoration:underline;">Repository</a></small></article><article><b>TaskFlow</b><span>Task Management Platform</span><small style="display:flex;gap:8px;margin-top:6px;"><a href="https://task-manager-frontend-tau-lemon.vercel.app" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline;">Live Demo</a><a href="https://github.com/jvjitendra/task-manager" target="_blank" rel="noopener" style="color:#aaa;text-decoration:underline;">Repository</a></small></article><article><b>Vaani</b><span>AI Workspace</span><small style="display:flex;gap:8px;margin-top:6px;"><a href="https://vaani-ai-workspace-frontend.vercel.app/" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline;">Live Demo</a><a href="https://github.com/jvjitendra/vaani-ai-workspace" target="_blank" rel="noopener" style="color:#aaa;text-decoration:underline;">Repository</a></small></article><article><b>+ Many More</b><span>Software Experiments &amp; Builds</span><small style="display:flex;gap:8px;margin-top:6px;"><a href="https://github.com/jvjitendra" target="_blank" rel="noopener" style="color:#aaa;text-decoration:underline;">GitHub Profile</a></small></article></div></div><div class="dev-section"><h4>Certifications &amp; Achievements</h4><div class="cert-list"><article><b>Foundation of Cloud IoT &amp; Edge Machine Learning</b><span>IIT Kanpur · NPTEL-SWAYAM</span><small><strong>Elite · 2025</strong> · IoT systems, edge computing &amp; ML fundamentals.</small></article><article><b>Cloud Computing</b><span>IIT Kharagpur · NPTEL-SWAYAM</span><small><strong>Elite · 2024</strong> · Cloud computing models, storage &amp; processing architectures · <strong>23,872+ learners</strong>.</small></article><article><b>Internet of Things: Design Concepts &amp; Use Cases</b><span>NITTTR Chandigarh · SWAYAM</span><small><strong>2024 · 75%</strong> · IoT concepts and real-world use cases.</small></article><article><b>Introduction to Databases</b><span>Meta · Coursera</span><small>Relational database concepts &amp; SQL fundamentals.</small></article><article><b>Programming for Everybody (Python)</b><span>University of Michigan · Coursera</span><small>Python fundamentals, data structures &amp; basic data handling.</small></article></div></div><div class="dev-section"><h4>Currently Exploring</h4><p>AI applications · Backend architecture · Developer tools · Cloud technologies</p></div><div class="dev-section"><h4>Languages</h4><div class="language-grid"><article><b>Hindi</b><span>Native</span></article><article><b>English</b><span>Fluent</span></article><article><b>Punjabi</b><span>Conversational</span></article><article><b>Odia</b><span>Conversational</span></article><article><b>Bengali</b><span>Understands</span></article></div></div><div class="dev-section"><h4>Beyond Code</h4><p>Travel · Exploring new places · Music · Adventure · Cooking · Bikes</p></div><div class="dev-section"><p class="signature-line">JITENDRA VERMA — THE MIND BEHIND VAANI</p></div><div class="socials"><a target="_blank" rel="noopener" href="https://jitendra-kumar-verma-portfolio.vercel.app" class="social-portfolio">🌐 Portfolio</a><a target="_blank" rel="noopener" href="https://github.com/jvjitendra">GitHub</a><a target="_blank" rel="noopener" href="https://www.linkedin.com/in/jvjitendra/">LinkedIn</a><a target="_blank" rel="noopener" href="https://www.instagram.com/jv_jitendra/">Instagram</a></div>`)}
function showCommand(){const pal=$("commandPalette");pal.classList.toggle("open");if(pal.classList.contains("open")){$("commandInput").value="";renderCommands();setTimeout(()=>$("commandInput").focus(),80)}}
function renderCommands(filter=""){const q=filter.trim().toLowerCase();const groups=[
{title:"CREATE",items:[
  ["New conversation","Start a fresh Vaani workspace",CMD_ICONS.plus,"⌘N",newChat],
  ["Morning briefing","Generate daily executive briefing",CMD_ICONS.sun,"↵",()=>triggerPrompt("Good morning Vaani, give me my daily briefing for today")],
  ["Daily focus","Review priorities and key agenda",CMD_ICONS.target,"↵",()=>triggerPrompt("Aaj ka main focus aur priorities kya honi chahiye?")]
]},
{title:"MODES & MODELS",items:[
  ["Cycle mode",`Switch assistant mode (Active: ${state.mode})`,CMD_ICONS.bolt,"⌥M",cycleMode],
  ["Cycle model",`Switch intelligence world (Active: ${state.model})`,CMD_ICONS.globe,"⌥W",cycleModel],
  ["Model Guide","See architecture and strengths of each model",CMD_ICONS.info,"↵",showModelGuide],
  ["Focus mode",state.focus?"Exit distraction-free focus mode":"Enter distraction-free focus mode",CMD_ICONS.sparkle,"↵",toggleFocus]
]},
{title:"WORKSPACE & TOOLS",items:[
  ["Web research","Search real-time web results with citations",CMD_ICONS.search,"↵",showResearch],
  ["File Knowledge Library","Search & manage permanent document knowledge",CMD_ICONS.book,"↵",showLibrary],
  ["Memory","Save and manage explicit persistent context",CMD_ICONS.layers,"↵",showMemory],
  ["Data analysis","Profile and question CSV/Excel datasets",CMD_ICONS.table,"↵",showDataAnalysis],
  ["Workspaces",`Switch working space (Active: ${state.workspace || "Personal"})`,CMD_ICONS.workspace,"↵",showWorkspaces],
  ["Voice input","Activate continuous speech-to-text",CMD_ICONS.mic,"↵",()=>startVoice($("chatShell").classList.contains("open")?"chatInput":"promptInput")],
  ["Diagnostics","Check system health and live API connections",CMD_ICONS.pulse,"↵",showDiagnostics]
]},
{title:"NAVIGATE & ACTIONS",items:[
  ["Open history","View and resume previous conversations",CMD_ICONS.clock,"↵",showHistory],
  ["Open developer","Meet Jitendra Verma — the mind behind Vaani",CMD_ICONS.developer,"↵",showDeveloper],
  ["Export conversation","Download current conversation as Markdown",CMD_ICONS.export,"↵",exportChat],
  ["Create & Attach","Open the unified media and file hub",CMD_ICONS.attach,"↵",()=>openPlusMenu($("chatShell").classList.contains("open")?"chatAttachBtn":"attachBtn")]
]}
];const filtered=groups.map(g=>({...g,items:g.items.filter(x=>!q||`${x[0]} ${x[1]}`.toLowerCase().includes(q))})).filter(g=>g.items.length);let html="";filtered.forEach(g=>{html+=`<div class="command-group"><div class="command-group-title">${g.title}</div>`;g.items.forEach(x=>{html+=`<button class="command-item" data-cmd="${esc(x[0])}"><span class="command-icon">${x[2]}</span><span class="command-copy"><b>${x[0]}</b><small>${x[1]}</small></span><kbd>${x[3]||"↵"}</kbd></button>`});html+=`</div>`});$("commandList").innerHTML=html||`<div class="command-empty"><span class="command-icon">${CMD_ICONS.search}</span><b>No matching command</b><small>Try another search.</small></div>`;$("commandList").querySelectorAll("[data-cmd]").forEach(b=>b.onclick=()=>{const item=groups.flatMap(g=>g.items).find(x=>x[0]===b.dataset.cmd);$("commandPalette").classList.remove("open");item?.[4]()})}
function toggleFocus(){if(state.focus){exitFocus();return}state.focus=true;scene.classList.add("focus-mode");document.body.classList.add("focus-active");const b=$("focusBtn");if(b){b.textContent="Stop Focus";b.setAttribute("aria-label","Stop Focus Mode");b.setAttribute("aria-pressed","true")}closeDrawer();$("modelMenu")?.classList.remove("open");$("commandPalette")?.classList.remove("open");toast("Focus mode on")}
function exitFocus(){state.focus=false;scene.classList.remove("focus-mode");document.body.classList.remove("focus-active");const b=$("focusBtn");if(b){b.textContent="Focus";b.setAttribute("aria-label","Focus Mode");b.setAttribute("aria-pressed","false")}toast("Focus mode off")}
function setupVoice(){const R=window.SpeechRecognition||window.webkitSpeechRecognition;if(!R){["voiceBtn","chatVoiceBtn"].forEach(id=>$(id).classList.add("unavailable"));return}state.voice.recognition=new R();state.voice.recognition.lang="en-IN";state.voice.recognition.continuous=true;state.voice.recognition.interimResults=true;state.voice.recognition.onresult=e=>{let final="",interim="";for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)final+=t;else interim+=t}const input=$(state.voice.targetId);if(!input)return;const base=state.voice.baseText;input.value=(base+(base?" ":"")+final+(interim?" "+interim:""));};state.voice.recognition.onstart=()=>{state.voice.listening=true;document.body.classList.add("listening");["voiceBtn","chatVoiceBtn"].forEach(id=>$(id)?.classList.add("listening"));$("voiceStatus").textContent="Listening… speak naturally";toast("Voice ready — speak now")};state.voice.recognition.onend=()=>{state.voice.listening=false;document.body.classList.remove("listening");["voiceBtn","chatVoiceBtn"].forEach(id=>$(id)?.classList.remove("listening"));if(!state.voice.manualStop&&state.voice.targetId){setTimeout(()=>{if(!state.voice.manualStop&&!state.voice.listening){try{state.voice.recognition.start()}catch{}}},180)}};state.voice.recognition.onerror=e=>{state.voice.listening=false;document.body.classList.remove("listening");["voiceBtn","chatVoiceBtn"].forEach(id=>$(id)?.classList.remove("listening"));$("voiceStatus").textContent="";toast(`Voice: ${e.error}`)}}
function startVoice(target){if(!state.voice.recognition){toast("Voice recognition is not supported in this browser");return}state.voice.targetId=target;const input=$(target);state.voice.baseText=input.value.trim();if(state.voice.listening){state.voice.manualStop=true;state.voice.recognition.stop();return}state.voice.manualStop=false;try{state.voice.recognition.start()}catch{}}
function stopGeneration(){if(state.controller){try{state.controller.abort()}catch(_){}}state.controller=null;scene.classList.remove("generating");setComposerLocked(false);$("stopBtn").disabled=true;setTimeout(()=>$("latencyBadge").textContent="Ready",400)}
function initClock(){const tick=()=>{const d=new Date();$("liveTime").textContent=d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"});$("liveDate").textContent=d.toLocaleDateString([], {weekday:"short",day:"2-digit",month:"short"});};tick();setInterval(tick,1000)}
async function initWeather(){
  const fallback=async()=>{try{const r=await fetch(API_BASE+"/api/weather?city=New%20Delhi");const d=await r.json();if(d.ok)$("liveWeather").textContent=`${Math.round(d.temperature)}° · ${d.summary}`;else $("liveWeather").textContent="Live info"}catch{$("liveWeather").textContent="Live info"}};
  if(!navigator.geolocation){return fallback()}
  navigator.geolocation.getCurrentPosition(async pos=>{
    try{const {latitude,longitude}=pos.coords;const r=await fetch(`${API_BASE}/api/weather?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`);const d=await r.json();if(d.ok){$("liveWeather").textContent=`${Math.round(d.temperature)}° · ${d.summary}`;const label=d.city?`${d.city} · ${Math.round(d.temperature)}° · ${d.summary}`:`${Math.round(d.temperature)}° · ${d.summary}`;$("liveWeather").title=`Weather at your device location: ${label}`}}catch{await fallback()}
  },()=>fallback(),{enableHighAccuracy:false,maximumAge:300000,timeout:5000});
}
function initHeroSentences(){const lines=["Let’s build something.","Let’s figure something out.","Let’s make it happen.","Let’s learn something new.","Let’s solve the hard part.","Let’s turn the idea into reality.","Tell Vaani what’s on your mind."];let i=0;const title=$("heroTitle");setInterval(()=>{i=(i+1)%lines.length;title.classList.remove("sentence-swap");void title.offsetWidth;title.textContent=lines[i];title.classList.add("sentence-swap")},3600)}
function initSignatureDots(){const d=document.querySelector(".live-dots");if(!d)return;let n=0;setInterval(()=>{n=(n+1)%4;d.textContent=".".repeat(n||1)},700)}
function initStars(){const f=$("starField");f.innerHTML="";for(let i=0;i<260;i++){const s=document.createElement("i");s.style.left=Math.random()*100+"%";s.style.top=Math.random()*100+"%";s.style.setProperty("--size",(0.8+Math.random()*2.4)+"px");s.dataset.vx=((Math.random()-.5)*(0.00010+Math.random()*0.00012)).toFixed(7);s.dataset.vy=((Math.random()-.5)*(0.000084+Math.random()*0.00010)).toFixed(7);s.dataset.tw=(Math.random()*6.28).toFixed(2);s.dataset.depth=(0.6+Math.random()*1.6).toFixed(2);s.dataset.life=(Math.random()*10).toFixed(2);f.appendChild(s)}}
function initLivingMotion(){scene.classList.add("parallax-ready","true-motion");const starEls=[...document.querySelectorAll("#starField i")].map(s=>({el:s,x:parseFloat(s.style.left),y:parseFloat(s.style.top),vx:parseFloat(s.dataset.vx),vy:parseFloat(s.dataset.vy),depth:parseFloat(s.dataset.depth),tw:parseFloat(s.dataset.tw),life:parseFloat(s.dataset.life)}));let tx=0,ty=0,mx=0,my=0,last=performance.now(),t=0;window.addEventListener("pointermove",e=>{tx=(e.clientX-innerWidth/2)*.010;ty=(e.clientY-innerHeight/2)*.010});const sysA=document.querySelector(".system-a"),sysB=document.querySelector(".system-b"),sysC=document.querySelector(".system-c"),sysD=document.querySelector(".system-d");const tick=now=>{const dt=Math.min(32,now-last);last=now;t+=dt/1000;const wake=scene.classList.contains("generating")?1.55:1;mx+=(tx-mx)*.045;my+=(ty-my)*.045;scene.style.setProperty("--mx",`${mx}px`);scene.style.setProperty("--my",`${my}px`);starEls.forEach(s=>{const d=s.depth*dt*wake*.0072;s.x+=s.vx*d;s.y+=s.vy*d;s.vx+=Math.sin(t*.31+s.tw)*0.000018*d;s.vy+=Math.cos(t*.27+s.tw)*0.000016*d;if(s.x<-4)s.x=104;if(s.x>104)s.x=-4;if(s.y<-4)s.y=104;if(s.y>104)s.y=-4;s.life+=dt/1000;const tw=Math.min(1.12,.20+.90*(.5+.5*Math.sin(s.life*(2.58+s.depth*1.68)+s.tw)));s.el.style.left=s.x+"%";s.el.style.top=s.y+"%";s.el.style.opacity=tw;s.el.style.transform=`translate3d(${Math.sin(s.life*.33+s.tw)*1.15}px,${Math.cos(s.life*.29+s.tw)*1.15}px,0) scale(${.68+tw*.62})`});if(sysA){const a=t*.032+.35;const x=Math.sin(a)*4.2,y=Math.cos(a)*2.6;sysA.style.transform=`translate3d(calc(${x}vw + var(--mx,0px)*.18),calc(${y}vh + var(--my,0px)*.18),0)`}if(sysB){const b=t*.022+2.1;const x=Math.sin(b)*3.2,y=Math.cos(b)*2.2;sysB.style.transform=`translate3d(calc(${x}vw + var(--mx,0px)*.12),calc(${y}vh + var(--my,0px)*.12),0)`}if(sysC){const c=t*.026+1.2;const x=Math.sin(c)*2.8,y=Math.cos(c)*1.8;sysC.style.transform=`translate3d(calc(${x}vw + var(--mx,0px)*.15),calc(${y}vh + var(--my,0px)*.15),0)`}if(sysD){const d=t*.019+3.4;const x=Math.sin(d)*2.4,y=Math.cos(d)*1.6;sysD.style.transform=`translate3d(calc(${x}vw + var(--mx,0px)*.10),calc(${y}vh + var(--my,0px)*.10),0)`}requestAnimationFrame(tick)};requestAnimationFrame(tick)}
function exportChat(){
  const msgs = Array.from(document.querySelectorAll("#messages .message"));
  if(!msgs || msgs.length === 0){
    toast("No conversation to export yet");
    return;
  }
  let md = `# Vaani AI Workspace — Chat Export\n`;
  md += `**Date:** ${new Date().toLocaleString()}\n`;
  md += `**Workspace:** ${state.workspace || "Personal"} | **Mode:** ${state.mode || "General"} | **Model:** ${state.model || "Saturn"}\n\n---\n\n`;
  msgs.forEach(m => {
    const isUser = m.classList.contains("user");
    const role = isUser ? "### 👤 User" : "### 🌌 Vaani";
    const body = m.querySelector(".message-body")?.innerText || "";
    if(body.trim()){
      md += `${role}\n\n${body.trim()}\n\n---\n\n`;
    }
  });
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Vaani_Chat_${new Date().toISOString().slice(0,10)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Chat exported as Markdown (.md)");
}

function initParallax(){scene.classList.add("parallax-ready")}
function openImageLightbox(src,name="Image preview"){const box=$("imageLightbox"),img=$("imageLightboxImg"),label=$("imageLightboxName");if(!box||!img)return;img.src=src;img.alt=name||"Image preview";label.textContent=name||"Image preview";box.classList.add("open");box.setAttribute("aria-hidden","false")}
function closeImageLightbox(){const box=$("imageLightbox"),img=$("imageLightboxImg");if(!box)return;box.classList.remove("open");box.setAttribute("aria-hidden","true");if(img)img.removeAttribute("src")}
function bind(){state.workspace=localStorage.getItem("vaani_active_workspace")||"Personal";renderModels();renderModes();setModel("Saturn");initClock();initWeather();initStars();initHeroSentences();initParallax();initLivingMotion();initSignatureDots();setupVoice();$("modeBtn").onclick=e=>{e.stopPropagation();const m=$("modeMenu");m.classList.toggle("open");$("modeBtn").setAttribute("aria-expanded",m.classList.contains("open")?"true":"false")};$("modelInfoBtn").onclick=e=>{e.stopPropagation();showModelGuide()};$("modelBtn").onclick=e=>{e.stopPropagation();$("modelMenu").classList.toggle("open");};$("newChatBtn").onclick=newChat;$("brandBtn").onclick=newChat;$("historyBtn").onclick=showHistory;$("toolsBtn").onclick=showTools;$("devBtn").onclick=showDeveloper;$("drawerClose").onclick=closeDrawer;backdrop.onclick=closeDrawer;$("focusBtn").onclick=toggleFocus;if($("exportChatBtn")){$("exportChatBtn").onclick=exportChat;}$("stopBtn").onclick=stopGeneration;$("commandBtn").onclick=showCommand;$("commandClose").onclick=()=>$("commandPalette").classList.remove("open");$("imageLightboxClose").onclick=closeImageLightbox;$("imageLightbox").onclick=e=>{if(e.target.id==="imageLightbox")closeImageLightbox()};  $("messages").addEventListener("click", e => {
    const citation = e.target.closest(".citation-pill");
    if(citation){
      const msgEl = citation.closest(".message");
      if(msgEl){
        const sourcesHeading = Array.from(msgEl.querySelectorAll("h3, strong")).find(el => el.textContent.toLowerCase().includes("source"));
        if(sourcesHeading){
          sourcesHeading.scrollIntoView({ behavior: "smooth", block: "center" });
          sourcesHeading.style.transition = "color 0.3s";
          sourcesHeading.style.color = "#E5C378";
          setTimeout(() => { sourcesHeading.style.color = ""; }, 1500);
        }
      }
      return;
    }

    const img = e.target.closest(".message-attachment-image img,.message-body .md-image");
    if(img){
      openImageLightbox(img.currentSrc || img.src, img.alt || "Image preview");
      return;
    }

    const mcqOpt = e.target.closest(".mcq-opt");
    if(mcqOpt && mcqOpt.parentElement){
      if(mcqOpt.parentElement.querySelector(".mcq-opt.correct") || mcqOpt.parentElement.querySelector(".mcq-opt.incorrect")) return;
      mcqOpt.parentElement.querySelectorAll(".mcq-opt").forEach(o => o.classList.remove("selected"));
      mcqOpt.classList.add("selected");
      return;
    }

    const actBtn = e.target.closest("[data-act]");
    if(!actBtn) return;
    const msgEl = actBtn.closest(".message");
    const bodyEl = msgEl?.querySelector(".message-body");
    const act = actBtn.dataset.act;

    if(act === "speak"){
      if(bodyEl) toggleSpeech(actBtn, bodyEl);
    } else if(act === "copy"){
      const text = bodyEl?.innerText || "";
      navigator.clipboard.writeText(text);
      toast("Copied message to clipboard");
    } else if(act === "improve"){
      const input = $(chatShell.classList.contains("open") ? "chatInput" : "promptInput");
      if(input){
        input.value = "Can you improve and expand upon the previous answer with more depth, precision, and clarity?";
        focusComposer();
      }
    } else if(act === "continue"){
      const input = $(chatShell.classList.contains("open") ? "chatInput" : "promptInput");
      if(input){
        input.value = "Please continue from where you left off.";
        focusComposer();
      }
    } else if(act === "save"){
      const text = bodyEl?.innerText || "";
      if(!text) return;
      try {
        fetch(API_BASE + "/api/brain/memory", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({content: text.slice(0, 300), category: "saved_note"})
        });
        state.memory.push(text.slice(0, 200));
        localStorage.setItem("vaani_memory", JSON.stringify(state.memory));
        toast("Saved note to Vaani Memory");
      } catch(_) {
        toast("Saved to local memory");
      }
    }
  });
  $("commandPalette").onclick=e=>{if(e.target.id==="commandPalette")e.currentTarget.classList.remove("open")};
  $("commandInput").oninput=e=>renderCommands(e.target.value);
  $("commandInput").onkeydown=e=>{
    if(e.key==="ArrowDown"){e.preventDefault();const items=[...document.querySelectorAll("#commandList .command-item")];if(items.length)items[0].focus()}
    if(e.key==="Enter"){e.preventDefault();const focused=document.querySelector("#commandList .command-item:focus");const first=document.querySelector("#commandList .command-item");(focused||first)?.click()}
  };
  $("commandList").onkeydown=e=>{
    const items=[...document.querySelectorAll("#commandList .command-item")];
    const idx=items.indexOf(document.activeElement);
    if(e.key==="ArrowDown"&&idx<items.length-1){e.preventDefault();items[idx+1].focus()}
    else if(e.key==="ArrowUp"){e.preventDefault();if(idx>0)items[idx-1].focus();else $("commandInput").focus()}
  };
  document.addEventListener("pointerdown",e=>{
    const menu=$("modelMenu");if(menu.classList.contains("open")&&!e.target.closest(".model-wrap")){menu.classList.remove("open")}
    const mm=$("modeMenu");if(mm?.classList.contains("open")&&!e.target.closest(".mode-wrap")){mm.classList.remove("open");$("modeBtn").setAttribute("aria-expanded","false")}
    const pal=$("commandPalette");if(pal.classList.contains("open")&&!e.target.closest(".command-card")&&!e.target.closest("#commandBtn")){pal.classList.remove("open")}
    const plus=$("plusMenu");if(plus.classList.contains("open")&&!e.target.closest("#plusMenu")&&!e.target.closest("#attachBtn")&&!e.target.closest("#chatAttachBtn")){closePlus()}
  });
  const livePill=document.querySelector(".live-pill");
  if(livePill){livePill.style.cursor="pointer";livePill.title="Live system status — click to inspect diagnostics";livePill.onclick=()=>showDiagnostics();}
  ["attachBtn","chatAttachBtn"].forEach(id=>$(id).onclick=e=>{e.stopPropagation();openPlusMenu(id)});
  window.addEventListener("resize",()=>positionPlusMenu($(plusAnchorId)));
  window.addEventListener("scroll",()=>positionPlusMenu($(plusAnchorId)),true);
  $("fileInput").onchange=e=>{attach(e.target.files);e.target.value=""};
  $("chatFileInput").onchange=e=>{attach(e.target.files);e.target.value=""};
  ["heroAttachments","chatAttachments"].forEach(id=>$(id)?.closest(".composer")?.addEventListener("dragover",e=>{e.preventDefault();e.currentTarget.classList.add("drag-over")}));
  ["heroAttachments","chatAttachments"].forEach(id=>$(id)?.closest(".composer")?.addEventListener("dragleave",e=>{if(!e.currentTarget.contains(e.relatedTarget))e.currentTarget.classList.remove("drag-over")}));
  ["heroAttachments","chatAttachments"].forEach(id=>$(id)?.closest(".composer")?.addEventListener("drop",e=>{e.preventDefault();e.currentTarget.classList.remove("drag-over");if(e.dataTransfer?.files?.length)attach(e.dataTransfer.files)}));
  ["promptInput","chatInput"].forEach(id=>$(id)?.addEventListener("paste",e=>{const imgs=[...(e.clipboardData?.items||[])].map(x=>x.kind==="file"?x.getAsFile():null).filter(f=>f&&/^image\//.test(f.type));if(imgs.length){e.preventDefault();attach(imgs)}}));
  $("voiceBtn").onclick=()=>startVoice("promptInput");
  $("chatVoiceBtn").onclick=()=>startVoice("chatInput");
  $("sendBtn").onclick=()=>{const v=$("promptInput").value.trim();if(v||state.images.length||state.files.length){$("promptInput").value="";send(v)}};
  $("chatSendBtn").onclick=()=>{const v=$("chatInput").value.trim();if(v||state.images.length||state.files.length){$("chatInput").value="";send(v)}};
  $("promptInput").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();$("sendBtn").click()}};
  $("chatInput").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("chatSendBtn").click()}};
  document.querySelectorAll(".suggestions button").forEach(b=>b.onclick=()=>{$("promptInput").value=b.dataset.prompt;$("promptInput").focus()});
  document.addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();showCommand()}
    if(e.altKey&&e.key.toLowerCase()==="m"){e.preventDefault();cycleMode()}
    if(e.altKey&&e.key.toLowerCase()==="w"){e.preventDefault();cycleModel()}
    if(e.altKey&&e.key.toLowerCase()==="n"){e.preventDefault();newChat()}
    if(e.key==="Escape"){closeImageLightbox();closePlus();$("commandPalette").classList.remove("open");closeDrawer();$("modelMenu").classList.remove("open");$("modeMenu")?.classList.remove("open");$("modeBtn")?.setAttribute("aria-expanded","false")}
  });
}
bind();
setTimeout(focusComposer,250);
setInterval(()=>{
  if(state.controller)return;
  const stillLocked=document.querySelector(".composer.locked")||$("sendBtn")?.disabled||$("chatSendBtn")?.disabled;
  if(stillLocked){setComposerLocked(false);$("stopBtn").disabled=true;scene.classList.remove("generating")}
},3000);
document.addEventListener("keydown",e=>{
  const active=document.activeElement;
  const typingTarget=active&&(active.tagName==="INPUT"||active.tagName==="TEXTAREA"||active.tagName==="SELECT"||active.isContentEditable);
  if(typingTarget||e.ctrlKey||e.metaKey||e.altKey||e.key.length!==1||state.controller)return;
  if(document.querySelector(".drawer.open")||document.querySelector(".command-palette.open")||document.querySelector(".image-lightbox.open")||document.querySelector(".plus-menu.open")) return;
  const input=$(chatShell.classList.contains("open")?"chatInput":"promptInput");
  if(!input||input.disabled)return;
  input.focus();
  const start=input.selectionStart??input.value.length,end=input.selectionEnd??input.value.length;
  input.value=input.value.slice(0,start)+e.key+input.value.slice(end);
  input.selectionStart=input.selectionEnd=start+e.key.length;
  e.preventDefault();
});
