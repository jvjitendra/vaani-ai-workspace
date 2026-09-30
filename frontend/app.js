const IS_LOCAL=["127.0.0.1","localhost"].includes(location.hostname);
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
function toast(m){toastEl.textContent=m;toastEl.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>toastEl.classList.remove("show"),2300)}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function inlineMd(t){
  let s=esc(t);
  s=s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img class="md-image" src="$2" alt="$1">');
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  s=s.replace(/`([^`]+)`/g,'<code>$1</code>');
  s=s.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/__(.*?)__/g,'<strong>$1</strong>');
  s=s.replace(/\*(.*?)\*/g,'<em>$1</em>').replace(/_(.*?)_/g,'<em>$1</em>');
  return s;
}
function normalizeMarkdown(raw){
  return String(raw??'').replace(/\r\n/g,'\n').replace(/^\\(#{1,6}\s)/gm,'$1').replace(/^\\(---+\s*)$/gm,'$1').replace(/^\\(\*\*\*+\s*)$/gm,'$1').replace(/^\\(\-\-\-+\s*)$/gm,'$1');
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
    if(/^```/.test(line.trim())){
      flush();const lang=line.trim().slice(3).trim();const code=[];i++;
      while(i<lines.length&&!/^```/.test(lines[i].trim())){code.push(lines[i]);i++}
      if(i<lines.length)i++;out.push(`<pre><code class="language-${esc(lang)}">${esc(code.join('\n'))}</code></pre>`);continue;
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
function renderModes(){const modes=[['General','Everyday questions and practical help'],['Coding Assistant','Code, APIs, debugging and architecture'],['Interview Prep','Interview questions, answers and practice'],['Explain Simply','Simple explanations with less jargon']];$("modeMenu").innerHTML=modes.map(([n,d])=>`<button class="mode-option" role="menuitem" data-mode="${n}"><b>${n}</b><small>${d}</small></button>`).join("");document.querySelectorAll(".mode-option").forEach(b=>b.onclick=()=>setMode(b.dataset.mode))}
function setMode(mode){state.mode=mode||state.mode;$("modeText").textContent=state.mode;$("chatContext").textContent=`${state.mode} · ${state.model}`;$("modeMenu").classList.remove("open");$("modeBtn").setAttribute("aria-expanded","false");document.querySelectorAll(".mode-option").forEach(x=>x.classList.toggle("selected",x.dataset.mode===state.mode));toast(`Mode: ${state.mode}`)}
function openDrawer(title,html){$("drawerTitle").textContent=title;$("drawerBody").innerHTML=html;drawer.classList.toggle("developer-drawer",title==="About Vaani");drawer.classList.toggle("history-drawer",title==="History");drawer.classList.add("open");backdrop.classList.add("show")}
function closeDrawer(){drawer.classList.remove("open");backdrop.classList.remove("show")}
function pulseWorld(){scene.classList.remove("world-pulse");requestAnimationFrame(()=>scene.classList.add("world-pulse"))}
function newChat(){scene.classList.remove("chat-active");state.history=[];state.chatId=crypto.randomUUID?.()||Date.now();messages.innerHTML="";hero.classList.remove("hidden");chatShell.classList.remove("open");chatShell.setAttribute("aria-hidden","true");closeDrawer()}
function openChat(){scene.classList.add("chat-active");hero.classList.add("hidden");chatShell.classList.add("open");chatShell.setAttribute("aria-hidden","false");setTimeout(()=>$("chatInput").focus(),120)}
function addMessage(role,text="",streaming=false,attachments=[]){const el=document.createElement("article");el.className=`message ${role}`;const media=(role==="user"&&attachments.length)?`<div class="message-attachments">${attachments.map(x=>{const src=x.data_url||x.preview_url||"";return src?`<div class="message-attachment-image"><img src="${src}" alt="${esc(x.name||"Attachment")}" loading="lazy"><span>${esc(x.name||"Attachment")}</span></div>`:`<span>${esc(x.name||"File")}</span>`}).join("")}</div>`:"";el.innerHTML=`<div class="message-head"><span>${role==="user"?"You":"Vaani"}</span><small>${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</small></div><div class="message-body">${streaming?"<span class='cursor'></span>":md(text)}${media}</div>${role==="assistant"?`<div class="message-actions"><button data-act="copy">Copy</button><button data-act="improve">Improve</button><button data-act="save">Save</button><button data-act="continue">Continue from here</button></div>`:""}`;messages.appendChild(el);chatScroll.scrollTop=chatScroll.scrollHeight;return el}
function setAssistant(el,text){el.querySelector(".message-body").innerHTML=md(text);el.querySelectorAll("pre").forEach(pre=>{const b=document.createElement("button");b.className="code-copy";b.textContent="Copy code";b.onclick=()=>navigator.clipboard.writeText(pre.innerText);pre.appendChild(b)})}
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
    streamLoop: while(true){const {done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const lines=buf.split("\n");buf=lines.pop()||"";for(const line of lines){if(!line.startsWith("data:"))continue;const raw=line.slice(5).trim();if(raw==="[DONE]"){try{await reader.cancel()}catch(_){}break streamLoop}let d;try{d=JSON.parse(raw)}catch{continue}if(d.error)throw new Error(d.error);if(d.text){full+=d.text;setAssistant(a,full);chatScroll.scrollTop=chatScroll.scrollHeight}}}
    if(!full.trim())throw new Error("No response returned.");
    stopVisionActivity();pushHistory("assistant",full);state.files=[];state.images=[];renderFileChip();$("latencyBadge").textContent=`${((performance.now()-started)/1000).toFixed(1)}s`;persistChat(messageText,full);
  }catch(e){
    stopVisionActivity();
    if(e.name==="AbortError"){setAssistant(a,`_Response stopped by you._`)}
    else{state.files=attachedFiles;state.images=attachedImages;renderFileChip();setAssistant(a,`**Vaani couldn't complete that request.**\n\n${e.message}`);toast("Request failed — attachment kept for retry.")}
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
  if(incoming.length>10){toast('You can upload a maximum of 10 files at a time.');return;}
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
function showModelGuide(){const entries=Object.entries(state.models);openDrawer("Model Guide",`<div class="model-guide">${entries.map(([n,m])=>`<article class="guide-card ${state.model===n?'active':''}"><div class="guide-head"><b>${n}</b></div><p>${n==='Saturn'?'General chat, everyday tasks and broad reasoning.':n==='Uranus'?'Coding, technical work and complex reasoning.':n==='Neptune'?'Long-context analysis and difficult reasoning tasks.':'General assistance plus vision when the configured vision model is used.'}</p></article>`).join('')}<div class="guide-note">Not sure which to use? Tell Vaani what you are trying to do and it can suggest a model. Capabilities depend on the selected model and available API access.</div></div>`)}
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
  p.innerHTML=`<div class="plus-title"><b>CREATE & ATTACH</b><small>Add context, research or creation tools.</small></div><div class="plus-group">INPUT & UNDERSTAND</div><button class="plus-item" data-plus="files"><span class="plus-icon">⌁</span><span class="plus-copy"><b>Add Photos & Files</b><small>Images, screenshots, PDFs, documents and code</small></span><em>ADD</em></button><button class="plus-item" data-plus="data"><span class="plus-icon">▥</span><span class="plus-copy"><b>Analyze Data</b><small>CSV and Excel analysis</small></span><em>DATA</em></button><button class="plus-item" data-plus="code"><span class="plus-icon">⌘</span><span class="plus-copy"><b>Code & Files</b><small>Review, explain and debug files</small></span><em>CODE</em></button><div class="plus-divider"></div><div class="plus-group">DISCOVER & CREATE</div><button class="plus-item" data-plus="research"><span class="plus-icon">⌕</span><span class="plus-copy"><b>Web Search</b><small>Current information and sources</small></span><em>WEB</em></button><button class="plus-item" data-plus="deep"><span class="plus-icon">◇</span><span class="plus-copy"><b>Deep Research</b><small>Multi-source research workflow</small></span><em>DEEP</em></button><button class="plus-item" data-plus="image"><span class="plus-icon">✧</span><span class="plus-copy"><b>Create Image</b><small>Generate a new image</small></span><em>GEN</em></button><button class="plus-item" data-plus="edit"><span class="plus-icon">✦</span><span class="plus-copy"><b>Edit Image</b><small>Edit an attached image</small></span><em>EDIT</em></button><button class="plus-item" data-plus="video"><span class="plus-icon">▶</span><span class="plus-copy"><b>Create Video</b><small>Generate a short video with audio</small></span><em>VIDEO</em></button><div class="plus-divider"></div><div class="plus-group">WORKSPACE</div><button class="plus-item" data-plus="workspace"><span class="plus-icon">⌂</span><span class="plus-copy"><b>Add to Workspace</b><small>Keep work under the active workspace</small></span><em>SPACE</em></button><button class="plus-item" data-plus="new"><span class="plus-icon">◍</span><span class="plus-copy"><b>New Chat</b><small>Start a clean conversation</small></span><em>NEW</em></button>`;
  p.classList.add('open');p.setAttribute('aria-hidden','false');p.querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>plusAction(b.dataset.plus));requestAnimationFrame(()=>positionPlusMenu($(plusAnchorId)));
}
function closePlus(){const p=$('plusMenu');p.classList.remove('open');p.setAttribute('aria-hidden','true')}
function plusAction(a){closePlus();if(a==='files'||a==='code')return $('fileInput').click();if(a==='data')return showDataAnalysis();if(a==='research')return showResearch();if(a==='deep')return showDeepResearch();if(['image','edit','video'].includes(a))return showGeneration(a);if(a==='workspace')return showWorkspaces();if(a==='new')return newChat()}

function showDeepResearch(){openDrawer("Deep Research",`<div class="research-box"><input id="deepInput" placeholder="What should Vaani investigate?"><button id="deepGo">Research</button></div><div id="deepResults" class="research-results"><div class="muted">Vaani will search multiple result pages and synthesize what it can verify.</div></div>`);$("deepGo").onclick=async()=>{const q=$("deepInput").value.trim();if(!q)return;$("deepResults").innerHTML="<div class='muted'>Gathering sources…</div>";try{const r=await fetch(API_BASE+"/api/research?q="+encodeURIComponent(q));const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Research failed");$("deepResults").innerHTML=`<div class="data-summary"><b>${esc(d.query)}</b><p>${esc(d.summary||"")}</p>${(d.results||[]).map(x=>`<a target="_blank" rel="noopener" href="${esc(x.url||'#')}"><b>${esc(x.title||'Source')}</b><span>${esc(x.text||'')}</span></a>`).join('')}</div>`}catch(e){$("deepResults").innerHTML=`<div class='muted'>${esc(e.message)}</div>`}}}
function showGeneration(kind){
  const title=kind==='image'?'Create Image':kind==='edit'?'Edit Image':'Create Video';
  const note=kind==='image'?'Describe the image you want Vaani to create.':kind==='edit'?'Upload an image first, then describe the edit.':'Describe the short video you want Vaani to create.';
  openDrawer(title,`<div class="data-tool"><p class="muted">${note}</p><textarea id="genPrompt" rows="4" placeholder="Describe the result…"></textarea><button id="genRun">${kind==='image'?'Generate':kind==='edit'?'Edit':'Create Video'}</button><div id="genOutput" class="data-output"></div></div>`);
  $('genRun').onclick=async()=>{
    const prompt=$('genPrompt').value.trim();if(!prompt)return toast('Describe what you want first');
    $('genRun').disabled=true;$('genOutput').innerHTML="<div class='muted'>Working…</div>";
    try{
      const endpoint=kind==='video'?'/api/generate/video':kind==='edit'?'/api/generate/edit':'/api/generate/image';
      const body=kind==='video'?{prompt}:{prompt,images:state.images.slice(0,3)};
      const r=await fetch(API_BASE+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();
      if(!r.ok||!d.ok)throw new Error(d.error||'Generation is temporarily unavailable.');
      if(kind==='video'&&d.video_url){$('genOutput').innerHTML=`<video controls class="generated-video" src="${esc(d.video_url)}"></video>`}
      else if(kind==='video'){$('genOutput').innerHTML=`<div class='muted'>Video generation finished. The provider returned a file reference that can be downloaded from the backend.</div>`}
      else $('genOutput').innerHTML=d.data_url?`<img class="generated-preview" src="${d.data_url}" alt="Generated result">`:`<div class='muted'>Generation completed.</div>`;
    }catch(e){$('genOutput').innerHTML=`<div class='muted'>${esc(e.message)}</div>`}finally{$('genRun').disabled=false}
  };
}

function showTools(){openDrawer("Vaani Tools",`<div class="tools-intro"><span>EXTEND VAANI</span><p>Live capabilities connected to this workspace.</p></div><div class="tool-grid"><button class="tool-card" data-tool="research"><span class="tool-icon tool-cyan">⌕</span><span class="tool-copy"><b>Web Research</b><small>Search current information and inspect sources</small></span><em class="tool-state">LIVE</em></button><button class="tool-card" data-tool="memory"><span class="tool-icon tool-pink">◈</span><span class="tool-copy"><b>Memory</b><small>Save and manage explicit Vaani context</small></span><em class="tool-state">LOCAL</em></button><button class="tool-card" data-tool="data"><span class="tool-icon tool-gold">▥</span><span class="tool-copy"><b>Data Analysis</b><small>Real CSV/Excel profiling and calculations</small></span><em class="tool-state">LIVE</em></button><button class="tool-card" data-tool="workspace"><span class="tool-icon tool-violet">◫</span><span class="tool-copy"><b>Workspace</b><small>Keep chats and context under a working space</small></span><em class="tool-state">LIVE</em></button><button class="tool-card" data-tool="voice"><span class="tool-icon tool-crimson">◉</span><span class="tool-copy"><b>Voice</b><small>Continuous microphone input when browser supports it</small></span><em class="tool-state">${window.SpeechRecognition||window.webkitSpeechRecognition?'READY':'UNAVAILABLE'}</em></button><button class="tool-card" data-tool="diagnostics"><span class="tool-icon tool-silver">◎</span><span class="tool-copy"><b>Diagnostics</b><small>Check backend and AI provider visibility</small></span><em class="tool-state">LIVE</em></button></div><div class="drawer-note tool-foot"><i></i> Vaani keeps each tool explicit: every visible action has a real handler.</div>`);drawer.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>toolAction(b.dataset.tool))}
function toolAction(t){if(t==="memory")return showMemory();if(t==="workspace")return showWorkspaces();if(t==="diagnostics")return showDiagnostics();if(t==="research")return showResearch();if(t==="data")return showDataAnalysis();if(t==="voice")return startVoice("chatInput")}
function showMemory(){openDrawer("Vaani Memory",`<div class="memory-add"><input id="memoryInput" placeholder="e.g. I prefer concise answers"><button id="memoryAdd">Remember</button></div><div class="memory-list">${state.memory.length?state.memory.map((m,i)=>`<div><span>${esc(m)}</span><button onclick="removeMemory(${i})">×</button></div>`).join(""):"<p class='muted'>Nothing saved yet.</p>"}</div>`);$("memoryAdd").onclick=()=>{const v=$("memoryInput").value.trim();if(v){state.memory.push(v);localStorage.setItem("vaani_memory",JSON.stringify(state.memory));showMemory();toast("Saved to Vaani memory")}}}
window.removeMemory=i=>{state.memory.splice(i,1);localStorage.setItem("vaani_memory",JSON.stringify(state.memory));showMemory()}
function showWorkspaces(){openDrawer("Workspaces",`<p class="muted">Choose where this chat belongs. The active workspace is sent with every request.</p><div class="workspace-list">${state.workspaces.map(w=>`<button class="${state.workspace===w?"selected":""}" data-ws="${esc(w)}">${esc(w)}<span>${state.workspace===w?"✓":"›"}</span></button>`).join("")}</div><div class="memory-add"><input id="wsInput" placeholder="New workspace"><button id="wsAdd">Add</button></div>`);drawer.querySelectorAll("[data-ws]").forEach(b=>b.onclick=()=>{state.workspace=b.dataset.ws;localStorage.setItem("vaani_active_workspace",state.workspace);showWorkspaces();toast(`Workspace: ${state.workspace}`)});$("wsAdd").onclick=()=>{const v=$("wsInput").value.trim();if(v&&!state.workspaces.includes(v)){state.workspaces.push(v);localStorage.setItem("vaani_workspaces",JSON.stringify(state.workspaces));state.workspace=v;localStorage.setItem("vaani_active_workspace",v);showWorkspaces()}}}
async function showDataAnalysis(){openDrawer("Data Analysis",`<div class="data-tool"><p class="muted">Upload a CSV or Excel file, then ask a question about the data.</p><input id="dataFile" type="file" accept=".csv,.xlsx,.xls,.xlsm"><div class="memory-add"><input id="dataQuestion" placeholder="e.g. Which column has the most missing values?"><button id="dataRun">Analyze</button></div><div id="dataOutput" class="data-output"></div></div>`);$("dataRun").onclick=async()=>{const file=$("dataFile").files[0];const q=$("dataQuestion").value.trim();if(!file)return toast("Choose a CSV or Excel file first");$("dataOutput").innerHTML='<div class="muted">Analyzing…</div>';const fd=new FormData();fd.append("file",file);fd.append("question",q);try{const r=await fetch(API_BASE+"/api/data/analyze",{method:"POST",body:fd});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Data analysis failed");$("dataOutput").innerHTML=`<div class="data-summary"><b>${esc(d.name)}</b><span>${d.rows} rows · ${d.columns} columns</span><p>${esc(d.answer||"Analysis complete.")}</p><pre>${esc(JSON.stringify(d.profile,null,2))}</pre></div>`}catch(e){$("dataOutput").innerHTML=`<div class="muted">${esc(e.message)}</div>`}}}
async function showDiagnostics(){openDrawer("Vaani Diagnostics",`<div class="diag-grid"><span>Frontend</span><b>● Online</b><span>Backend</span><b id="diagBack">Checking…</b><span>AI Providers</span><b id="diagApi">Checking…</b><span>Selected model</span><b>Groq · GPT-OSS 20B</b><span>Voice</span><b>${window.SpeechRecognition||window.webkitSpeechRecognition?"● Ready":"Unavailable"}</b><span>Provider routing</span><b id="diagModels">Checking…</b></div>`);try{const r=await fetch(API_BASE+"/api/health");const d=await r.json();$("diagBack").textContent=r.ok?"● Online":"● Offline";$("diagApi").textContent=(d.groq_configured&&d.gemini_configured)?"● Groq + Gemini configured":d.groq_configured?"● Groq only":d.gemini_configured?"● Gemini only":"● Missing keys"}catch{$("diagBack").textContent="● Offline";$("diagApi").textContent="—"}try{const r=await fetch(API_BASE+"/api/models");const d=await r.json();$("diagModels").textContent=d.ok?`Text: ${esc(d.provider||"Groq")} · Vision: ${esc(d.vision?.model||"Gemini")}`:`Error: ${d.error||"unavailable"}`}catch{$("diagModels").textContent="Unavailable"}}
function showResearch(){openDrawer("Web Research",`<div class="research-box"><input id="researchInput" placeholder="Search the web…"><button id="researchGo">Search</button></div><div id="researchResults" class="research-results"></div>`);$("researchGo").onclick=runResearch;$("researchInput").onkeydown=e=>{if(e.key==="Enter")runResearch()}}
async function runResearch(){const q=$("researchInput").value.trim();if(!q)return;$("researchResults").innerHTML="<div class='muted'>Searching…</div>";try{const r=await fetch(API_BASE+"/api/search?q="+encodeURIComponent(q));const d=await r.json();if(!d.ok)throw new Error(d.error);$("researchResults").innerHTML=d.results?.length?d.results.map(x=>`<a target="_blank" href="${esc(x.url||"#")}"><b>${esc(x.title||"Result")}</b><span>${esc(x.text||"")}</span></a>`).join(""):"<div class='muted'>No results found.</div>"}catch(e){$("researchResults").innerHTML=`<div class='muted'>${esc(e.message)}</div>`}}
function showHistory(){const chats=JSON.parse(localStorage.getItem("vaani_chats")||"[]");openDrawer("History",chats.length?chats.map(c=>`<button class="history-item" data-id="${c.id}"><b>${esc(c.title)}</b><small>${c.model} · ${new Date(c.time).toLocaleDateString()}</small></button>`).join(""):"<div class='muted'>Your conversations will appear here.</div>");drawer.querySelectorAll(".history-item").forEach(b=>b.onclick=()=>{const c=chats.find(x=>String(x.id)===b.dataset.id);if(c){newChat();openChat();c.messages.forEach(m=>{addMessage(m.role,m.content);state.history.push(m)})}})}
function showDeveloper(){openDrawer("About Vaani",`<div class="dev-hero"><div class="dev-avatar">JV</div><div><h2>Jitendra Kumar Verma</h2><p>Software Engineer · Computer Science</p><small>Ranchi, Jharkhand · India</small></div></div><p class="dev-copy">Computer Science developer building practical software across AI, backend engineering, databases and cloud technologies.</p><p class="dev-copy">Focused on turning ideas into usable products — from Vaani and TaskFlow to backend systems, AI applications and many more projects.</p><div class="dev-section"><h4>Education</h4><div class="education-card"><b>B.E. Computer Science &amp; Engineering</b><span>Chandigarh University · 2023–2026</span></div></div><div class="dev-section"><h4>Leadership &amp; Campus Experience</h4><div class="leadership-card"><b>Class Representative — LEET Student</b><span>Chandigarh University · 3rd–6th Semester · 2023–2025</span><p>Took ownership of high-pressure, time-sensitive coordination challenges, aligning students, faculty, schedules and requirements to get critical tasks completed within tight deadlines.</p><small class="leadership-badge">4 Consecutive Semesters</small></div></div><div class="dev-section"><h4>What I Build</h4><div class="project-grid"><article><b>AI &amp; Intelligent Systems</b><span>AI applications · Vaani · AI workflows</span></article><article><b>Backend Engineering</b><span>REST APIs · Databases · Server-side development</span></article><article><b>Data &amp; Analytics</b><span>SQL · Python · Power BI · Data processing</span></article><article><b>Product Development</b><span>TaskFlow · E-commerce Backend · Experimental builds</span></article></div></div><div class="dev-section"><h4>Technical Skills</h4><div class="skill-list"><span>Python</span><span>Java</span><span>C++</span><span>JavaScript</span><span>SQL</span><span>REST APIs</span><span>MySQL</span><span>PostgreSQL</span><span>Git</span><span>GitHub</span><span>Power BI</span><span>Pandas</span><span>HTML</span><span>CSS</span><span>Basic MERN</span></div></div><div class="dev-section"><h4>Flagship Projects</h4><div class="project-grid"><article><b>Vaani</b><span>AI Workspace</span></article><article><b>TaskFlow</b><span>Team Productivity Platform</span></article><article><b>E-commerce Backend</b><span>Products · Cart · Orders · Razorpay</span></article><article><b>+ Many More</b><span>Experiments &amp; software projects</span></article></div></div><div class="dev-section"><h4>Certifications &amp; Achievements</h4><div class="cert-list"><article><b>Foundation of Cloud IoT &amp; Edge Machine Learning</b><span>IIT Kanpur · NPTEL-SWAYAM</span><small><strong>Elite · 2025</strong> · IoT systems, edge computing &amp; ML fundamentals.</small></article><article><b>Cloud Computing</b><span>IIT Kharagpur · NPTEL-SWAYAM</span><small><strong>Elite · 2024</strong> · Cloud computing models, storage &amp; processing architectures · <strong>23,872+ learners</strong>.</small></article><article><b>Internet of Things: Design Concepts &amp; Use Cases</b><span>NITTTR Chandigarh · SWAYAM</span><small><strong>2024 · 75%</strong> · IoT concepts and real-world use cases.</small></article><article><b>Introduction to Databases</b><span>Meta · Coursera</span><small>Relational database concepts &amp; SQL fundamentals.</small></article><article><b>Programming for Everybody (Python)</b><span>University of Michigan · Coursera</span><small>Python fundamentals, data structures &amp; basic data handling.</small></article></div></div><div class="dev-section"><h4>Currently Exploring</h4><p>AI applications · Backend architecture · Developer tools · Cloud technologies</p></div><div class="dev-section"><h4>Languages</h4><div class="language-grid"><article><b>Hindi</b><span>Native</span></article><article><b>English</b><span>Fluent</span></article><article><b>Punjabi</b><span>Conversational</span></article><article><b>Odia</b><span>Conversational</span></article><article><b>Bengali</b><span>Understands</span></article></div></div><div class="dev-section"><h4>Beyond Code</h4><p>Travel · Exploring new places · Music · Adventure · Cooking · Bikes</p></div><div class="dev-section"><p class="signature-line">JITENDRA VERMA — THE MIND BEHIND VAANI</p></div><div class="socials"><a target="_blank" href="https://github.com/jvjitendra">GitHub</a><a target="_blank" href="https://www.linkedin.com/in/jvjitendra/">LinkedIn</a><a target="_blank" href="https://www.instagram.com/jv_jitendra/">Instagram</a></div>`)}
function showCommand(){const pal=$("commandPalette");pal.classList.toggle("open");if(pal.classList.contains("open")){$("commandInput").value="";renderCommands();setTimeout(()=>$("commandInput").focus(),80)}}
function renderCommands(filter=""){const q=filter.trim().toLowerCase();const groups=[
{title:"CREATE",items:[["New conversation","Start a fresh Vaani workspace","＋","⌘N",newChat]]},
{title:"NAVIGATE",items:[["Open history","Return to a previous conversation","◷","",showHistory],["Open developer","Meet the mind behind Vaani","⌁","",showDeveloper],["Workspaces","Switch between your working spaces","◫","",showWorkspaces]]},
{title:"AI",items:[["Model Guide","See what each model is suited for","ⓘ","",showModelGuide],["Create & Attach","Open the unified Vaani input hub","＋","",()=>openPlusMenu($("chatShell").getAttribute("aria-hidden")==="false"?"chatAttachBtn":"attachBtn")],["Focus mode","Remove distractions from the workspace","✦","",toggleFocus],["Change model","Switch Vaani's intelligence mode","◉","",()=>{$("modelMenu").classList.add("open")}],["Cycle mode","Move through assistant modes","↯","",setMode]]},
{title:"TOOLS",items:[["Web research","Search current web results","⌕","",showResearch],["Memory","Save and manage explicit context","◈","",showMemory],["Data analysis","Profile and question CSV/Excel data","▥","",showDataAnalysis],["Workspace","Switch project context","◫","",showWorkspaces],["Voice","Use microphone input","◉","",()=>startVoice("chatInput")],["Diagnostics","Check Vaani's live connections","◎","",showDiagnostics]]}
];const filtered=groups.map(g=>({...g,items:g.items.filter(x=>!q||`${x[0]} ${x[1]}`.toLowerCase().includes(q))})).filter(g=>g.items.length);let html="";filtered.forEach(g=>{html+=`<div class="command-group"><div class="command-group-title">${g.title}</div>`;g.items.forEach(x=>{html+=`<button class="command-item" data-cmd="${esc(x[0])}"><span class="command-icon">${x[2]}</span><span class="command-copy"><b>${x[0]}</b><small>${x[1]}</small></span><kbd>${x[3]||"↵"}</kbd></button>`});html+=`</div>`});$("commandList").innerHTML=html||`<div class="command-empty"><span>⌕</span><b>No matching command</b><small>Try another search.</small></div>`;$("commandList").querySelectorAll("[data-cmd]").forEach(b=>b.onclick=()=>{const item=groups.flatMap(g=>g.items).find(x=>x[0]===b.dataset.cmd);$("commandPalette").classList.remove("open");item?.[4]()})}
function toggleFocus(){if(state.focus){exitFocus();return}state.focus=true;scene.classList.add("focus-mode");document.body.classList.add("focus-active");const b=$("focusBtn");if(b){b.textContent="Stop Focus";b.setAttribute("aria-label","Stop Focus Mode");b.setAttribute("aria-pressed","true")}closeDrawer();$("modelMenu")?.classList.remove("open");$("commandPalette")?.classList.remove("open");toast("Focus mode on")}
function exitFocus(){state.focus=false;scene.classList.remove("focus-mode");document.body.classList.remove("focus-active");const b=$("focusBtn");if(b){b.textContent="Focus";b.setAttribute("aria-label","Focus Mode");b.setAttribute("aria-pressed","false")}toast("Focus mode off")}
function setupVoice(){const R=window.SpeechRecognition||window.webkitSpeechRecognition;if(!R){["voiceBtn","chatVoiceBtn"].forEach(id=>$(id).classList.add("unavailable"));return}state.voice.recognition=new R();state.voice.recognition.lang="en-IN";state.voice.recognition.continuous=true;state.voice.recognition.interimResults=true;state.voice.recognition.onresult=e=>{let final="",interim="";for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)final+=t;else interim+=t}const input=$(state.voice.targetId);if(!input)return;const base=state.voice.baseText;input.value=(base+(base?" ":"")+final+(interim?" "+interim:""));};state.voice.recognition.onstart=()=>{state.voice.listening=true;document.body.classList.add("listening");["voiceBtn","chatVoiceBtn"].forEach(id=>$(id)?.classList.add("listening"));$("voiceStatus").textContent="Listening… speak naturally";toast("Voice ready — speak now")};state.voice.recognition.onend=()=>{state.voice.listening=false;document.body.classList.remove("listening");["voiceBtn","chatVoiceBtn"].forEach(id=>$(id)?.classList.remove("listening"));if(!state.voice.manualStop&&state.voice.targetId){setTimeout(()=>{if(!state.voice.manualStop&&!state.voice.listening){try{state.voice.recognition.start()}catch{}}},180)}};state.voice.recognition.onerror=e=>{state.voice.listening=false;document.body.classList.remove("listening");["voiceBtn","chatVoiceBtn"].forEach(id=>$(id)?.classList.remove("listening"));$("voiceStatus").textContent="";toast(`Voice: ${e.error}`)}}
function startVoice(target){if(!state.voice.recognition){toast("Voice recognition is not supported in this browser");return}state.voice.targetId=target;const input=$(target);state.voice.baseText=input.value.trim();if(state.voice.listening){state.voice.manualStop=true;state.voice.recognition.stop();return}state.voice.manualStop=false;try{state.voice.recognition.start()}catch{}}
function stopGeneration(){state.controller?.abort()}
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
function initLivingMotion(){scene.classList.add("parallax-ready","true-motion");const starEls=[...document.querySelectorAll("#starField i")].map(s=>({el:s,x:parseFloat(s.style.left),y:parseFloat(s.style.top),vx:parseFloat(s.dataset.vx),vy:parseFloat(s.dataset.vy),depth:parseFloat(s.dataset.depth),tw:parseFloat(s.dataset.tw),life:parseFloat(s.dataset.life)}));let tx=0,ty=0,mx=0,my=0,last=performance.now(),t=0;window.addEventListener("pointermove",e=>{tx=(e.clientX-innerWidth/2)*.010;ty=(e.clientY-innerHeight/2)*.010});const planet=document.querySelector(".planet-a"),planetB=document.querySelector(".planet-b");const tick=now=>{const dt=Math.min(32,now-last);last=now;t+=dt/1000;const wake=scene.classList.contains("generating")?1.55:1;mx+=(tx-mx)*.045;my+=(ty-my)*.045;scene.style.setProperty("--mx",`${mx}px`);scene.style.setProperty("--my",`${my}px`);starEls.forEach(s=>{const d=s.depth*dt*wake*.0072;s.x+=s.vx*d;s.y+=s.vy*d;s.vx+=Math.sin(t*.31+s.tw)*0.000018*d;s.vy+=Math.cos(t*.27+s.tw)*0.000016*d;if(s.x<-4)s.x=104;if(s.x>104)s.x=-4;if(s.y<-4)s.y=104;if(s.y>104)s.y=-4;s.life+=dt/1000;const tw=Math.min(1.12,.20+.90*(.5+.5*Math.sin(s.life*(2.58+s.depth*1.68)+s.tw)));s.el.style.left=s.x+"%";s.el.style.top=s.y+"%";s.el.style.opacity=tw;s.el.style.transform=`translate3d(${Math.sin(s.life*.33+s.tw)*1.15}px,${Math.cos(s.life*.29+s.tw)*1.15}px,0) scale(${.68+tw*.62})`});if(planet){const a=t*.032+.35;const x=Math.sin(a)*4.8;const y=Math.cos(a)*3.0;planet.style.setProperty("--px",`${x}vw`);planet.style.setProperty("--py",`${y}vh`);planet.style.setProperty("--pr",`${a*22}deg`);planet.style.setProperty("--ps",`${1+.018*Math.sin(a*1.7)}`)}if(planetB){const b=t*.021+2.1;planetB.style.setProperty("--bx",`${Math.sin(b)*3.6}vw`);planetB.style.setProperty("--by",`${Math.cos(b)*2.5}vh`);planetB.style.setProperty("--br",`${b*18}deg`);planetB.style.setProperty("--bs",`${1+.014*Math.sin(b*1.3)}`)}requestAnimationFrame(tick)};requestAnimationFrame(tick)}
function initParallax(){scene.classList.add("parallax-ready")}
function openImageLightbox(src,name="Image preview"){const box=$("imageLightbox"),img=$("imageLightboxImg"),label=$("imageLightboxName");if(!box||!img)return;img.src=src;img.alt=name||"Image preview";label.textContent=name||"Image preview";box.classList.add("open");box.setAttribute("aria-hidden","false")}
function closeImageLightbox(){const box=$("imageLightbox"),img=$("imageLightboxImg");if(!box)return;box.classList.remove("open");box.setAttribute("aria-hidden","true");if(img)img.removeAttribute("src")}
function bind(){state.workspace=localStorage.getItem("vaani_active_workspace")||"Personal";renderModels();renderModes();setModel("Saturn");initClock();initWeather();initStars();initHeroSentences();initParallax();initLivingMotion();initSignatureDots();setupVoice();$("modeBtn").onclick=e=>{e.stopPropagation();const m=$("modeMenu");m.classList.toggle("open");$("modeBtn").setAttribute("aria-expanded",m.classList.contains("open")?"true":"false")};$("modelInfoBtn").onclick=e=>{e.stopPropagation();showModelGuide()};$("modelBtn").onclick=e=>{e.stopPropagation();$("modelMenu").classList.toggle("open");};$("newChatBtn").onclick=newChat;$("brandBtn").onclick=newChat;$("historyBtn").onclick=showHistory;$("toolsBtn").onclick=showTools;$("devBtn").onclick=showDeveloper;$("drawerClose").onclick=closeDrawer;backdrop.onclick=closeDrawer;$("focusBtn").onclick=toggleFocus;$("stopBtn").onclick=stopGeneration;$("commandBtn").onclick=showCommand;$("commandClose").onclick=()=>$("commandPalette").classList.remove("open");$("imageLightboxClose").onclick=closeImageLightbox;$("imageLightbox").onclick=e=>{if(e.target.id==="imageLightbox")closeImageLightbox()};$("messages").addEventListener("click",e=>{const img=e.target.closest(".message-attachment-image img,.message-body .md-image");if(!img)return;openImageLightbox(img.currentSrc||img.src,img.alt||"Image preview")});$("commandPalette").onclick=e=>{if(e.target.id==="commandPalette")e.currentTarget.classList.remove("open")};$("commandInput").oninput=e=>renderCommands(e.target.value);$("commandInput").onkeydown=e=>{if(e.key==="ArrowDown"){e.preventDefault();const items=[...document.querySelectorAll("#commandList .command-item")];if(items.length)items[0].focus()}if(e.key==="Enter"){e.preventDefault();document.querySelector("#commandList .command-item:focus")?.click()}};document.addEventListener("pointerdown",e=>{const menu=$("modelMenu");if(menu.classList.contains("open")&&!e.target.closest(".model-wrap")){menu.classList.remove("open")}const mm=$("modeMenu");if(mm?.classList.contains("open")&&!e.target.closest(".mode-wrap")){mm.classList.remove("open");$("modeBtn").setAttribute("aria-expanded","false")}const pal=$("commandPalette");if(pal.classList.contains("open")&&!e.target.closest(".command-card")&&!e.target.closest("#commandBtn")){pal.classList.remove("open")}const plus=$("plusMenu");if(plus.classList.contains("open")&&!e.target.closest("#plusMenu")&&!e.target.closest("#attachBtn")&&!e.target.closest("#chatAttachBtn")){closePlus()}});
 ["attachBtn","chatAttachBtn"].forEach(id=>$(id).onclick=e=>{e.stopPropagation();openPlusMenu(id)});window.addEventListener("resize",()=>positionPlusMenu($(plusAnchorId)));window.addEventListener("scroll",()=>positionPlusMenu($(plusAnchorId)),true);$("fileInput").onchange=e=>{attach(e.target.files);e.target.value=""};$("chatFileInput").onchange=e=>{attach(e.target.files);e.target.value=""};["heroAttachments","chatAttachments"].forEach(id=>$(id)?.closest(".composer")?.addEventListener("dragover",e=>{e.preventDefault();e.currentTarget.classList.add("drag-over")}));["heroAttachments","chatAttachments"].forEach(id=>$(id)?.closest(".composer")?.addEventListener("dragleave",e=>{if(!e.currentTarget.contains(e.relatedTarget))e.currentTarget.classList.remove("drag-over")}));["heroAttachments","chatAttachments"].forEach(id=>$(id)?.closest(".composer")?.addEventListener("drop",e=>{e.preventDefault();e.currentTarget.classList.remove("drag-over");if(e.dataTransfer?.files?.length)attach(e.dataTransfer.files)}));["promptInput","chatInput"].forEach(id=>$(id)?.addEventListener("paste",e=>{const imgs=[...(e.clipboardData?.items||[])].map(x=>x.kind==="file"?x.getAsFile():null).filter(f=>f&&/^image\//.test(f.type));if(imgs.length){e.preventDefault();attach(imgs)}}));$("voiceBtn").onclick=()=>startVoice("promptInput");$("chatVoiceBtn").onclick=()=>startVoice("chatInput");$("sendBtn").onclick=()=>{const v=$("promptInput").value;$("promptInput").value="";send(v)};$("chatSendBtn").onclick=()=>{const v=$("chatInput").value;$("chatInput").value="";send(v)};$("promptInput").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();$("sendBtn").click()}};$("chatInput").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("chatSendBtn").click()}};document.querySelectorAll(".suggestions button").forEach(b=>b.onclick=()=>{$("promptInput").value=b.dataset.prompt;$("promptInput").focus()});document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();showCommand()}if(e.key==="Escape"){closeImageLightbox();closePlus();$("commandPalette").classList.remove("open");closeDrawer();$("modelMenu").classList.remove("open");$("modeMenu")?.classList.remove("open");$("modeBtn")?.setAttribute("aria-expanded","false")}});}
bind();
setTimeout(focusComposer,250);
document.addEventListener("keydown",e=>{
  const active=document.activeElement;
  const typingTarget=active&&(active.tagName==="INPUT"||active.tagName==="TEXTAREA"||active.tagName==="SELECT"||active.isContentEditable);
  if(typingTarget||e.ctrlKey||e.metaKey||e.altKey||e.key.length!==1||state.controller)return;
  const input=$(chatShell.classList.contains("open")?"chatInput":"promptInput");
  if(!input||input.disabled)return;
  input.focus();
  const start=input.selectionStart??input.value.length,end=input.selectionEnd??input.value.length;
  input.value=input.value.slice(0,start)+e.key+input.value.slice(end);
  input.selectionStart=input.selectionEnd=start+e.key.length;
  e.preventDefault();
});
