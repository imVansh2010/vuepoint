javascript:(function(){
/* ------------------------------------------------------------------
   VuePoint - what-if grade editor for StudentVUE.
   Reads the gradebook that is already on screen. Nothing is uploaded,
   nothing is stored, no login, no backend.
   ------------------------------------------------------------------ */

/* toggle: a second run of the bookmark puts the panel away */
if(document.getElementById('vuepoint-root')){
  try{ if(window.__vuepointUnmount) window.__vuepointUnmount(); }catch(e){}
  var stale=document.getElementById('vuepoint-root');
  if(stale&&stale.parentNode) stale.parentNode.removeChild(stale);
  return;
}

/* =============================== helpers =============================== */

function norm(s){
  return String(s===null||s===undefined?'':s)
    .replace(/\u00a0/g,' ')
    .replace(/[\u200b\u200e\u200f]/g,'')
    .replace(/\s+/g,' ')
    .trim();
}
function elText(el){ return el?norm(el.textContent):''; }
function num(s){
  if(s===null||s===undefined) return null;
  var t=norm(s).replace(/[^0-9.\-]/g,'');
  if(!t||t==='-'||t==='.') return null;
  var n=parseFloat(t);
  return isFinite(n)?n:null;
}
function esc(s){
  return String(s===null||s===undefined?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function r1(n){ return isFinite(n)?Math.round(n*10)/10:n; }
function r2(n){ return isFinite(n)?Math.round(n*100)/100:n; }
function pctText(n){ return (n===null||!isFinite(n))?'\u2014':r2(n).toFixed(2)+'%'; }
function ptsText(n){ return (n===null||!isFinite(n))?'\u2014':(Math.round(n*100)/100); }

/* Every cut-off sits on a HALF point, because the grade is rounded to the
   nearest whole percent before it is read as a letter: 92.5 rounds to 93, so it
   is an A - and 89.5 is an A-, down the scale. Sitting on the whole number put
   a 92.5 on the wrong side of the line. */
function letterFor(p){
  if(p===null||!isFinite(p)) return '\u2014';
  if(p>=92.5) return 'A';  if(p>=89.5) return 'A-';
  if(p>=86.5) return 'B+'; if(p>=82.5) return 'B';  if(p>=79.5) return 'B-';
  if(p>=76.5) return 'C+'; if(p>=72.5) return 'C';  if(p>=69.5) return 'C-';
  if(p>=66.5) return 'D+'; if(p>=62.5) return 'D';  if(p>=59.5) return 'D-';
  return 'F';
}
function colorFor(p){
  if(p===null||!isFinite(p)) return '#475569';
  if(p>=89.5) return '#0f766e';
  if(p>=79.5) return '#0d9488';
  if(p>=69.5) return '#b45309';
  if(p>=59.5) return '#c2410c';
  return '#b91c1c';
}
/* "rendered?" check - hidden grading-period panels must be ignored */
function shown(el){
  if(!el) return false;
  try{ return el.getClientRects().length>0; }catch(e){ return false; }
}

/* ============================ score reading ============================ */

var STATUS_RE=/not\s*graded|ungraded|excused|exempt|absent|missing|dropped|incomplete|no\s*score|not\s*counted|n\/a|work\s*in\s*progress|\bwip\b/i;

function parseCell(raw){
  var s=norm(raw);
  if(!s) return null;
  /* "27 / 30", "27/30", "27 of 30", "27 out of 30", also "27 / 30 (90%)" */
  var m;
  /* never mistake a date for a ratio */
  if(/^\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}$/.test(s)) return {kind:'date'};
  if(!/\d/.test(s)&&(STATUS_RE.test(s)||/^[-\u2013\u2014.]+$/.test(s))) return {kind:'status'};
  /* A score is a short, self-contained value. If the text is long enough to be
     a sentence, a "18/20" inside it is prose - not somebody's grade. */
  if(s.length>30) return null;
  m=s.match(/(\d+(?:\.\d+)?)\s*(?:\/|out\s+of|of)\s*(\d+(?:\.\d+)?)/i);
  if(m&&m.index<=14&&(m.index+m[0].length)>=s.length-14){
    var e=parseFloat(m[1]), p=parseFloat(m[2]);
    if(isFinite(e)&&isFinite(p)&&p>0&&p<=100000&&e<=p*2&&e>=-1000){
      return {kind:'ratio',earned:e,possible:p};
    }
  }
  m=s.match(/^(\d{1,3}(?:\.\d+)?)\s*%$/);
  if(m){
    var v=parseFloat(m[1]);
    if(isFinite(v)&&v>=0&&v<=130) return {kind:'percent',percent:v};
  }
  /* "90% (A-)" style */
  m=s.match(/^(\d{1,3}(?:\.\d+)?)\s*%\s*\(?/);
  if(m){
    var v2=parseFloat(m[1]);
    if(isFinite(v2)&&v2>=0&&v2<=130) return {kind:'percent',percent:v2};
  }
  return null;
}
function isRatio(p){ return p&&p.kind==='ratio'; }
function isPercent(p){ return p&&p.kind==='percent'; }
function isValue(p){ return isRatio(p)||isPercent(p); }
function looksRound(n){ return n>0&&(n%5===0||n%10===0||n===100); }

function cleanCat(s){
  var t=norm(s);
  t=t.replace(/\s*\(?\s*\d{1,3}(?:\.\d+)?\s*%\s*\)?\s*$/,'');
  t=t.replace(/\s*\d{1,3}(?:\.\d+)?\s*%\s*$/,'');
  t=t.replace(/^[\s:\-\u2013\u2014*\u2022]+/,'');
  t=t.replace(/[\s:\-\u2013\u2014]+$/,'');
  return t.slice(0,40);
}

/* ========================= document collection ========================= */

var BLOCKED_FRAMES=[];
function collectDocs(){
  var out=[document];
  BLOCKED_FRAMES=[];
  function walk(doc,depth){
    if(depth>3) return;
    var frames;
    try{ frames=doc.querySelectorAll('iframe,frame'); }catch(e){ return; }
    for(var i=0;i<frames.length;i++){
      var cd=null;
      try{ cd=frames[i].contentDocument; }catch(e){ cd=null; }
      if(cd&&cd.body){
        if(out.indexOf(cd)===-1){ out.push(cd); walk(cd,depth+1); }
      }else{
        /* a gradebook in another origin is unreadable from here - say so
           rather than pretending the page is empty */
        var src='';
        try{ src=String(frames[i].getAttribute('src')||frames[i].src||'(no src)'); }catch(e2){ src='(unknown)'; }
        BLOCKED_FRAMES.push(src.slice(0,140));
      }
    }
  }
  walk(document,0);
  return out;
}

/* =========================== grid extraction =========================== */

function directRows(t){
  var out=[], all;
  try{ all=t.querySelectorAll('tr'); }catch(e){ return out; }
  for(var i=0;i<all.length;i++){
    var owner=null;
    try{ owner=all[i].closest('table'); }catch(e){ owner=null; }
    if(owner===t) out.push(all[i]);
  }
  return out;
}
function directCells(tr){
  var out=[], all;
  try{ all=tr.querySelectorAll('th,td'); }catch(e){ return out; }
  for(var i=0;i<all.length;i++){
    var owner=null;
    try{ owner=all[i].closest('tr'); }catch(e){ owner=null; }
    if(owner===tr) out.push(all[i]);
  }
  return out;
}
function nestDepth(el){
  var d=0, p=el;
  while(p){
    p=p.parentElement;
    if(p){
      var tag=(p.tagName||'').toLowerCase();
      if(tag==='table'||tag==='ul'||tag==='ol') d++;
    }
    if(d>6) break;
  }
  return d;
}
function rowData(tr){
  var cells=directCells(tr), texts=[], spans=[], cellEls=[];
  for(var i=0;i<cells.length;i++){
    texts.push(elText(cells[i]));
    spans.push(parseInt(cells[i].getAttribute('colspan')||'1',10)||1);
    cellEls.push(cells[i]);
  }
  return {el:tr,texts:texts,spans:spans,cells:cellEls};
}

function tableGrids(doc){
  var out=[], tables;
  try{ tables=doc.querySelectorAll('table'); }catch(e){ return out; }
  for(var i=0;i<tables.length;i++){
    var t=tables[i];
    if(!shown(t)) continue;
    var trs=directRows(t);
    if(trs.length<2) continue;
    var rows=[];
    for(var j=0;j<trs.length;j++) rows.push(rowData(trs[j]));
    /* a DevExpress data table has no header of its own: borrow the paired one */
    if(findHeader({rows:rows})<0){
      var hrow=dxHeaderRow(t,rows);
      if(hrow){ rows.unshift(hrow); rows.hdrTexts=hrow.texts; }
    }
    out.push({kind:'table',el:t,rows:rows,hdrTexts:rows.hdrTexts||null});
  }
  return out;
}
/* StudentVUE (Edupoint/Synergy) renders its gradebook with DevExpress DataGrid,
   which keeps the column headers in a SEPARATE <table> from the data rows - both
   inside one .dx-datagrid container, headers first. So the header and the rows
   are never in the same table, and any parser that looks for a header row inside
   the data table finds nothing. That is exactly why this page used to "parse"
   the category-weight summary instead of the real assignment list.
   These helpers hand the paired header texts to whatever holds the data rows. */
function dxContainer(el){
  var c=null;
  try{ c=el.closest('.dx-datagrid'); }catch(e){ c=null; }
  if(c) return c;
  /* older/simplified markup: a role=grid wrapper plus a header table */
  try{ if(el.closest&&el.closest('[role="grid"]')) { var p=el.parentElement; while(p&&p!==document.body){ if(p.querySelector('.dx-datagrid-headers')) return p; p=p.parentElement; } } }catch(e2){}
  return null;
}
function dxHeaderTexts(el){
  var ctr=dxContainer(el);
  if(!ctr) return null;
  var hs=[];
  try{ hs=ctr.querySelectorAll('.dx-datagrid-headers [role="columnheader"], .dx-datagrid-headers th'); }catch(e){ hs=[]; }
  if(hs.length<2) return null;
  var out=[];
  for(var i=0;i<hs.length;i++) out.push(elText(hs[i]));
  return out;
}
/* the header row as a synthetic row, padded to the widest data row */
function dxHeaderRow(el,rows){
  var hdr=dxHeaderTexts(el);
  if(!hdr) return null;
  var widest=0;
  for(var i=0;i<rows.length;i++) if(rows[i].texts&&rows[i].texts.length>widest) widest=rows[i].texts.length;
  if(!widest) return null;
  var texts=[], spans=[];
  for(i=0;i<widest;i++){ texts.push(hdr[i]!==undefined?hdr[i]:''); spans.push(1); }
  return {el:null,texts:texts,spans:spans,cells:null};
}
/* header labels for a table: its own <th>/columnheaders, else the paired
   DevExpress header table */
function headerTextsForTable(t){
  var own=[];
  try{
    var hs=t.querySelectorAll('th,[role="columnheader"]');
    for(var i=0;i<hs.length;i++) own.push(elText(hs[i]));
  }catch(e){}
  var nonEmpty=0;
  for(i=0;i<own.length;i++) if(own[i]) nonEmpty++;
  if(nonEmpty>=2) return own;
  var dx=dxHeaderTexts(t);
  return dx||own;
}
/* A grade-calculation summary ("Formative 20%, Summative 80%, TOTAL 100%") is
   full of score-shaped cells but is NOT an assignment list. Without this the
   summary outlives the real grid whenever the real one is harder to read. */
function isSummaryGrid(g){
  var hdr=(g&&(g.hdrTexts||(g.rows&&g.rows.hdrTexts)))||[];
  var hasWeight=false, hasAssignName=false, i, t;
  for(i=0;i<hdr.length;i++){
    t=norm(hdr[i]).toLowerCase();
    if(/^weight\b|\bweight$/.test(t)||t==='weight') hasWeight=true;
    if(/^assignment$|^assignment name$|^title$|^task$|^item$/.test(t)) hasAssignName=true;
  }
  if(hasWeight&&!hasAssignName) return true;
  /* ...or a block that totals itself */
  for(i=0;i<g.rows.length;i++){
    var rt=g.rows[i].texts;
    if(rt&&rt.length&&/^(totals?|overall|class\s*average|final\s*grade|term\s*grade)$/i.test(norm(rt[0]))) return true;
  }
  return false;
}

function roleGrids(doc){
  var out=[], grids;
  try{ grids=doc.querySelectorAll('[role="grid"],[role="table"]'); }catch(e){ return out; }
  for(var i=0;i<grids.length;i++){
    var g=grids[i];
    if(!shown(g)) continue;
    var rEls=[];
    try{ rEls=g.querySelectorAll('[role="row"]'); }catch(e){ continue; }
    var rows=[];
    for(var j=0;j<rEls.length;j++){
      var owner=null;
      try{ owner=rEls[j].closest('[role="grid"],[role="table"]'); }catch(e){ owner=null; }
      if(owner!==g) continue;
      var cells=[], found;
      try{ found=rEls[j].querySelectorAll('[role="gridcell"],[role="cell"],[role="columnheader"],[role="rowheader"]'); }catch(e){ found=[]; }
      var texts=[],spans=[],cellEls=[];
      for(var k=0;k<found.length;k++){
        var co=null;
        try{ co=found[k].closest('[role="row"]'); }catch(e){ co=null; }
        if(co!==rEls[j]) continue;
        texts.push(elText(found[k]));
        spans.push(1);
        cellEls.push(found[k]);
      }
      if(texts.length) rows.push({el:rEls[j],texts:texts,spans:spans,cells:cellEls});
    }
    if(rows.length>=2){
      if(findHeader({rows:rows})<0){
        var hrow=dxHeaderRow(g,rows);
        if(hrow){ rows.unshift(hrow); rows.hdrTexts=hrow.texts; }
      }
      out.push({kind:'role',el:g,rows:rows,hdrTexts:rows.hdrTexts||null});
    }
  }
  return out;
}
/* ---------- generic row discovery: no table markup required ---------- */

function rowAncestorOf(el,doc){
  var node=el, hops=0;
  while(node&&hops<9){
    if(node===doc.documentElement||node===doc.body) return null;
    var tag=node.tagName?node.tagName.toLowerCase():'';
    if(tag==='tr') return node;
    if(tag==='td'||tag==='th'||tag==='tbody'||tag==='thead'||tag==='tfoot'||tag==='table'){
      node=node.parentElement; hops++; continue;
    }
    var n=node.children?node.children.length:0;
    if(n>=2&&n<=16) return node;
    node=node.parentElement; hops++;
  }
  return null;
}
function cellsOfRow(row){
  var out=[], i, all;
  var tag=row.tagName?row.tagName.toLowerCase():'';
  if(tag==='tr'){
    try{ all=row.querySelectorAll('th,td'); }catch(e){ return out; }
    for(i=0;i<all.length;i++){
      var owner=null;
      try{ owner=all[i].closest('tr'); }catch(e){ owner=null; }
      if(owner===row) out.push(all[i]);
    }
    return out;
  }
  var kids=row.children;
  if(!kids) return out;
  for(i=0;i<kids.length;i++) out.push(kids[i]);
  return out;
}
function modeOf(list){
  var counts={}, bestV=null, bestN=0;
  for(var i=0;i<list.length;i++){
    var k=String(list[i]);
    counts[k]=(counts[k]||0)+1;
    if(counts[k]>bestN){ bestN=counts[k]; bestV=list[i]; }
  }
  return bestV;
}
function firstRowTexts(el){
  var trs=[], i;
  try{
    if(el.matches&&el.matches('tr')) trs=[el];
    else trs=Array.prototype.slice.call(el.querySelectorAll('tr'));
  }catch(e){ trs=[]; }
  if(trs.length){
    var cs=cellsOfRow(trs[0]), out1=[];
    for(i=0;i<cs.length;i++) out1.push(elText(cs[i]));
    return out1;
  }
  if(el.children&&el.children.length>=2&&el.children.length<=16){
    var out2=[];
    for(i=0;i<el.children.length;i++) out2.push(elText(el.children[i]));
    return out2;
  }
  return null;
}
function looksHeaderish(texts){
  var hits=0, scores=0, i;
  for(i=0;i<texts.length;i++){
    var t=texts[i];
    if(!t) continue;
    if(isValue(parseCell(t))) scores++;
    if(HDR_WORD_RE.test(t)) hits++;
  }
  return hits>=2&&scores===0;
}
/* headers often live in a <thead> that is a sibling of the row container,
   so look outward from the rows, not just inside them */
function headerTextsFor(parent){
  var cands=[], w=parent;
  for(var up=0;up<3&&w;up++){
    if(w.previousElementSibling) cands.push(w.previousElementSibling);
    if(w.parentElement) cands.push(w.parentElement);
    w=w.parentElement;
  }
  for(var i=0;i<cands.length;i++){
    var t=firstRowTexts(cands[i]);
    if(t&&t.length>=2&&looksHeaderish(t)) return t;
  }
  return null;
}
/* Score cells anywhere on the page, grouped by the row container they share.
   This finds an assignment list even when the markup is nothing like a table. */
function rowGroupCandidates(doc){
  var out=[], all;
  try{ all=doc.querySelectorAll('*'); }catch(e){ return out; }
  var leaves=[];
  for(var i=0;i<all.length;i++){
    var el=all[i];
    if(el.children&&el.children.length) continue;
    if(!isValue(parseCell(el.textContent))) continue;
    leaves.push(el);
  }
  if(leaves.length<2) return out;
  var parents=[], groups=[];
  for(var c=0;c<leaves.length;c++){
    var row=rowAncestorOf(leaves[c],doc);
    if(!row||!row.parentElement) continue;
    var par=row.parentElement;
    var idx=parents.indexOf(par);
    if(idx<0){ parents.push(par); groups.push({parent:par,rows:[]}); idx=groups.length-1; }
    if(groups[idx].rows.indexOf(row)<0) groups[idx].rows.push(row);
  }
  for(var g=0;g<groups.length;g++){
    var grp=groups[g];
    if(grp.rows.length<2) continue;
    /* a hidden grading period (or the hidden chart/grid toggle) must not be
       harvested - this path used to ignore visibility and is how a hidden
       category-weight table got read as the assignment list */
    if(!shown(grp.parent)) continue;
    var kids=grp.parent.children;
    if(!kids||!kids.length) continue;
    var widths=[], s;
    for(s=0;s<kids.length;s++){
      var ws=cellsOfRow(kids[s]);
      if(ws.length) widths.push(ws.length);
    }
    var modeCols=modeOf(widths);
    var rows=[];
    var hdr=headerTextsFor(grp.parent);
    if(hdr&&hdr.length>=2){
      var hs=[];
      for(var h=0;h<hdr.length;h++) hs.push(1);
      rows.push({el:null,texts:hdr,spans:hs,cells:null});
    }
    /* keep every sibling row so ungraded assignments keep their place in the
       list, not only the ones that already have a score */
    for(s=0;s<kids.length;s++){
      var cs2=cellsOfRow(kids[s]);
      if(!cs2.length) continue;
      if(modeCols&&Math.abs(cs2.length-modeCols)>1) continue;
      var texts=[], spans=[];
      for(var k=0;k<cs2.length;k++){
        texts.push(elText(cs2[k]));
        spans.push(parseInt(cs2[k].getAttribute('colspan')||'1',10)||1);
      }
      rows.push({el:kids[s],texts:texts,spans:spans,cells:cs2});
    }
    if(rows.length>=3){
      if(!hdr){
        var hrow2=dxHeaderRow(grp.parent,rows);
        if(hrow2){ rows.unshift(hrow2); rows.hdrTexts=hrow2.texts; }
      }
      out.push({kind:'rows',el:grp.parent,rows:rows,hdrTexts:rows.hdrTexts||null});
    }
  }
  return out;
}

/* how much does a candidate look like an assignment table? */
/* a short cell that is just a number, and not a date pretending to be one */
function isPlainNum(t){
  if(!t||t.length>8) return false;
  if(/\d[\/.-]\d/.test(t)) return false;
  var v=num(t);
  return v!==null&&v>=0;
}
/* some gradebooks put earned and possible straight into two columns as plain
   numbers, so a row of "8 | 10" has to count as a graded row too */
function hasNumberPair(texts){
  var vals=[], i;
  for(i=0;i<texts.length;i++){ if(isPlainNum(texts[i])) vals.push(num(texts[i])); }
  for(i=0;i<vals.length-1;i++){
    if(vals[i+1]>0&&vals[i]<=vals[i+1]*2) return true;
  }
  return false;
}

function scoreGrid(g){
  var rows=g.rows, scoreRows=0, ratioRows=0, pctOnly=0, textRows=0, withCells=0, maxCols=0, i, j;
  if(!rows||!rows.length) return -1;
  for(i=0;i<rows.length;i++){
    var r=rows[i];
    if(!r.texts.length) continue;
    withCells++;
    if(r.texts.length>maxCols) maxCols=r.texts.length;
    var hasScore=false, hasRatio=false, hasText=false;
    for(j=0;j<r.texts.length;j++){
      var t=r.texts[j];
      if(!t) continue;
      var p=parseCell(t);
      if(isRatio(p)){ hasScore=true; hasRatio=true; }
      else if(isPercent(p)) hasScore=true;
      else if(/[A-Za-z]{2,}/.test(t)&&t.length>2) hasText=true;
    }
    if(!hasScore&&hasNumberPair(r.texts)) hasScore=true;
    if(hasScore) scoreRows++;
    if(hasRatio) ratioRows++;
    if(hasScore&&!hasRatio) pctOnly++;
    if(hasText) textRows++;
  }
  /* A term with mostly ungraded assignments is normal, not an edge case: two
     graded rows out of twenty still has to count. Breadth of scored rows
     separates a real gradebook from a nav table, so count them absolutely.
     And a grading-summary table is percent-only, so reward genuine
     earned/possible rows and dock blocks that are nothing but percentages. */
  /* A real assignment table is identified by its HEADER, not by how many scores
     happen to be filled in yet. Synergy arrives here with a proper column map
     (Assignment / Score / Points), so accept it even when only one row has been
     graded - otherwise a class two weeks into the term reads as "nothing". */
  var hasMap=false;
  try{
    var hi=findHeader(g);
    if(hi>=0){
      var hr=colRoles(g.rows[hi].texts), hasName=false, hasScore=false;
      for(var qi=0;qi<hr.length;qi++){
        if(hr[qi]==='name') hasName=true;
        if(hr[qi]==='score'||hr[qi]==='possible') hasScore=true;
      }
      hasMap=hasName&&hasScore;
    }
  }catch(e){}
  if(withCells<3) return -1;
  if(!hasMap&&scoreRows<2) return -1;
  if(textRows<2) return -1;
  if(!hasMap&&scoreRows/withCells<0.1) return -1;
  /* The container's own id/class is the strongest single signal on real pages:
     Synergy names the real list #AssignmentsGrid and the summary
     #CategoryWeightsGrid. Trust the page's own naming over any heuristic. */
  var bonus=0;
  try{
    var anc=g.el, hops=0;
    while(anc&&hops<8){
      var idc=String((anc.id||'')+' '+(anc.className||''));
      if(/weight|grade.?summary|calculationsummary/i.test(idc)){ bonus-=14; break; }
      if(/assignment|gradebook|assignmentsgrid/i.test(idc)){ bonus+=14; break; }
      anc=anc.parentElement; hops++;
    }
  }catch(e){}
  return Math.min(scoreRows,40)*2.5 + Math.min(ratioRows,40)*3 + Math.min(maxCols,8)*1.5
       + Math.min(withCells,40)*0.2 - nestDepth(g.el)*3 - Math.min(pctOnly,20)*0.5 + bonus;
}

/* ========================= header + column map ========================= */

var HDR_WORD_RE=/(assign|task|title|name|description|item|categor|type|measure|score|earned|received|points|possible|out\s*of|due|date|percent|%|grade|mark)/i;

function findHeader(g){
  var best=-1, bestScore=1.2;
  for(var i=0;i<g.rows.length;i++){
    var r=g.rows[i];
    if(r.texts.length<2) continue;
    var sc=0, anyScore=false, hits=0, hasRealValue=false;
    for(var j=0;j<r.texts.length;j++){
      var t=r.texts[j];
      if(!t) continue;
      if(isValue(parseCell(t))) anyScore=true;
      if(HDR_WORD_RE.test(t)){ sc+=2; hits++; }
      if(t.length<=26) sc+=0.4;
    }
    /* A row that carries an actual score is a DATA row, never a header. Without
       this the first assignment row ("... Assignment | Score | Raw Score |
       10 out of 10") scored as a header: it matched on "Score" and "out of".
       The parser then treated it as the header, started one row down, and lost
       the first assignment - and used the data row's own values as the column
       map, which is how a real name and category column went missing. */
    for(var hv=0;hv<r.texts.length&&!hasRealValue;hv++){
      var tv=r.texts[hv];
      if(!tv) continue;
      var pv=parseCell(tv);
      if(isRatio(pv)||isPercent(pv)||isPlainNum(tv)) hasRealValue=true;
    }
    if(hasRealValue) continue;
    if(hits<2) continue;
    if(anyScore) sc-=5;
    if(sc>bestScore){ bestScore=sc; best=i; }
  }
  return best;
}

function colRoles(hdr){
  var roles=[];
  for(var i=0;i<hdr.length;i++){
    var t=norm(hdr[i]).toLowerCase(), r=null;
    if(!t){ roles.push(null); continue; }
    if(/possible|out\s*of|points\s*possible|max\b|denominator/.test(t)) r='possible';
    else if(/categor|grading\s*type|\btype\b|measure/.test(t)) r='cat';
    else if(/earned|received|score|points|mark|result|grade|percent|%/.test(t)) r='score';
    else if(/due|date|assigned|posted/.test(t)) r='date';
    else if(/assign|task|title|name|description|item/.test(t)) r='name';
    roles.push(r);
  }
  return roles;
}

/* ========================= assignment extraction ========================= */

function parseAssignments(g, headerIdx, roles){
  var list=[], seen={}, current='';
  var nameIdx=-1, catIdx=-1, scoreIdx=-1, possIdx=-1, scores=[], dateIdx={};
  for(var i=0;i<roles.length;i++){
    if(roles[i]==='name'&&nameIdx<0) nameIdx=i;
    else if(roles[i]==='cat'&&catIdx<0) catIdx=i;
    else if(roles[i]==='score') scores.push(i);
    else if(roles[i]==='possible'&&possIdx<0) possIdx=i;
    else if(roles[i]==='date') dateIdx[i]=1;
  }
  if(scores.length===1) scoreIdx=scores[0];
  else if(scores.length>1){ scoreIdx=scores[0]; if(possIdx<0) possIdx=scores[1]; }

  var start=headerIdx>=0?headerIdx+1:0;
  for(var r=start;r<g.rows.length;r++){
    var row=g.rows[r], texts=row.texts, nonEmpty=[];
    for(var z=0;z<texts.length;z++){ if(texts[z]) nonEmpty.push(z); }
    if(!nonEmpty.length) continue;

    /* group heading such as "Homework" on its own row */
    if(nonEmpty.length===1){
      var only=texts[nonEmpty[0]];
      var pc=parseCell(only);
      var groupish=(row.spans[nonEmpty[0]]>1||texts.length>=3||g.rows.length<=3);
      if(!isValue(pc)&&groupish&&/[A-Za-z]/.test(only)&&only.length<=48&&
         !/^(total|overall|summary|average|grade\b|mark\b|semester|term|quarter|reporting|comment)/i.test(only)){
        current=cleanCat(only);
      }
      continue;
    }

    /* ---- name ---- */
    var name='';
    if(nameIdx>=0&&nameIdx<texts.length) name=texts[nameIdx];
    if(!name){
      var bestI=-1, bestLen=-1;
      for(var c=0;c<texts.length;c++){
        var t=texts[c];
        if(!t||dateIdx[c]||c===catIdx) continue;
        if(isValue(parseCell(t))) continue;
        var letters=(t.match(/[A-Za-z]/g)||[]).length;
        if(letters>=3&&t.length>bestLen){ bestLen=t.length; bestI=c; }
      }
      if(bestI>=0) name=texts[bestI];
    }
    name=norm(name).replace(/\s*\(\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*\)\s*$/,'');
    if(!name) continue;
    if(/^(total|overall|summary|average|class\s*average|assignment|grade)/i.test(name)) continue;
    name=name.slice(0,90);

    /* ---- category ---- */
    var cat='';
    if(catIdx>=0&&catIdx<texts.length) cat=cleanCat(texts[catIdx]);
    if(!cat) cat=current;
    if(!cat) cat='Uncategorized';

    /* ---- score ---- */
    var earned=null, possible=null;
    if(scoreIdx>=0&&scoreIdx<texts.length){
      var ps=parseCell(texts[scoreIdx]);
      if(isRatio(ps)){ earned=ps.earned; possible=ps.possible; }
      else if(isPercent(ps)){
        /* a percent only becomes points when we know what it is a percent of */
        var basePv=(possIdx>=0&&possIdx<texts.length)?num(texts[possIdx]):null;
        if(basePv!==null&&basePv>0){ possible=basePv; earned=ps.percent/100*basePv; }
        else { earned=ps.percent; possible=100; }
      }
    }
    if(earned===null&&scoreIdx>=0&&possIdx>=0){
      /* Synergy's "Points" column reads "10.00/10.0000" (earned/possible), so a
         plain digit scrape would mangle it into 10.0010. Take the ratio's own
         possible when that is what the cell is. */
      var possCell=parseCell(texts[possIdx]);
      var pv=isRatio(possCell)?possCell.possible:num(texts[possIdx]);
      if(pv!==null&&pv>0){
        possible=pv;
        var sv=num(texts[scoreIdx]);
        if(sv!==null) earned=sv;
        else{
          var ps2=parseCell(texts[scoreIdx]);
          if(isPercent(ps2)) earned=ps2.percent/100*pv;
          else if(isRatio(ps2)){ earned=ps2.earned; possible=ps2.possible; }
        }
      }
    }
    if(earned===null&&possIdx>=0&&possIdx<texts.length&&scoreIdx<0){
      var pv2=num(texts[possIdx]);
      if(pv2!==null&&pv2>0) possible=pv2;
    }
    if(earned===null){
      /* scan the remaining cells for anything that reads like a score */
      var cands=[];
      for(var c2=0;c2<texts.length;c2++){
        if(c2===catIdx||c2===nameIdx||dateIdx[c2]) continue;
        var p3=parseCell(texts[c2]);
        if(isValue(p3)) cands.push(p3);
      }
      if(cands.length&&possible===null){
        var pick=cands[cands.length-1];
        for(var q=0;q<cands.length;q++){
          if(isRatio(cands[q])&&looksRound(cands[q].possible)){ pick=cands[q]; break; }
        }
        if(isRatio(pick)){ earned=pick.earned; possible=pick.possible; }
        else { earned=pick.percent; possible=100; }
      }
    }

    if(earned===null){
      /* last resort: two plain numbers side by side (Earned, Points Possible) */
      var plain=[];
      for(var np=0;np<texts.length;np++){
        if(np===catIdx||np===nameIdx||dateIdx[np]) continue;
        var ptx=texts[np];
        if(!ptx||ptx.length>8) continue;
        var pnum=num(ptx);
        if(pnum!==null&&pnum>=0) plain.push(pnum);
      }
      for(var pi=0;pi<plain.length-1;pi++){
        if(plain[pi+1]>0&&plain[pi]<=plain[pi+1]*2){ earned=plain[pi]; possible=plain[pi+1]; break; }
      }
    }

    /* An assignment with no score yet still belongs in the list - that is the
       whole point of a what-if tool, and on the first day of a term EVERY row is
       blank. So keep it, flagged, with a null earned. compute() treats a null
       earned as "not graded yet" and leaves it out of the maths entirely, which
       matters: an ungraded row counted as 0/10 would silently tank the grade.
       Rows are only trusted this way when the name came from a real name column,
       never from the loose "longest string in the row" fallback. */
    if(earned===null||possible===null){
      if(!(nameIdx>=0&&name)) continue;
      if(g.rows[r].el&&!shown(g.rows[r].el)) continue;
      var ikey=name.toLowerCase()+'|'+cat.toLowerCase()+'|ungraded';
      if(seen[ikey]) continue;
      seen[ikey]=1;
      list.push({name:name,category:cat,earned:null,possible:(possible>0?possible:null),ungraded:true,hypothetical:false});
      continue;
    }
    if(!(possible>0)||possible>100000) continue;
    if(!isFinite(earned)||earned>possible*2+1) continue;

    var key=name.toLowerCase()+'|'+cat.toLowerCase()+'|'+earned+'|'+possible;
    if(seen[key]) continue;
    seen[key]=1;
    list.push({name:name,category:cat,earned:earned,possible:possible,ungraded:false,hypothetical:false});
  }
  return list;
}

/* ========================= overall grade lookup ========================= */

var LETTER_RE=/(?:^|[^A-Za-z])(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F)(?:[^A-Za-z]|$)/;

function findGrade(docs){
  var best=null;
  for(var d=0;d<docs.length;d++){
    var doc=docs[d], els;
    try{ els=doc.querySelectorAll('span,div,b,strong,em,td,th,p,h1,h2,h3,h4,a,font'); }catch(e){ continue; }
    for(var i=0;i<els.length;i++){
      var el=els[i];
      if(el.children&&el.children.length) continue;
      var t=norm(el.textContent);
      if(!t||t.length>20) continue;
      var m=t.match(/^(\d{1,3}(?:\.\d{1,2})?)\s*%$/);
      if(!m) continue;
      var v=parseFloat(m[1]);
      if(!isFinite(v)||v<0||v>130) continue;
      if(!shown(el)) continue;
      var fs=10;
      try{ fs=parseFloat(getComputedStyle(el).fontSize)||10; }catch(e){}
      var ctx='';
      try{ ctx=norm(el.parentElement?el.parentElement.textContent:''); }catch(e){}
      var hasLetter=LETTER_RE.test(ctx);
      var cls='';
      try{ cls=String(el.className||'')+' '+String(el.id||''); }catch(e){}
      var bonus=/grade|mark|score|percent|avg|average|current|final/i.test(cls)?8:0;
      var role=null;
      try{ role=el.getAttribute('role'); }catch(e){}
      var sc=fs*2.2+(hasLetter?30:0)+bonus;
      if(role==='heading') sc+=6;
      if(!best||sc>best.score) best={value:v,score:sc,font:fs,letter:hasLetter,ctx:ctx.slice(0,70)};
    }
    /* percent rendered separately from the number, or hidden in a title attribute */
    try{
      var titled=doc.querySelectorAll('[title]');
      for(var q=0;q<titled.length&&q<1200;q++){
        var tt=norm(titled[q].getAttribute('title'));
        var tm=tt.match(/(\d{1,3}(?:\.\d{1,2})?)\s*%/);
        if(!tm) continue;
        if(!shown(titled[q])) continue;
        var tv=parseFloat(tm[1]);
        if(!isFinite(tv)||tv<0||tv>130) continue;
        var tcls=String(titled[q].className||'')+' '+String(titled[q].id||'');
        var tsc=8+(/grade|mark|score|percent|avg|average/i.test(tcls)?12:0);
        if(!best||tsc>best.score) best={value:tv,score:tsc,font:0,letter:false,ctx:'title="'+tt.slice(0,50)+'"'};
      }
    }catch(e){}
  }
  return best;
}

/* ========================= category weight lookup ========================= */

function findWeights(docs){
  var out={}, source='none', rows=0;
  function addAll(local){
    for(var k in local){
      if(Object.prototype.hasOwnProperty.call(local,k)) out[k]=local[k];
    }
  }
  for(var d=0;d<docs.length;d++){
    var doc=docs[d], tables;
    try{ tables=doc.querySelectorAll('table'); }catch(e){ continue; }
    for(var i=0;i<tables.length;i++){
      var t=tables[i];
      /* Weight data is metadata, and Synergy keeps its category/weight grid in a
         collapsed panel - so unlike assignment rows, a hidden weights table is
         still worth reading. Names are de-duplicated below. */
      var lbl=headerTextsForTable(t);
      var combined=(norm(lbl.join(' '))+' '+norm(t.textContent)).toLowerCase();
      if(combined.indexOf('weight')===-1) continue;
      if(!/(categor|weight|%|points)/.test(combined)) continue;
      var tt=combined;
      var local={}, n=0, trs=directRows(t);
      for(var r=0;r<trs.length;r++){
        var cells=directCells(trs[r]);
        if(cells.length<2) continue;
        var texts=[], pcts=[];
        for(var c=0;c<cells.length;c++){
          var s=norm(cells[c].textContent);
          texts.push(s);
          var m=s.match(/^(\d{1,3}(?:\.\d{1,2})?)\s*%$/);
          if(m) pcts.push({i:c,v:parseFloat(m[1])});
        }
        if(!pcts.length) continue;
        var w=pcts[pcts.length-1];
        if(!(w.v>0&&w.v<=100)) continue;
        var name='', bestLen=-1;
        for(var c2=0;c2<texts.length;c2++){
          if(c2===w.i) continue;
          var s2=texts[c2];
          if(!s2||!/[A-Za-z]/.test(s2)) continue;
          if(/^(categor|weight|total|overall|grade|points|percent)/i.test(s2)) continue;
          if(s2.length>bestLen){ bestLen=s2.length; name=s2; }
        }
        if(!name) continue;
        name=cleanCat(name);
        if(name&&!(name in local)){ local[name]=w.v; n++; }
      }
      if(n){ addAll(local); source='table'; rows+=n; }
    }
  }
  /* secondary: "Homework - 30%" written as text in a block labelled weights */
  if(!Object.keys(out).length){
    for(var d2=0;d2<docs.length&&!Object.keys(out).length;d2++){
      var blocks;
      try{ blocks=docs[d2].querySelectorAll('div,section,ul,ol,p,dl'); }catch(e){ continue; }
      for(var b=0;b<blocks.length;b++){
        var box=blocks[b];
        if(!shown(box)||box.querySelector('table')) continue;
        var txt=norm(box.textContent);
        if(txt.length>420||txt.indexOf('%')===-1||!/weight/i.test(txt)) continue;
        var local2={}, cnt=0;
        var re=/([A-Za-z][A-Za-z0-9 &\/'\-]{1,30}?)\s*[:\-\u2013\u2014]\s*(\d{1,3}(?:\.\d{1,2})?)\s*%/g;
        var mm;
        while((mm=re.exec(txt))){
          var nm=cleanCat(mm[1]), wv=parseFloat(mm[2]);
          if(!nm||!(wv>0&&wv<=100)) continue;
          if(/^(weight|total|categor)/i.test(nm)) continue;
          if(!(nm in local2)){ local2[nm]=wv; cnt++; }
        }
        if(cnt>=2){ addAll(local2); source='text'; rows+=cnt; break; }
      }
    }
  }
  var sum=0;
  for(var k in out){ if(Object.prototype.hasOwnProperty.call(out,k)) sum+=out[k]; }
  return {weights:out,source:source,rows:rows,sum:r2(sum)};
}

/* ============================ course heading ============================ */

/* Knockout observables and computeds are plain functions, and a value can sit a
   layer or two deep. Calling with the owner as `this` keeps models that lean on
   `self` inside the accessor working. */
function koCall(obj,key){
  if(!obj) return null;
  try{
    var v=obj[key];
    for(var i=0;i<3&&typeof v==='function';i++){ v=v.call(obj); }
    return v===undefined?null:v;
  }catch(e){ return null; }
}
function synergyFocus(){
  try{ return (window.PXP&&window.PXP.GBFocus)||null; }catch(e){ return null; }
}

/* ------------------------------- the period -------------------------------

   A class period is where the class sits in the day - "Period 3". It is NOT a
   marking period ("S1", "Quarter 1", "Mark Period 2"): those live in fields that
   also say "period", and reading one of them would print the same number on
   every class, which is exactly the kind of confidently-wrong label this panel
   must never show. So every source below screens them out, and nothing found
   means nothing is shown.                                                            */

/* Anything that names a *marking* period rather than a class period is off
   limits. `id`/`gu` suffixes are deliberately NOT excluded: a field called
   PeriodID holding "3" is a period, and one holding a GUID is rejected by
   periodNum() anyway. */
function isMarkPeriodKey(k){ return /mark|grading|grade|term|group|list|array|s$/i.test(k); }
function inPeriodRange(n){ return (isFinite(n)&&n>=0&&n<=20)?Math.round(n):null; }

/* "3", "(3)", "Period 3", "P. 3" - and nothing else. A bare number inside a
   name ("CHEMISTRY 2") is deliberately not read as a period: only an explicit
   marker counts, because a wrong period is worse than showing none. */
function periodNum(v){
  if(v===null||v===undefined) return null;
  var s=norm(v), m;
  if(!s||s.length>60) return null;
  if(/^\d{1,2}$/.test(s)) return inPeriodRange(parseInt(s,10));
  if((m=s.match(/\bper(?:iod)?\s*[:#.]?\s*(\d{1,2})\b/i))) return inPeriodRange(parseInt(m[1],10));
  if((m=s.match(/^\s*\(\s*(\d{1,2})\s*\)\s*$/))) return inPeriodRange(parseInt(m[1],10));
  return null;
}

/* the period written inside a longer string: "CHEMISTRY(3)",
   "(S1) Teacher, C  CHEMISTRY(3) SEC:CHM201-10-13", "Algebra 2 - Period 5" */
function periodFromName(s){
  s=norm(s);
  if(!s||s.length>160) return null;
  var m=s.match(/\(\s*(\d{1,2})\s*\)/), n;
  if(m){ n=inPeriodRange(parseInt(m[1],10)); if(n!==null) return n; }
  if((m=s.match(/\bperiod\s*[:#.]?\s*(\d{1,2})\b/i))){ n=inPeriodRange(parseInt(m[1],10)); if(n!==null) return n; }
  if((m=s.match(/(?:^|[\s\-])p\.?\s*(\d{1,2})\s*$/i))){ n=inPeriodRange(parseInt(m[1],10)); if(n!==null) return n; }
  return null;
}

/* the current class object: focusArgs.classID resolved against the same
   Classes() list SelectedClassName() reads from */
function currentClassItem(){
  var F=synergyFocus();
  if(!F||typeof F.Classes!=='function') return null;
  var list=koCall(F,'Classes'), want=String(koCall(F,'classID'));
  if(!list||!list.length) return null;
  for(var i=0;i<list.length;i++){
    if(String(koCall(list[i],'ID'))===want) return list[i];
  }
  return null;
}

/* A field is safe to read when it is a plain value or a Knockout
   observable/computed - reading is what those exist for. A plain function is a
   method of the page's view model, and calling one to ask it a question can open
   a dropdown or mutate a portal this script does not own (the gradebook has a
   PeriodDropdown() of exactly that kind). So a bare function is only called when
   its name is the period itself and nothing else. */
var PERIOD_FIELD=/^(?:class|section)?period(?:name|number|num|no|id|code)?$/i;
function koValueField(obj,k){
  var v;
  try{ v=obj[k]; }catch(e){ return false; }
  if(typeof v!=='function') return true;
  if(typeof v.peek==='function'&&typeof v.subscribe==='function') return true;
  return PERIOD_FIELD.test(k);
}

function periodFromClass(cls){
  if(!cls) return null;
  var keys, i, k, n, v;
  try{ keys=Object.keys(cls); }catch(e){ return null; }
  /* a field actually named for the period is the best signal */
  for(i=0;i<keys.length;i++){
    k=keys[i];
    if(!/period/i.test(k)||isMarkPeriodKey(k)||!koValueField(cls,k)) continue;
    n=periodNum(koCall(cls,k));
    if(n!==null) return n;
  }
  /* failing that it can sit inside a description the server sent along */
  for(i=0;i<keys.length;i++){
    k=keys[i];
    if(!/(name|desc|title|full|long|display|caption|label)/i.test(k)||!koValueField(cls,k)) continue;
    v=koCall(cls,k);
    if(typeof v!=='string') continue;
    n=periodFromName(v);
    if(n!==null) return n;
  }
  return null;
}

function periodFromFocus(){
  var F=synergyFocus();
  if(!F) return null;
  var keys, i, n;
  try{ keys=Object.keys(F); }catch(e){ return null; }
  for(i=0;i<keys.length;i++){
    if(!/period/i.test(keys[i])||isMarkPeriodKey(keys[i])||!koValueField(F,keys[i])) continue;
    n=periodNum(koCall(F,keys[i]));
    if(n!==null) return n;
  }
  return null;
}

/* The server's own focus payload carries the class in the portal's long
   registration form - "(S1) Teacher, C  CHEMISTRY(3) SEC:CHM201-10-13" - which is
   the one place the period is always written down. It is only trusted when the
   string actually names the class on screen, which is what stops a stale entry
   for another period from labelling this one. */
function periodFromFocusJson(courseName){
  var FD=null;
  try{ FD=window.PXP&&window.PXP.GBFocusData; }catch(e){ return null; }
  if(!FD) return null;
  var want=norm(courseName).toUpperCase();
  var objs=[FD.focus,FD.focusArgs,FD], o, i, keys, obj, v, n;
  for(o=0;o<objs.length;o++){
    obj=objs[o];
    if(!obj||typeof obj!=='object') continue;
    try{ keys=Object.keys(obj); }catch(e){ continue; }
    for(i=0;i<keys.length;i++){
      if(!/period/i.test(keys[i])||isMarkPeriodKey(keys[i])) continue;
      n=periodNum(obj[keys[i]]);
      if(n!==null) return n;
    }
    for(i=0;i<keys.length;i++){
      v=obj[keys[i]];
      if(typeof v!=='string'||!v||v.length>140) continue;
      if(want&&v.toUpperCase().indexOf(want)<0) continue;   /* some other class */
      n=periodFromName(v);
      if(n!==null) return n;
    }
  }
  return null;
}

/* Last resort: the portal's own class list, which repeats "Period 1" ... "Period 8"
   down the side, so a lone hit there means nothing. The entry that counts is the
   one whose row also carries the class name. The walk touches the whole document
   and the ticker asks on a timer, so the answer is cached for a moment. */
var domPeriod={key:'',at:0,val:null};
function periodFromDom(name){
  var key=(location.href||'')+'|'+(name||'');
  var now=new Date().getTime();
  /* Six seconds, not two: this walk touches the whole document, and it only
     ever runs for a class whose period nothing else could supply. A class
     switch changes the name in the key, so the new answer is not delayed. */
  if(domPeriod.key===key&&(now-domPeriod.at)<6000) return domPeriod.val;
  var val=scanDomForPeriod(name);
  domPeriod={key:key,at:now,val:val};
  return val;
}
/* <option> never has client rects of its own - the select draws it - so it would
   look invisible to shown() even with the list open on screen in front of you. */
function domVisible(el){
  if(el.tagName==='OPTION') return !!(el.parentNode&&shown(el.parentNode));
  return shown(el);
}
function scanDomForPeriod(name){
  var els;
  try{ els=document.querySelectorAll('a,span,li,option,label,td,th,strong,small,div,button'); }catch(e){ return null; }
  var hits=[], i, cap=Math.min(els.length,1400);
  for(i=0;i<cap;i++){
    var el=els[i], t=el.textContent;                 /* cheap: no layout read */
    if(!t||t.length>90||!/period|per\.|\d\s*\)/i.test(t)) continue;
    /* only the element's OWN text counts - a container's text is every child's */
    var own='';
    for(var c=0;c<el.childNodes.length;c++){
      if(el.childNodes[c].nodeType===3) own+=el.childNodes[c].nodeValue;
    }
    own=norm(own);
    if(!own||own.length>60) continue;
    if(!/period|per\.|\d\s*\)/i.test(own)) continue;   /* the period is in a child */
    if(/^\d{1,2}$/.test(own)) continue;              /* a bare "3" is too weak */
    var n=periodFromName(own);
    if(n===null) continue;
    /* the layout read comes last, so it is paid only for real candidates */
    hits.push({n:n,el:el,vis:domVisible(el)});
  }
  if(!hits.length) return null;
  /* The entry that counts is the one sitting in this class's own row: the class
     list repeats every period, so a number on its own says nothing. The element
     itself counts as a row ("PERIOD 3 CHEMISTRY" is one option), and a row that
     mentions several periods is the whole list - never a match. */
  var best=null,bestScore=0;
  if(name){
    var want=norm(name).toUpperCase();
    for(i=0;i<hits.length;i++){
      var up=hits[i].el, row=null;
      for(var d=0;d<5&&up;d++){
        if(up===document.body||up.nodeType!==1) break;
        var txt=norm(up.textContent);
        if(txt.length>200) break;
        if(txt.toUpperCase().indexOf(want)>=0&&periodMentions(txt)<=1){ row=txt; break; }
        up=up.parentNode;
      }
      if(row===null) continue;
      var sc=(hits[i].vis?2:1)+(row.length<=80?1:0);
      if(sc>bestScore){ bestScore=sc; best=hits[i].n; }
    }
  }
  if(best!==null) return best;
  /* failing that, a single *visible* period on the page is unambiguous */
  var uniq={}, vis=0;
  for(i=0;i<hits.length;i++){ if(!hits[i].vis) continue; vis++; uniq[hits[i].n]=1; }
  var ks=Object.keys(uniq);
  return (vis&&ks.length===1)?parseInt(ks[0],10):null;
}
function periodMentions(s){
  var re=/period\s*[:#.]?\s*\d{1,2}|\d{1,2}\s*\)/gi, n=0;
  while(re.exec(s)&&n<9) n++;
  return n;
}


/* Some deployments hand over the whole registration line -
   "(S1) Teacher, C  CHEMISTRY(3) SEC:CHM201-10-13" - and some just the course.
   When it is the long one, keep the course and drop the rest. */
function tidyCourseName(raw){
  var s=norm(raw);
  if(!s) return '';
  s=s.replace(/^\(\s*[SQFWT]\d{0,2}\s*\)\s*/,'');   /* the marking period */
  s=s.replace(/\s*SEC\s*[:.].*$/i,'');              /* the section code   */
  s=s.replace(/\s*\(\s*\d{1,2}\s*\)\s*$/,'');      /* the period we just read */
  s=s.replace(/^[A-Z][A-Za-z'\-]+,\s*[A-Z]\.?\s+/,'');  /* "Teacher, C "    */
  s=norm(s.replace(/^[\s\-\/|]+/,'').replace(/[\s\-\/|]+$/,''));
  if(!s) return '';
  /* the portal writes its class names in caps and the header matches it, so the
     whole line reads as one style whether the portal shouts or not */
  return s.toUpperCase().slice(0,70);
}

/* Some deployments put the period in the name already ("Chemistry - Period 2"),
   and printing it twice reads like a bug, so an explicit marker is left alone. */
function withPeriod(name,per){
  if(!name) return '';
  if(per===null||per===undefined) return name;
  var n=String(per);
  try{
    if(new RegExp('\\bperiod\\s*[:#.]?\\s*'+n+'\\b','i').test(name)) return name;
    if(new RegExp('\\(\\s*'+n+'\\s*\\)\\s*$').test(name)) return name;
  }catch(e){}
  return name+' \u2014 PERIOD '+per;
}

/* The portal always has a homeroom class in its list and always writes that one
   into the page's focus payload before a class has been picked, so its name is
   on the page even when the student is looking at nothing. Naming it is what put
   "ADVISORY" at the top of the panel with no class open. It is never the class
   on screen, so it counts as no name at all. */
function isPlaceholderClass(s){
  var t=norm(s);
  if(!t) return false;
  if(/\b(advisor(?:y|ies)|homeroom)\b/i.test(t)) return true;
  if(/SEC\s*[:.]\s*ADV\b/i.test(t)) return true;
  return false;
}

function findCourse(docs){
  var candidates=[];
  for(var d=0;d<docs.length;d++){
    var doc=docs[d];
    try{
      /* deliberately NOT [class*="class"]: that matched Synergy's
         "gb-classdetail-*" wrappers, whose text is the student's name */
      var marked=doc.querySelectorAll('[class*="course"],[id*="course"],[id*="Course"]');
      for(var i=0;i<marked.length&&i<40;i++){
        var t=norm(marked[i].textContent);
        if(t&&t.length>=3&&t.length<=70&&/[A-Za-z]/.test(t)&&shown(marked[i])) candidates.push({t:t,w:2});
      }
    }catch(e){}
    try{
      var hs=doc.querySelectorAll('h1,h2,h3,h4');
      for(var j=0;j<hs.length&&j<14;j++){
        var t2=norm(hs[j].textContent);
        if(!t2||t2.length<3||t2.length>70||!/[A-Za-z]/.test(t2)) continue;
        if(!shown(hs[j])) continue;
        /* panel labels and nav items are not class names */
        if(/^(grade\s*book|assignments?|grade calculation summary|attendance|class schedule|report card|course history|synergy mail|calendar|documents|test history|school information|student info|home|messages)/i.test(t2)) continue;
        candidates.push({t:t2,w:1});
      }
    }catch(e){}
  }
  /* Synergy does NOT put the current class name in the markup. The only text
     heading on a gradebook page is the student's own name, which is why a naive
     scrape reported a person instead of a class.

     The live value lives in the page's Knockout model:
       PXP.GBFocus.SelectedClassName()  ->  Classes().find(ID()===classID).Name()
     It is a computed, so it re-evaluates whenever focusArgs.classID changes.
     On this portal it returns the COURSE and nothing else ("CHEMISTRY"), which
     is why the period is looked up separately - see the period block above.

     The inline JSON (PXP.GBFocusData.focus.ClassName) is only the class the page
     was FIRST rendered with, so it is a last resort, never the first choice. */
  var F=synergyFocus();
  var hasModel=!!(F&&typeof F.SelectedClassName==='function');

  if(hasModel){
    /* The model is the authority while it is on the page: when it names no
       class there is no class open. Falling back to headings in that case is
       exactly how the student's own name used to end up in this header. */
    var raw=koCall(F,'SelectedClassName');
    raw=norm(raw===null?'':String(raw)).replace(/&nbsp;/g,'').trim();
    if(raw==='&nbsp;') raw='';
    var cls=currentClassItem();
    if(!raw) raw=norm(koCall(cls,'Name')||'');
    if(raw==='&nbsp;') raw='';
    if(isPlaceholderClass(raw)) raw='';
    if(!raw) return '';
    var nm=tidyCourseName(raw);
    if(!nm) return '';
    var per=periodFromName(raw);
    if(per===null) per=periodFromClass(cls);
    if(per===null) per=periodFromFocus();
    if(per===null) per=periodFromFocusJson(nm);
    if(per===null) per=periodFromDom(nm);
    return withPeriod(nm,per);
  }

  /* no model on the page: the class it was originally rendered with, then the
     markup. Both of these are guesses, so they come after the model. */
  var frozen='';
  try{
    var FD=window.PXP&&window.PXP.GBFocusData;
    var nm0=FD&&FD.focus&&FD.focus.ClassName;
    if(nm0&&norm(nm0).length>=3) frozen=norm(nm0);
  }catch(e){}
  if(frozen&&!isPlaceholderClass(frozen)) return withPeriod(tidyCourseName(frozen),periodFromName(frozen));

  /* Markup the portal itself labelled as a course can still stand in for the
     missing model. Bare headings cannot: the one heading on a real gradebook
     page is the student's own name, and using it here is how a person's name
     ended up in the header. */
  var marked=[];
  for(var mc=0;mc<candidates.length;mc++){ if(candidates[mc].w>=2) marked.push(candidates[mc]); }
  if(marked.length){
    marked.sort(function(a,b){ return b.w-a.w; });
    return withPeriod(tidyCourseName(marked[0].t),periodFromName(marked[0].t));
  }
  /* the payload named the advisory class, so the class on screen is unnamed:
     saying nothing beats naming a homeroom the student is not looking at */
  if(frozen) return '';
  var title=norm(document.title).replace(/\s*[|\u2013\u2014-]\s*StudentVUE.*$/i,'');
  return tidyCourseName(title);
}

/* An assignment counts toward the grade only once it has a score. An empty
   score box means "not graded yet", not zero: a teacher posting work without a
   mark, or a what-if row you have not filled in, must never drag the grade down
   and must never inflate the point totals either. */
function gradedRow(a){
  if(!a) return false;
  var e=a.earned;
  if(e===null||e===undefined||e==='') return false;
  return isFinite(Number(e))&&Number(a.possible)>0;
}

/* ============================== full parse ============================== */

/* Whether a class is open is a fact about the page, not about the name that was
   readable: Synergy's inline config names the advisory class before anything has
   been picked, and a class with nothing posted yet has no rows to parse either.
   The gradebook panels are the honest signal - they exist once a class is open,
   whether or not a single score has landed in it. */
/* Is this StudentVUE at all? The answer decides whether the panel offers a
   gradebook read or the short walkthrough back to the gradebook, so it must not
   be guesswork: every signal below is one the portal writes itself, and a page
   that has none of them is not the portal. A district-hosted portal keeps its
   hostname, and a saved or framed copy still carries the title, the ids, the
   globals or the script names. */
function looksLikeStudentVue(){
  try{
    var host=String(location.hostname||'');
    if(/edupoint\.com$/i.test(host)) return true;
    if(/studentvue|parentvue/i.test(host)) return true;
    if(/StudentVUE/i.test(String(document.title||''))) return true;
    if(window.PXP) return true;
    if(document.getElementById('assignment-details')) return true;
    if(document.getElementById('CategoryWeights')) return true;
    if(document.getElementById('ctl00_CategoryWeights')) return true;
    if(document.querySelector('[id^="PXP2_"],[class*="PXP2_"]')) return true;
    var sc=document.querySelectorAll('script[src]');
    for(var i=0;i<sc.length&&i<80;i++){
      if(/PXP2_|pxp\.gradebook|StudentVue/i.test(String(sc[i].getAttribute('src')||''))) return true;
    }
  }catch(e){}
  return false;
}

/* What used to sit here was a `gradebookOnPage()` test that read the gradebook
   panels as proof a class was open. Synergy renders those panels as part of the
   page template, before anything has been picked, so it said yes on the class
   list too - which is how the advisory homeroom came to be named at the top of a
   page with no class open. Whether a class is open now comes from the class the
   portal names and from nothing else. */

function parseAll(){
  var docs=collectDocs();
  var grids=[], nTables=0, nFrames=docs.length-1, nRole=0, nGroups=0;
  for(var d=0;d<docs.length;d++){
    var gs=tableGrids(docs[d]);
    nTables+=gs.length;
    grids=grids.concat(gs);
  }
  for(var d2=0;d2<docs.length;d2++){
    var rgs=roleGrids(docs[d2]);
    nRole+=rgs.length;
    grids=grids.concat(rgs);
    var grps=rowGroupCandidates(docs[d2]);
    nGroups+=grps.length;
    grids=grids.concat(grps);
  }

  for(var s=0;s<grids.length;s++) grids[s].score=scoreGrid(grids[s]);
  /* A category-weight summary must never be mistaken for the assignment list,
     however good its score looks - it is made of percentages and totals. */
  var viable=[];
  for(var s2=0;s2<grids.length;s2++){
    if(grids[s2].score>0&&!isSummaryGrid(grids[s2])) viable.push(grids[s2]);
  }
  viable.sort(function(a,b){ return b.score-a.score; });

  var list=[], headerIdx=-1, roles=[], chosen=null;
  for(var v=0;v<viable.length&&!list.length;v++){
    var g=viable[v];
    chosen=g;
    var hi=findHeader(g);
    var rr=hi>=0?colRoles(g.rows[hi].texts):[];
    var parsed=parseAssignments(g,hi,rr);
    if(parsed.length){ list=parsed; headerIdx=hi; roles=rr; }
  }
  /* a compact picture of the best candidates, for the report */
  var topBlocks=[];
  var ranked=grids.slice(0).sort(function(a,b){ return (b.score||0)-(a.score||0); });
  for(var rb=0;rb<ranked.length&&rb<8;rb++){
    var blk=ranked[rb], blkCols=0, blkScored=0, blkSample=[];
    for(var rr=0;rr<blk.rows.length;rr++){
      var rt=blk.rows[rr].texts;
      if(rt.length>blkCols) blkCols=rt.length;
      var hasS=false;
      for(var cc=0;cc<rt.length;cc++){ if(isValue(parseCell(rt[cc]))) hasS=true; }
      if(hasS) blkScored++;
      if(blkSample.length<4) blkSample.push(rt.slice(0,8));
    }
    var tag='?';
    try{
      if(blk.el&&blk.el.tagName){
        tag=blk.el.tagName.toLowerCase();
        var cn=String(blk.el.className||'').split(' ')[0];
        if(cn) tag+='.'+cn;
      }
    }catch(e){}
    topBlocks.push({kind:blk.kind,tag:tag,rows:blk.rows.length,cols:blkCols,scored:blkScored,score:r2(blk.score||0),sample:blkSample});
  }

  var grade=findGrade(docs);
  var w=findWeights(docs);
  var course=findCourse(docs);

  /* decide the grading mode */
  var tE=0,tP=0;
  for(var i=0;i<list.length;i++){
    if(!gradedRow(list[i])) continue;
    tE+=Number(list[i].earned)||0; tP+=Number(list[i].possible)||0;
  }
  var totalPct=tP>0?tE/tP*100:null;
  var wKeys=[];
  for(var k in w.weights){ if(Object.prototype.hasOwnProperty.call(w.weights,k)) wKeys.push(k); }
  var weightedPct=null;
  if(wKeys.length&&list.length){
    var byCat={};
    for(var i2=0;i2<list.length;i2++){
      var c=list[i2].category||'Uncategorized';
      if(!byCat[c]) byCat[c]={e:0,p:0};
      if(!gradedRow(list[i2])) continue;
      byCat[c].e+=Number(list[i2].earned)||0; byCat[c].p+=Number(list[i2].possible)||0;
    }
    var sumW=0,wSum=0;
    for(var k2 in byCat){
      if(!Object.prototype.hasOwnProperty.call(byCat,k2)) continue;
      var wt=Number(w.weights[k2])||0;
      var dd=byCat[k2];
      if(dd.p>0&&wt>0){ sumW+=wt; wSum+=(dd.e/dd.p)*wt; }
    }
    if(sumW>0) weightedPct=wSum/sumW*100;
  }
  var mode='total';
  if(weightedPct!==null&&totalPct!==null){
    if(grade&&isFinite(grade.value)){
      mode=Math.abs(weightedPct-grade.value)<=Math.abs(totalPct-grade.value)?'weighted':'total';
    }else mode=wKeys.length>=2?'weighted':'total';
  }else if(weightedPct!==null&&wKeys.length>=2){
    mode='weighted';
  }

  return {
    assignments:list,
    weights:w.weights,
    weightSource:w.source,
    weightSum:w.sum,
    modeGuess:mode,
    originalPct:grade&&isFinite(grade.value)?grade.value:null,
    gradeInfo:grade,
    courseTitle:course,
    onSV:looksLikeStudentVue(),
    meta:{
      docs:docs.length, frames:nFrames, blocked:BLOCKED_FRAMES.slice(0,6),
      tables:nTables, roleGrids:nRole, rowGroups:nGroups,
      candidates:grids.length, viable:viable.length,
      bestScore:chosen?r2(chosen.score):0,
      bestKind:chosen?chosen.kind:'none',
      headerRow:headerIdx,
      roles:roles,
      headerTexts:(headerIdx>=0&&chosen&&chosen.rows[headerIdx])?chosen.rows[headerIdx].texts.slice(0,8):[],
      rowsScanned:chosen?chosen.rows.length:0,
      totalPct:totalPct===null?null:r2(totalPct),
      weightedPct:weightedPct===null?null:r2(weightedPct),
      weightSource:w.source, weightSum:w.sum,
      top:topBlocks
    }
  };
}

/* ================================== app ================================== */

function run(){

  /* ---------- state ---------- */
  var state={
    list:[], weights:{}, mode:'total', original:null, found:false, open:false,
    dirty:false, course:'', onSV:true, meta:{}, pendingRow:null
  };

  var docs=collectDocs();
  var host=document.createElement('div');
  host.id='vuepoint-root';
  /* vertically centred rather than pinned to the top corner, and capped to the
     viewport so a centred panel can never run off the top or bottom */
  /* Pinned to the right edge and vertically centred on the page. The panel's
     height is whatever its content needs (up to the viewport), and the
     translate keeps it centred as the assignment list grows and shrinks. */
  /* `100%` rather than `95vw`: vw counts the vertical scrollbar while `right`
     does not, so 95vw + 16px of gutter overflowed the layout viewport on any
     page that scrolls and pushed the panel's left edge off-screen. */
  host.style.cssText='position:fixed;top:50%;right:16px;transform:translateY(-50%);z-index:2147483647;width:min(600px,calc(100% - 32px));max-height:calc(100vh - 20px);';
  (document.body||document.documentElement).appendChild(host);
  var shadow=host.attachShadow({mode:'open'});

  var style=document.createElement('style');
  style.textContent=[
    /* The ambient float rides on the independent `translate` property, so it
       composes with the host's inline translateY(-50%) centring instead of
       replacing it. It pauses under the pointer so text stays steady while
       you read or edit. */
    ':host{display:block;animation:vpFloat 8s ease-in-out infinite}',
    ':host(:hover){animation-play-state:paused}',
    '@keyframes vpFloat{0%,100%{translate:0 -3px}50%{translate:0 3px}}',
    '@keyframes vpIn{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}',
    '@keyframes vpOut{to{opacity:0;transform:translateY(5px) scale(.99)}}',
    '[hidden]{display:none!important}',
    '.vp *{box-sizing:border-box;margin:0;padding:0;font-family:inherit}',
    /* No border at all. A 1px outline cannot match both a dark green banner and
       a white body at once, so the pale one it had read as a stray white line
       down each side of the header, where the eye is. The layered shadow below
       is what defines the panel's edge instead. */
    /* A layered shadow - one tight contact shadow plus two wider, softer ones -
       reads as a panel floating above the page; a single mid-blur shadow just
       looks like a thick outline. */
    '.vp{background:#fff;border:0;border-radius:16px;box-shadow:0 1px 2px rgba(15,23,42,.05),0 10px 22px -8px rgba(15,23,42,.16),0 30px 60px -22px rgba(15,23,42,.28);overflow:hidden;color:#0f2e2c;font:12.5px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-height:calc(100vh - 20px);display:flex;flex-direction:column;transform-origin:100% 50%;animation:vpIn .26s cubic-bezier(.22,.9,.28,1) both}',
    '.vp.vp-out{animation:vpOut .16s ease-in forwards}',
    '.vp-h{display:flex;align-items:center;gap:9px;padding:8px 10px;background:#0f766e;color:#fff;cursor:grab;user-select:none;flex:0 0 auto}',
    '.vp-h:active{cursor:grabbing}',
    '.vp-logo{width:23px;height:23px;border-radius:50%;background:rgba(255,255,255,.18);display:grid;place-items:center;flex:0 0 23px}',
    '.vp-logo svg{width:13px;height:13px;display:block}',
    '.vp-hd{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}',
    '.vp-hd b{font-size:13px;font-weight:700;letter-spacing:-.01em;line-height:1.12}',
    '.vp-hd em{font-size:10.5px;font-style:normal;opacity:.82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}',
    /* Fill only, no outline: a translucent white hairline on the dark banner
       reads as a stray white box, not as a badge edge. */
    '.vp-pill{font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:3px 8px;border-radius:99px;background:rgba(255,255,255,.18);border:0;flex:0 0 auto}',
    /* a drawn cross rather than the \u00d7 glyph, whose side bearings sit it
       visibly off-centre inside the square */
    '.vp-x{width:24px;height:24px;flex:0 0 24px;padding:0;border-radius:7px;border:0;background:rgba(255,255,255,.13);color:#fff;cursor:pointer;display:grid;place-items:center;transition:background .15s}',
    '.vp-x svg{width:12px;height:12px;display:block;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}',
    '.vp-x:hover{background:rgba(255,255,255,.26)}',
    '.vp-b{overflow:auto;padding:11px;flex:1 1 auto}',
    /* Advisory only, so it is hidden outright in the ordinary case: the panel
       used to open with a "read from this page" banner that ate 51px of the
       top and said nothing the counts below do not already say. Now it appears
       only when something is actually wrong. */
    '.vp-note{font-size:11.5px;line-height:1.45;color:#78350f;background:#fffbeb;border:1px solid #fde68a;border-radius:9px;padding:8px 11px;margin:0 0 11px}',
    '.vp-note b{font-weight:700;color:#78350f}',
    /* One hero card instead of two boxes side by side. The old second box
       ("Detected from the page") restated three numbers in a cramped column;
       they read better as a stat strip across the foot of the same card, and
       the freed width lets the projected grade itself go much bigger. */
    '.vp-hero{border:1px solid #cbe6e2;border-radius:11px;padding:11px 13px 0;background:linear-gradient(180deg,#f5fdfb,#fff 58%)}',
    '.vp-hero-top{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:19px}',
    '.vp-lab{font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#5b7d79}',
    '.vp-grade{display:flex;align-items:baseline;gap:9px;margin-top:1px}',
    '.vp-grade strong{font-size:31px;font-weight:800;letter-spacing:-.035em;line-height:1.06;font-variant-numeric:tabular-nums}',
    '.vp-grade span{font-size:16px;font-weight:800}',
    '.vp-pts{font-size:11.5px;color:#3f5f5c;margin-top:2px;font-variant-numeric:tabular-nums}',
    '.vp-delta{display:inline-block;font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:6px}',
    /* the stat strip is pulled out to the card's edges and clipped to its
       radius, so it reads as the card's footer rather than a floating row */
    '.vp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin:11px -13px 0;background:#e6f2f0;border-top:1px solid #e6f2f0;border-radius:0 0 10px 10px;overflow:hidden}',
    '.vp-stats>div{display:flex;flex-direction:column;gap:3px;background:#fff;padding:8px 11px 9px}',
    '.vp-stats dd{order:1;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}',
    '.vp-stats dt{order:2;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5b7d79}',
    '.vp-ctl{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-top:11px}',
    /* Every control in this row is an exact 26px box with line-height:1 and
       flex centring. Padding-based sizing left the segmented buttons 2px
       shorter than the plain ones, so their labels sat low against the rest. */
    '.vp-seg{display:flex;padding:3px;gap:4px;height:34px;background:#f0fdfa;border:1px solid #cbe6e2;border-radius:10px}',
    '.vp-seg button{display:inline-flex;align-items:center;justify-content:center;height:26px;border:0;background:transparent;font-weight:600;font-size:11px;line-height:1;color:#3f5f5c;padding:0 14px;border-radius:8px;cursor:pointer;transition:background .15s,color .15s,box-shadow .15s}',
    '.vp-seg button:hover{background:rgba(15,118,110,.09);color:#0f2e2c}',
    '.vp-seg button[aria-pressed="true"],.vp-seg button[aria-pressed="true"]:hover{background:#0f766e;color:#fff;box-shadow:0 1px 3px rgba(15,118,110,.32)}',
    '.vp-btn{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border:1px solid #cbe6e2;background:#fff;border-radius:8px;font-weight:600;font-size:11px;line-height:1;color:#0f2e2c;cursor:pointer;transition:background .15s,border-color .15s,color .15s,box-shadow .15s,transform .12s}',
    /* only the control row grows: the same .vp-btn is used by the diagnostics
       bar and the assignment row, which should keep their compact size. */
    '.vp-ctl .vp-btn{height:34px;padding:0 15px;border-radius:9px;font-size:12px}',
    '.vp-btn.sm{height:25px;padding:0 10px;border-radius:7px;font-size:10.5px}',
    '.vp-btn:hover{border-color:#0f766e;color:#0f766e;transform:translateY(-1px);box-shadow:0 2px 6px rgba(15,118,110,.14)}',
    '.vp-btn:active{transform:translateY(0);box-shadow:none}',
    '.vp-btn.pri{background:#0f766e;border-color:#0f766e;color:#fff}',
    '.vp-btn.pri:hover{background:#115e59}',
    '.vp-sec{border:1px solid #cbe6e2;border-radius:11px;margin-top:11px;overflow:hidden}',
    /* padding-top = padding-bottom + the 1px rule: centring happens inside the
       content box, so an uneven border pushes the label half a pixel off the
       middle of the bar the eye actually sees. */
    '.vp-sec>h4{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0f2e2c;background:#f0fdfa;border-bottom:1px solid #dff5f2;padding:8px 12px 7px}',
    '.vp-sec>h4 span{font-weight:700;letter-spacing:0;text-transform:none;font-size:10.5px;color:#5b7d79}',
    /* Three columns that fill the row edge to edge. The name used to be a bare
       label in a fixed 160px column, and the percent floated on a 1fr column:
       a short name left a dead gap before its own weight box and a second, wider
       one before the percent, so a two-category class looked like a mostly
       empty card. The name is a filled field now - the same width budget as the
       inputs beside it, grown to take whatever the name needs - so the row
       reads as one line of controls with nothing stranded in white space. */
    '.vp-wl{display:grid;gap:6px;padding:9px 12px}',
    '.vp-wr{display:grid;grid-template-columns:minmax(0,1fr) 66px 64px;gap:8px;align-items:center}',
    /* align-self:stretch is what makes the field exactly as tall as the number
       box next to it, whatever that box's line box works out to be */
    '.vp-catn{display:flex;align-items:center;align-self:stretch;padding:0 10px;border:1px solid #e3f1ef;background:#f6fcfb;border-radius:7px;font-size:12px;font-weight:600;color:#0f2e2c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.vp-wr>em{font-size:11px;font-style:normal;color:#5b7d79;text-align:right;font-variant-numeric:tabular-nums}',
    '.vp-wr input.vp-i{padding:5px 7px;font-size:12px}',
    /* longhands, not the `font:` shorthand: "font:600 11.5px inherit" is invalid
       (inherit is not a family in the shorthand), so the whole declaration was
       dropped and every button and input silently fell back to the UA default
       of 13.33px - none of the sizes set here were ever applied. */
    'input.vp-i,select.vp-i{width:100%;border:1px solid #c7d7d5;background:#fff;border-radius:7px;padding:5px 7px;font-weight:600;font-size:12px;color:#0f2e2c;outline:none;min-width:0}',
    'input.vp-i:focus,select.vp-i:focus{border-color:#0f766e;box-shadow:0 0 0 2px rgba(15,118,110,.16)}',
    /* numbers are centred in their boxes - fetched and what-if alike. Tabular
       figures keep them from shifting as digits change. */
    'input.vp-i.n{text-align:center;font-variant-numeric:tabular-nums}',
    '.vp-newcat{display:flex;gap:7px;padding:0 12px 11px;align-items:center}',
    /* flex + line-height:1 so the hint centres on the button's box rather than
       on its own font metrics, which sat it a hair low against the button */
    '.vp-tip{display:flex;align-items:center;line-height:1;font-size:10.5px;color:#5b7d79}',
    '.vp-cta{display:flex;align-items:center;gap:9px;padding:0 12px 11px;flex-wrap:wrap}',
    '.vp-scroll{max-height:min(28vh,272px);overflow:auto}',
    '.vp-tbl{width:100%;border-collapse:collapse}',
    /* White, not the header's mint: the section title bar and the column-header
       row are the same tint otherwise, so the two fuse into one tall green
       block and "Assignments" looks pinned to the top of it instead of centred
       in its own bar. */
    '.vp-tbl th{position:sticky;top:0;background:#fff;text-align:left;font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#5b7d79;padding:8px 8px 7px;border-bottom:1px solid #e6f2f0;z-index:1}',
    '.vp-tbl td{padding:4px 5px;border-bottom:1px solid #f0f7f6;vertical-align:middle}',
    '.vp-tbl th.n,.vp-tbl td.n{text-align:right}',
    '.vp-tbl td.n input{text-align:center}',
    '.vp-tbl tr.hypo td{background:#f0fdfa}',
    '.vp-tbl tr.hypo td:first-child{box-shadow:inset 3px 0 0 #0d9488}',
    '.vp-tbl td.cat{width:118px}',
    '.vp-tbl td.sc{width:76px}',
    '.vp-tbl td.rm{width:30px}',
    /* A drawn cross, not the &times; glyph: its ink sits above the baseline, so
       a text cross can never be centred vertically in the box. Same reason the
       panel's own close button draws one. */
    '.vp-del{width:24px;height:24px;padding:0;border:1px solid #c7d7d5;background:#fff;border-radius:6px;color:#5b7d79;cursor:pointer;display:grid;place-items:center}',
    '.vp-del svg{width:11px;height:11px;display:block;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round}',
    '.vp-del:hover{border-color:#b91c1c;color:#b91c1c}',
    '.vp-add{display:flex;gap:6px;padding:10px 12px;border-top:1px solid #dff5f2;background:#fff;flex-wrap:wrap}',
    /* min-width:0 is load-bearing: without it an <input>'s intrinsic minimum
       beats flex-basis and the row wraps mid-field into a ragged second line. */
    '.vp-add input,.vp-add select{min-width:0}',
    '.vp-add input#vp-n{flex:1 1 96px;max-width:180px}',
    '.vp-add select{flex:0 1 118px}',
    '.vp-add input.n{flex:0 0 72px}',
    /* The one control in this row is the point of the row, so it is sized above
       the panel's default button: 32px against the 28px used elsewhere, with
       the roomier padding and radius to match. */
    '.vp-add>.vp-btn{margin-left:auto;height:32px;padding:0 16px;border-radius:9px;font-size:12px;font-weight:700;gap:6px;box-shadow:0 1px 2px rgba(15,118,110,.16)}',
    '.vp-add>.vp-btn svg{width:13px;height:13px;flex:0 0 13px;display:block;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round}',
    /* the fields grow with it, so the row still reads as one line of controls */
    '.vp-add input.vp-i,.vp-add select.vp-i{padding:7px 8px}',
    /* Very narrow window (a small laptop or half-screen window): give the name
       its own line rather than letting the Add button wrap off on its own. */
    '@media (max-width:480px){.vp-add input#vp-n{flex:1 1 100%;max-width:none}.vp-add select{flex:1 1 88px}}',
    /* The add row stays on screen at every window height. In a short window the
       panel is taller than the viewport, and because the row sits at the foot
       of the assignments card it fell past the fold: adding an assignment
       meant scrolling the panel first. Sticking it to the bottom of the
       panel's scroll area (.vp-b) keeps it visible for as long as the
       assignments card itself is on screen, and changes nothing at all when
       the whole panel already fits.
       The card gives up overflow:hidden for this, because a clipping ancestor
       is not a sticky scrollport - and then the two rows that touch the card's
       edge have to draw the corners that the clipping used to provide. The
       offset resolves against .vp-b's padding box, so the row stops just clear
       of the footer rather than sitting welded to it. */
    '#vp-asec{overflow:visible}',
    '#vp-asec>h4{border-radius:10px 10px 0 0}',
    '#vp-asec>.vp-add{position:sticky;bottom:0;z-index:2;border-radius:0 0 10px 10px}',
    /* No background tint: the strip's mint fill read as a squared-off green
       block sitting under the white panel. line-height:1 plus equal padding
       centres the text exactly rather than via the font's own metrics. */
    /* A direct child of .vp, not of the scrolling body: inside .vp-b it was
       inset by the body's 9px padding, so its rule stopped short of both edges
       and there was a strip of white underneath it. Full width and flush with
       the bottom corners now. padding-top = padding-bottom + the 1px rule, so
       the text centres on the strip the eye sees. */
    /* No overflow:hidden and no line-height:1 here. Together they made the line
       box exactly as tall as the font, so the descenders of "g" in "nothing"
       were clipped by the box. A normal line-height and no clipping is the fix;
       the flex centring and the padding asymmetry above handle the alignment. */
    '.vp-ft{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 12px 7px;border-top:1px solid #e6f2f0;background:transparent;flex:0 0 auto;flex-wrap:wrap}',
    '.vp-ft small{font-size:10px;line-height:1.3;color:#5b7d79}',
    '.vp-by{font-size:10px;line-height:1.3;font-weight:600;color:#0f766e;white-space:nowrap}',
    /* the folded chip: the checkmark and the name reopen the panel, the cross
       beside them dismisses it - two explicit choices, no nested menu */
    '.vp-mini{display:flex;align-items:center;gap:2px;width:max-content;padding:3px 4px 3px 3px;border-radius:99px;background:#0f766e;color:#fff;box-shadow:0 1px 2px rgba(15,23,42,.06),0 8px 18px -6px rgba(15,23,42,.22),0 22px 44px -18px rgba(15,23,42,.32);animation:vpUnfold .24s cubic-bezier(.22,.9,.28,1) both}',
    /* Both halves of the fold lean towards the top-right corner, which is where
       the chip lives: the shell shrinks and drifts up-right while anchored on
       its right edge, and the chip drops back in from just above that corner.
       The host itself is moved only once the shell is invisible (see collapse),
       so the panel is never seen teleporting to the corner. */
    '@keyframes vpUnfold{from{opacity:0;transform:translate(9px,-12px) scale(.94)}to{opacity:1;transform:none}}',
    '.vp-fold{animation:vpFold .19s cubic-bezier(.4,0,.7,1) forwards}',
    '@keyframes vpFold{to{opacity:0;transform:translate(8px,-34px) scale(.9)}}',
    '.vp-mini-main{display:flex;align-items:center;gap:7px;height:26px;padding:0 9px 0 4px;border:0;border-radius:99px;background:transparent;color:#fff;font-weight:600;font-size:12px;line-height:1;cursor:pointer;transition:background .15s}',
    '.vp-mini-main:hover{background:rgba(255,255,255,.13)}',
    '.vp-mini .vp-logo{width:22px;height:22px;flex:0 0 22px}',
    '.vp-mini-x{display:grid;place-items:center;width:22px;height:22px;flex:0 0 22px;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.13);color:#fff;cursor:pointer;transition:background .15s}',
    '.vp-mini-x:hover{background:rgba(255,255,255,.26)}',
    '.vp-mini-x svg{width:11px;height:11px;display:block;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round}',
    '.vp-empty{padding:18px 14px;text-align:center}',
    '.vp-guide{counter-reset:vps;padding:16px 15px 14px;text-align:left}',
    '.vp-guide h5{font-size:13.5px;font-weight:700;margin-bottom:5px}',
    '.vp-gp{font-size:11.5px;color:#3f5f5c;line-height:1.55;max-width:52ch}',
    /* Numbered with a counter rather than the list marker: the marker sits
       outside the list box and steals the left gutter the body needs. */
    '.vp-steps{list-style:none;margin:12px 0 0;display:grid;gap:9px}',
    '.vp-steps li{position:relative;padding-left:28px;counter-increment:vps;font-size:11.5px;line-height:1.5;color:#0f2e2c}',
    '.vp-steps li b{font-weight:700}',
    '.vp-steps li::before{content:counter(vps);position:absolute;left:0;top:0;width:19px;height:19px;border-radius:50%;background:#0f766e;color:#fff;font-size:10px;font-weight:700;display:grid;place-items:center;line-height:1}',
    '.vp-gfoot{margin-top:13px}',
    '.vp-empty h5{font-size:13.5px;font-weight:700;margin-bottom:5px}',
    '.vp-empty p{font-size:11.5px;color:#3f5f5c;line-height:1.55;max-width:46ch;margin:0 auto}',
    '.vp-blockp{font-size:11.5px;line-height:1.55;color:#b45309;max-width:44ch;margin:10px auto 0}',
    '.vp-diag{margin:0 10px 10px;border:1px solid #cbe6e2;border-radius:8px;overflow:hidden}',
    '.vp-diag pre{font:10.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;background:#0f2e2c;color:#d8f5f1;padding:8px 9px;max-height:190px;overflow:auto}',
    '.vp-diag .vp-dbar{display:flex;gap:5px;padding:6px 8px;background:#f0fdfa;border-bottom:1px solid #dff5f2}',
    '.vp-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#0f2e2c;color:#fff;font:600 12px system-ui,sans-serif;padding:9px 14px;border-radius:8px;z-index:2147483647;box-shadow:0 6px 18px rgba(0,0,0,.2);transition:opacity .18s,translate .18s;translate:0 8px;opacity:0}',
    /* Rows fade in only when they are created. Score edits repaint without
       rebuilding the table, so a what-if row cannot re-animate under the
       cursor while you type in it. */
    '.vp-tbl tr.vp-new{animation:vpRowIn .3s cubic-bezier(.22,.9,.28,1) both}',
    '@keyframes vpRowIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
    '.vp-grade strong.vp-pop{animation:vpPop .34s cubic-bezier(.22,.9,.28,1)}',
    '@keyframes vpPop{45%{transform:scale(1.07)}}',
    '@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}:host{animation:none!important}}'
  ].join('');
  shadow.appendChild(style);

  var shell=document.createElement('div');
  shell.className='vp';
  shell.innerHTML=[
    '<div class="vp-h" data-drag>',
      '<span class="vp-logo" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12.5l3.3 3.3L17 8.8"/></svg></span>',
      '<span class="vp-hd"><b>VuePoint</b><em id="vp-src">&nbsp;</em></span>',
      '<span class="vp-pill" id="vp-state">&nbsp;</span>',
      '<button class="vp-x" data-act="close" title="Close (Esc)" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></button>',
    '</div>',
    '<div class="vp-b" id="vp-body">',
      '<div class="vp-note" id="vp-note"></div>',
      '<section class="vp-hero" id="vp-hero">',
        '<div class="vp-hero-top">',
          '<span class="vp-lab">Projected grade</span>',
          '<span id="vp-delta"></span>',
        '</div>',
        '<div class="vp-grade"><strong id="vp-pct">&mdash;</strong><span id="vp-letter">&mdash;</span></div>',
        '<div class="vp-pts" id="vp-pts">&mdash;</div>',
        /* dd before dt visually via `order`: the number is what you read, the
           label is what you check afterwards */
        '<dl class="vp-stats">',
          '<div><dt>StudentVUE</dt><dd id="vp-orig">&mdash;</dd></div>',
          '<div><dt>Total points</dt><dd id="vp-tp">&mdash;</dd></div>',
          '<div><dt>Weighted</dt><dd id="vp-wp">&mdash;</dd></div>',
        '</dl>',
      '</section>',
      '<div class="vp-ctl" id="vp-ctl">',
        '<div class="vp-seg" role="group" aria-label="Grading mode">',
          '<button data-act="mode" data-mode="weighted" id="vp-mw" aria-pressed="false">Weighted</button>',
          '<button data-act="mode" data-mode="total" id="vp-mt" aria-pressed="false">Total points</button>',
        '</div>',
        '<button class="vp-btn" data-act="rescan">Re-scan page</button>',
        '<button class="vp-btn" data-act="reset">Reset</button>',
      '</div>',
      '<section class="vp-sec" id="vp-wsec">',
        '<h4>Categories <span id="vp-wsum">&mdash;</span></h4>',
        '<div class="vp-wl" id="vp-wl"></div>',
        '<div class="vp-cta"><button class="vp-btn sm" data-act="addcat">+ Add category</button> <span class="vp-tip">0% or blank = excluded</span></div>',
        '<div class="vp-newcat" id="vp-nc" hidden>',
          '<input class="vp-i" id="vp-nci" placeholder="New category name" maxlength="40">',
          '<button class="vp-btn pri" data-act="nc-save">Add</button>',
          '<button class="vp-btn" data-act="nc-cancel">Cancel</button>',
        '</div>',
      '</section>',
      '<section class="vp-sec" id="vp-asec">',
        '<h4>Assignments <span id="vp-cnt2">0</span></h4>',
        '<div class="vp-scroll">',
          '<table class="vp-tbl">',
            '<thead><tr><th>Name</th><th>Category</th><th class="n">Score</th><th class="n">Out of</th><th></th></tr></thead>',
            '<tbody id="vp-rows"></tbody>',
          '</table>',
        '</div>',
        '<div class="vp-add">',
          '<input class="vp-i" id="vp-n" placeholder="Assignment name" maxlength="90">',
          '<select class="vp-i" id="vp-c"></select>',
          /* placeholders mirror the column headers right above, so the row
             reads as the next line of the table (and both fit the boxes) */
          '<input class="vp-i n" id="vp-e" type="number" step="0.5" placeholder="Score">',
          '<input class="vp-i n" id="vp-p" type="number" step="0.5" placeholder="Out of">',
          '<button class="vp-btn pri" data-act="add"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>Add</button>',
        '</div>',
      '</section>',
      /* Shown only when the page is not StudentVUE at all. The steps are the
         whole point: on the wrong tab there is no gradebook to read and no
         grade to compute, so the panel says how to get to one rather than
         pretending to be a gradebook. It is dropped the moment the portal
         appears, because the ticker re-checks for it. */
      '<section class="vp-sec vp-guide" id="vp-guide" hidden>',
        '<h5 id="vp-guide-h">Not on StudentVUE</h5>',
        '<p class="vp-gp">VuePoint reads the gradebook that is already on your screen. It has no login of its own, so it needs StudentVUE open first.</p>',
        '<ol class="vp-steps">',
          '<li><b>Open your school&rsquo;s StudentVUE site</b> in this tab and sign in.</li>',
          '<li><b>Click Grade Book</b> in the menu down the left side.</li>',
          '<li><b>Pick the class you want</b> and let its assignments load.</li>',
          '<li><b>Click the VuePoint bookmark again</b> in your bookmarks bar.</li>',
        '</ol>',
        '<div class="vp-gfoot"><button class="vp-btn" data-act="rescan">Re-scan page</button></div>',
      '</section>',
      /* Shown when the page has no gradebook on it at all - a class is not open,
         or StudentVUE is on some other screen. One sentence and one button: no
         report is generated here, so there is nothing to read or send. */
      '<section class="vp-sec vp-empty" id="vp-empty" hidden>',
        '<h5 id="vp-empty-h">No gradebook to read</h5>',
        '<p id="vp-empty-p">Open a class in StudentVUE so its gradebook is on screen, then press <b>Re-scan page</b>.</p>',
        '<p class="vp-blockp" id="vp-blocked" hidden></p>',
        '<div style="display:flex;justify-content:center;margin-top:12px">',
          '<button class="vp-btn pri" data-act="rescan">Re-scan page</button>',
        '</div>',
      '</section>',
      '<div class="vp-diag" id="vp-diag" hidden>',
        '<div class="vp-dbar"><button class="vp-btn" data-act="diag-deep">Deep scan</button><button class="vp-btn" data-act="diag-copy">Copy report</button><button class="vp-btn" data-act="diag-hide">Hide</button></div>',
        '<pre id="vp-diag-pre"></pre>',
      '</div>',
    '</div>',
    '<div class="vp-ft">',
      '<small>Local only &mdash; nothing is saved or sent.</small>',
      '<span class="vp-by">Made by Vansh Agarwal</span>',
    '</div>'
  ].join('');
  shadow.appendChild(shell);

  var mini=document.createElement('div');
  mini.className='vp-mini';
  mini.hidden=true;
  mini.innerHTML=
    '<button class="vp-mini-main" data-act="expand" title="Reopen VuePoint">'+
      '<span class="vp-logo" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12.5l3.3 3.3L17 8.8"/></svg></span>'+
      '<span>VuePoint</span>'+
    '</button>'+
    '<button class="vp-mini-x" data-act="close" title="Close VuePoint" aria-label="Close">'+
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>'+
    '</button>';
  shadow.appendChild(mini);

  function q(id){ return shadow.getElementById(id); }
  function all(sel,root){ return Array.prototype.slice.call((root||shadow).querySelectorAll(sel)); }

  /* ---------------------------- data plumbing ---------------------------- */

  function applyParsed(p){
    state.list=p.assignments.map(function(a){ return {name:a.name,category:a.category,earned:a.earned,possible:a.possible,ungraded:!!a.ungraded,hypothetical:false}; });
    state.weights={};
    for(var k in p.weights){ if(Object.prototype.hasOwnProperty.call(p.weights,k)) state.weights[k]=p.weights[k]; }
    for(var i=0;i<state.list.length;i++){
      var c=state.list[i].category||'Uncategorized';
      if(!(c in state.weights)) state.weights[c]=0;
    }
    if(!Object.keys(state.weights).length) state.weights={'Uncategorized':0};
    state.mode=p.modeGuess;
    state.original=p.originalPct;
    state.course=p.courseTitle||'';
    state.found=state.list.length>0;
    state.meta=p.meta||{};
    state.gradeInfo=p.gradeInfo||null;
    state.weightSource=p.weightSource||'none';
    state.onSV=p.onSV!==false;
    /* Off the portal there is no gradebook to read, so nothing a page contains
       counts as data. The landing page is the proof: its own markup (worked
       examples, percentages in the FAQ, numbered steps) read as four
       assignments and an 88% grade. Clearing the parse keeps a made-up grade out
       of the panel and out of the state the panel paints from. */
    if(!state.onSV){
      state.list=[];
      state.weights={'Uncategorized':0};
      state.original=null;
      state.found=false;
      state.gradeInfo=null;
      state.course='';
    }
    /* "A class is open" has to mean the portal actually named one. Synergy's
       page renders its gradebook panels before anything has been picked, so the
       panels on their own are not evidence - trusting them is what printed the
       advisory homeroom at the top of a page with no class open. A class with
       nothing posted yet is still named by the portal, so it still counts. */
    state.open=state.found||!!state.course;
    state.dirty=false;
  }

  function compute(){
    var tE=0,tP=0,i;
    for(i=0;i<state.list.length;i++){
      if(!gradedRow(state.list[i])) continue;
      tE+=Number(state.list[i].earned)||0;
      tP+=Number(state.list[i].possible)||0;
    }
    var byCat={};
    for(i=0;i<state.list.length;i++){
      var c=state.list[i].category||'Uncategorized';
      if(!byCat[c]) byCat[c]={e:0,p:0,n:0};
      if(gradedRow(state.list[i])){ byCat[c].e+=Number(state.list[i].earned)||0; byCat[c].p+=Number(state.list[i].possible)||0; }
      byCat[c].n++;
    }
    var totalPct=tP>0?tE/tP*100:null;
    var sumW=0,wSum=0,cats=[];
    for(var k in byCat){
      if(!Object.prototype.hasOwnProperty.call(byCat,k)) continue;
      var d=byCat[k], w=Math.max(0,Number(state.weights[k])||0);
      var pct=d.p>0?d.e/d.p*100:null;
      cats.push({name:k,weight:w,earned:d.e,possible:d.p,pct:pct,count:d.n});
      if(d.p>0&&w>0){ sumW+=w; wSum+=(d.e/d.p)*w; }
    }
    cats.sort(function(a,b){ return a.name.localeCompare(b.name); });
    var weightedPct=sumW>0?wSum/sumW*100:null;
    var current = state.mode==='weighted'
      ? (weightedPct!==null?weightedPct:totalPct)
      : (totalPct!==null?totalPct:weightedPct);
    return {earned:tE,possible:tP,totalPct:totalPct,weightedPct:weightedPct,current:current,cats:cats,sumW:sumW};
  }

  /* remembered so the projected grade animates only when it actually changes;
     otherwise every keystroke would make the number twitch */
  var lastPctText=null;

  function paint(){
    var c=compute();
    var offSite=!state.onSV;
    /* A page that is not StudentVUE has no gradebook on it, so anything the
       scraper happened to pull out of it is noise. The panel has to show either
       a gradebook or the walkthrough back to the portal, never both: showing
       both is what put a made-up grade next to the instructions. */
    var showGrade=state.found&&!offSite;
    var shownPct=showGrade?c.current:null;

    /* header. "No class selected" is reserved for pages with no class open at
       all: a class with nothing posted yet is still named by the portal, and
       saying otherwise there was a lie. A name is used whenever the portal gave
       one, and a class open with no readable name still says so. Off StudentVUE
       the header says that instead, because "no class selected" on an unrelated
       page would read as a bug in the panel rather than the wrong tab. */
    q('vp-src').textContent=state.onSV
      ?(state.open?(state.course||'Class open'):'No class selected')
      :'Not on StudentVUE';
    /* "Live" against a page that has no gradebook would be a lie, so the status
       pip goes away entirely off the portal. */
    var badge=q('vp-state');
    badge.hidden=offSite;
    badge.textContent=state.found?'Live':'Empty';
    badge.style.background=state.found?'rgba(255,255,255,.16)':'rgba(0,0,0,.22)';

    /* Advisory only, and hidden in the ordinary case. The success banner that
       used to sit here restated the counts and the grade box below it. */
    var note='';
    if(showGrade){
      if(state.weightSource==='none'){
        note='<b>No category weights on this page.</b> Grading on total points. Open Categories to enter weights.';
      }else if(state.mode==='weighted'&&c.sumW<=0){
        note='<b>Category weights are all zero.</b> Weighted mode falls back to total points &mdash; type weights under Categories to use it.';
      }
    }
    var noteEl=q('vp-note');
    noteEl.innerHTML=note;
    noteEl.hidden=!note;

    /* The unreadable-frame detail belongs with the empty state that explains a
       failed scan, not in a banner above it. */
    var blocked=(state.meta&&state.meta.blocked&&state.meta.blocked.length)||0;
    var blockedEl=q('vp-blocked');
    if(blockedEl){
      blockedEl.hidden=!(blocked&&!state.found);
      blockedEl.textContent=blocked?('This page has '+blocked+' frame'+(blocked===1?'':'s')+' I am not allowed to read, so the gradebook may be inside it.'):'';
    }

    /* big number */
    var pctEl=q('vp-pct'), letEl=q('vp-letter');
    var col=colorFor(shownPct);
    var pctText=(shownPct===null||!isFinite(shownPct))?'\u2014':r2(shownPct).toFixed(2)+'%';
    if(lastPctText!==null&&lastPctText!==pctText){
      pctEl.classList.remove('vp-pop');
      void pctEl.offsetWidth;          /* force a reflow so the pop restarts */
      pctEl.classList.add('vp-pop');
    }
    lastPctText=pctText;
    pctEl.textContent=pctText;
    pctEl.style.color=col;
    letEl.textContent=letterFor(shownPct);
    letEl.style.color=col;
    q('vp-pts').textContent=(state.found?r2(c.earned)+' / '+r2(c.possible)+' points':'');

    /* delta vs StudentVUE */
    var dEl=q('vp-delta');
    if(state.original===null||shownPct===null||!isFinite(shownPct)){
      dEl.innerHTML='';
    }else{
      var diff=shownPct-state.original;
      if(Math.abs(diff)<0.005){
        dEl.innerHTML='<span class="vp-delta" style="background:#dcfce7;color:#14532d">matches StudentVUE</span>';
      }else{
        var up=diff>0;
        dEl.innerHTML='<span class="vp-delta" style="background:'+(up?'#dcfce7':'#fee2e2')+';color:'+(up?'#14532d':'#7f1d1d')+'">'+
          (up?'\u25b2 +':'\u25bc ')+r2(diff).toFixed(2)+'% vs StudentVUE</span>';
      }
    }

    /* detail list */
    q('vp-orig').textContent=state.original===null?'not found':r2(state.original).toFixed(2)+'%';
    q('vp-tp').textContent=c.totalPct===null?'\u2014':r2(c.totalPct).toFixed(2)+'%';
    q('vp-wp').textContent=c.weightedPct===null?'\u2014':r2(c.weightedPct).toFixed(2)+'%';
    q('vp-cnt2').textContent=String(state.list.length);

    /* mode pressed states */
    q('vp-mw').setAttribute('aria-pressed',state.mode==='weighted'?'true':'false');
    q('vp-mt').setAttribute('aria-pressed',state.mode==='total'?'true':'false');

    /* weights */
    var sum=q('vp-wsum');
    sum.textContent=r2(c.sumW)+'% of 100';
    sum.style.color=(Math.abs(c.sumW-100)<0.5)?'#0f766e':(c.sumW>100?'#b91c1c':'#b45309');
    for(var i=0;i<c.cats.length;i++){
      var el=shadow.querySelector('[data-catpct="'+cssEscape(c.cats[i].name)+'"]');
      if(el) el.textContent=c.cats[i].pct===null?'no scores':r2(c.cats[i].pct).toFixed(1)+'%';
    }

    /* top-level visibility. The grading controls go too: with no gradebook on
       the page there is nothing to weight, nothing to re-scan and nothing to
       reset, and the empty state carries its own Re-scan button. */
    q('vp-hero').hidden=!showGrade;
    q('vp-ctl').hidden=!showGrade;
    q('vp-wsec').hidden=!showGrade;
    q('vp-asec').hidden=!showGrade;
    /* Two different situations wear the same empty panel, so it gets two
       messages: a class open with nothing posted to it yet, or no class open at
       all. Saying "no class" in the first case is what this fixes. */
    var eh=q('vp-empty-h'), ep=q('vp-empty-p');
    if(eh){
      eh.textContent=state.open?'No assignments to read yet':'No gradebook to read';
      ep.innerHTML=state.open
        ?'Nothing is posted for this class yet. Press <b>Re-scan page</b> to look again.'
        :'Open a class in StudentVUE so its gradebook is on screen, then press <b>Re-scan page</b>.';
    }
    /* Off StudentVUE there is nothing to read, weight or reset, so the panel
       shows the way back to the gradebook instead of a bare "no data" card (and
       certainly not a demo of controls that cannot do anything on this page). */
    var guideEl=q('vp-guide');
    if(guideEl) guideEl.hidden=!offSite;
    q('vp-empty').hidden=showGrade||offSite;
  }

  function cssEscape(s){ return String(s).replace(/["\\]/g,'\\$&'); }

  function catNames(){
    var seen={}, out=[];
    function push(n){
      n=norm(n);
      if(!n||seen[n]) return;
      seen[n]=1; out.push(n);
    }
    for(var k in state.weights){ if(Object.prototype.hasOwnProperty.call(state.weights,k)) push(k); }
    for(var i=0;i<state.list.length;i++) push(state.list[i].category);
    out.sort(function(a,b){ return a.localeCompare(b); });
    return out;
  }

  function renderWeights(){
    var wl=q('vp-wl');
    wl.innerHTML='';
    var cats=catNames();
    for(var i=0;i<cats.length;i++){
      var name=cats[i];
      var row=document.createElement('div');
      row.className='vp-wr';
      row.innerHTML=
        '<span class="vp-catn" title="'+esc(name)+'">'+esc(name)+'</span>'+
        '<input class="vp-i n" type="number" min="0" max="100" step="1" data-w="'+esc(name)+'" value="'+(Number(state.weights[name])||0)+'">'+
        '<em data-catpct="'+esc(name)+'">&mdash;</em>';
      wl.appendChild(row);
    }
    var sel=q('vp-c');
    var opts=cats.map(function(n){ return '<option value="'+esc(n)+'">'+esc(n)+'</option>'; }).join('');
    sel.innerHTML=opts+'<option value="__new__">+ New category&hellip;</option>';
  }

  function renderRows(){
    var tb=q('vp-rows');
    tb.innerHTML='';
    var frag=document.createDocumentFragment();
    for(var i=0;i<state.list.length;i++){
      var a=state.list[i];
      var tr=document.createElement('tr');
      if(a.hypothetical) tr.className='hypo';
      tr.setAttribute('data-i',String(i));
      var opts=catNames().map(function(n){
        return '<option value="'+esc(n)+'"'+(n===a.category?' selected':'')+'>'+esc(n)+'</option>';
      }).join('');
      tr.innerHTML=
        '<td><input class="vp-i" data-f="name" value="'+esc(a.name)+'" maxlength="90"></td>'+
        '<td class="cat"><select class="vp-i" data-f="category">'+opts+'<option value="__new__">+ New&hellip;</option></select></td>'+
        /* step="any": real StudentVUE points carry four decimals ("10.0000"),
           and a fixed step flags those values as invalid. A blank score must
           render as an empty box, never the text "null". */
        '<td class="sc n"><input class="vp-i n" data-f="earned" type="number" step="any" value="'+(a.earned===null||a.earned===undefined?'':a.earned)+'"></td>'+
        '<td class="sc n"><input class="vp-i n" data-f="possible" type="number" step="any" min="0" value="'+(a.possible===null||a.possible===undefined?'':a.possible)+'"></td>'+
        '<td class="rm"><button class="vp-del" data-act="del" title="Remove" aria-label="Remove">'+
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>'+
        '</button></td>';
      frag.appendChild(tr);
    }
    tb.appendChild(frag);
  }

  function renderAll(){
    renderWeights();
    renderRows();
    paint();
  }

  /* ------------------------------- toast ------------------------------- */

  var toastTimer=null;
  function toast(msg){
    var t=q('vp-toast');
    if(!t){
      t=document.createElement('div');
      t.id='vp-toast';
      t.className='vp-toast';
      shadow.appendChild(t);
    }
    t.textContent=msg;
    requestAnimationFrame(function(){ t.style.opacity='1'; t.style.translate='0 0'; });
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){ t.style.opacity='0'; t.style.translate='0 8px'; },2200);
  }

  /* ---------------------------- diagnostics ---------------------------- */

  function diagText(){
    var m=state.meta||{};
    var nl=String.fromCharCode(10);
    var L=[];
    L.push('VuePoint report');
    L.push('url: '+location.href);
    L.push('page title: '+document.title);
    L.push('agent: '+navigator.userAgent);
    L.push('');
    L.push('documents read: '+(m.docs||1));
    L.push('frames I could not read (different origin): '+((m.blocked&&m.blocked.length)?m.blocked.join('  |  '):'none'));
    L.push('tables: '+(m.tables||0)+'   role grids: '+(m.roleGrids||0)+'   row groups: '+(m.rowGroups||0));
    L.push('candidate blocks: '+(m.candidates||0)+'   passed the gradebook test: '+(m.viable||0));
    L.push('chosen block: '+(m.bestKind||'none')+'  score '+(m.bestScore||0)+'  rows '+(m.rowsScanned||0)+'  headerRow '+(m.headerRow===undefined?-1:m.headerRow));
    L.push('header cells: '+((m.headerTexts&&m.headerTexts.length)?JSON.stringify(m.headerTexts):'(none)'));
    L.push('column roles:  '+((m.roles&&m.roles.length)?JSON.stringify(m.roles):'(none)'));
    L.push('');
    L.push('assignments parsed: '+state.list.length);
    L.push('categories: '+JSON.stringify(state.weights));
    L.push('weights: source '+(m.weightSource||'none')+'  sum '+(m.weightSum===undefined?'-':m.weightSum));
    L.push('grade shown on page: '+(state.original===null?'not found':r2(state.original)+'%')+((state.gradeInfo&&state.gradeInfo.font)?'  (font '+state.gradeInfo.font+'px)':''));
    L.push('grade context: '+((state.gradeInfo&&state.gradeInfo.ctx)||'-'));
    L.push('course heading: '+(state.course||'-'));
    var blks=m.top||[];
    for(var i=0;i<blks.length;i++){
      var b=blks[i];
      L.push('');
      L.push('block '+i+': '+b.kind+'  <'+b.tag+'>  rows='+b.rows+'  cols='+b.cols+'  scoredRows='+b.scored+'  score='+b.score);
      for(var j=0;j<b.sample.length;j++) L.push('    row '+j+': '+JSON.stringify(b.sample[j]));
    }
    if(state.list.length){
      L.push('');
      L.push('parsed rows:');
      for(var k=0;k<Math.min(state.list.length,15);k++){
        L.push('    '+JSON.stringify(state.list[k].name)+'  cat='+JSON.stringify(state.list[k].category)+'  '+state.list[k].earned+'/'+state.list[k].possible);
      }
    }
    return L.join(nl);
  }

  /* --------------------- deep scan: impartial DOM dump --------------------- */
  /* diagText() above only describes the blocks the parser already decided to
     consider. If the gradebook is a shape the parser never looked at, that
     report is silent about the very thing that is broken - it just says
     "candidates: 0". This walks the page with no assumptions at all and prints
     what is genuinely there, so the exact structure can be fixed.

     Prose is redacted (titles and names become "text:N") while numbers,
     percents and "18 / 20" scores stay verbatim, so the result is safe to
     paste in public and still contains everything the parser needs. */

  function descEl(el){
    if(!el) return '(none)';
    var tag='?', id='', cls='';
    try{ tag=String(el.tagName||'?').toLowerCase(); }catch(e){}
    try{ if(el.id) id='#'+el.id; }catch(e){}
    try{
      var c=el.getAttribute?el.getAttribute('class'):'';
      if(c) cls='.'+String(c).replace(/\s+/g,' ').trim().split(' ').slice(0,3).join('.');
      var role=el.getAttribute?el.getAttribute('role'):'';
      if(role) cls+='[role='+role+']';
    }catch(e){}
    return tag+id+cls;
  }

  /* keep=true is for labels - header cells and page chrome - which are
     structural and carry no personal data, so they must survive verbatim or the
     report is useless. Data rows use keep=false: a title or a name there is the
     student's own content, so only its length survives. */
  function shapeText(t,keep){
    t=String(t===null||t===undefined?'':t).replace(/\s+/g,' ').trim();
    if(!t) return '';
    if(keep) return t.length>34?t.slice(0,34)+'\u2026':t;
    if(/^[0-9.,%/+\-\u2013\u2014\s]+$/.test(t)) return t.slice(0,18);
    if(t.length<=3) return t;
    return '\u00abtext:'+t.length+'\u00bb';
  }

  function cntIn(root,sel){ try{ return root.querySelectorAll(sel).length; }catch(e){ return 0; } }

  function siblingGroups(d,L){
    var els=[];
    try{ els=d.querySelectorAll('div,ul,ol,section,dl,form'); }catch(e){}
    var found=0;
    for(var i=0;i<els.length&&found<8;i++){
      var el=els[i];
      if(!el.children||el.children.length<3||el.children.length>400) continue;
      if(!shown(el)) continue;
      var inTable=null;
      try{ inTable=el.closest('table'); }catch(e){}
      if(inTable) continue;
      var kids=el.children, sig={}, best='', bestN=0, j;
      for(j=0;j<kids.length;j++){
        /* ignore ids when comparing: repeated rows differ only by index */
        var s=descEl(kids[j]).replace(/#[^.\[]*/,'');
        sig[s]=(sig[s]||0)+1;
      }
      for(var key in sig) if(sig[key]>bestN){ bestN=sig[key]; best=key; }
      if(bestN<3) continue;
      var sample=null;
      for(j=0;j<kids.length;j++){
        if(descEl(kids[j]).replace(/#[^.\[]*/,'')===best){ sample=kids[j]; break; }
      }
      if(!sample||sample.children.length<2) continue;
      var cells=[];
      for(j=0;j<sample.children.length;j++) cells.push(shapeText(elText(sample.children[j])));
      L.push('   GROUP '+descEl(el)+'  children='+kids.length+'  repeated '+bestN+'x as '+best);
      L.push('      sample row: '+JSON.stringify(cells));
      found++;
    }
    if(!found) L.push('   (none)');
  }

  function docScan(d,i,L){
    L.push('');
    L.push('================= document '+i+' =================');
    L.push('body: '+descEl(d.body||d.documentElement));
    var ts=[], fs=[];
    try{ ts=d.querySelectorAll('table'); }catch(e){}
    try{ fs=d.querySelectorAll('iframe,frame'); }catch(e){}
    L.push('elements: '+cntIn(d,'*')+'   tables: '+ts.length+'   iframes: '+fs.length+
           '   role=grid|table: '+cntIn(d,'[role="grid"],[role="table"]'));

    var a,t,rs,c,hs,r,cs,k;
    for(a=0;a<ts.length&&a<12;a++){
      t=ts[a];
      rs=t.rows||[];
      c=(rs.length&&rs[0].cells)?rs[0].cells.length:0;
      L.push('');
      L.push('TABLE['+a+'] '+descEl(t)+'  rows='+rs.length+'  cols='+c+
             '  visible='+(shown(t)?'yes':'NO')+'  thead='+(t.tHead?'yes':'no')+
             (t.caption?'  caption='+shapeText(t.caption.textContent):''));
      hs=[];
      if(rs.length&&rs[0].cells) for(k=0;k<rs[0].cells.length;k++) hs.push(shapeText(elText(rs[0].cells[k]),true));
      L.push('   row0 (headers, verbatim): '+JSON.stringify(hs));
      for(r=1;r<rs.length&&r<=3;r++){
        cs=[];
        if(rs[r].cells) for(k=0;k<rs[r].cells.length;k++) cs.push(shapeText(elText(rs[r].cells[k])));
        L.push('   row'+r+': '+JSON.stringify(cs));
      }
    }

    var gs=[];
    try{ gs=d.querySelectorAll('[role="grid"],[role="table"]'); }catch(e){}
    for(a=0;a<gs.length&&a<6;a++){
      var g=gs[a], rEls=[];
      try{ rEls=g.querySelectorAll('[role="row"]'); }catch(e){}
      L.push('');
      L.push('GRID['+a+'] '+descEl(g)+'  visible='+(shown(g)?'yes':'NO')+'  rows='+rEls.length+
             '  cells='+cntIn(g,'[role="gridcell"],[role="cell"],[role="columnheader"],[role="rowheader"]'));
      for(r=0;r<rEls.length&&r<4;r++){
        var cl=[], fc=[];
        try{ fc=rEls[r].querySelectorAll('[role="gridcell"],[role="cell"],[role="columnheader"],[role="rowheader"]'); }catch(e){}
        for(k=0;k<fc.length;k++) cl.push(shapeText(elText(fc[k]),r===0));
        L.push('   row'+r+(r===0?' (headers, verbatim)':'')+': '+JSON.stringify(cl));
      }
    }

    L.push('');
    L.push('--- repeated sibling groups (pages with no usable <table>) ---');
    siblingGroups(d,L);

    L.push('');
    L.push('--- elements whose entire text is a percentage ---');
    var pe=[];
    try{ pe=d.querySelectorAll('td,span,div,strong,b,em,i,p,a'); }catch(e){}
    var cap=0;
    for(a=0;a<pe.length&&cap<10;a++){
      var el=pe[a];
      if(el.children.length) continue;
      var txt=elText(el).replace(/\s+/g,'');
      if(!/^[0-9]{1,3}(\.[0-9]{1,4})?%$/.test(txt)) continue;
      var st=null;
      try{ st=(d.defaultView||window).getComputedStyle(el); }catch(e){}
      L.push('   '+descEl(el)+' = '+txt+'  font='+(st?st.fontSize+'/'+st.fontWeight:'?')+'  parent='+descEl(el.parentNode));
      cap++;
    }
    if(!cap) L.push('   (none)');

    L.push('');
    L.push('--- class/id names that look gradebook-ish ---');
    var hs2=[];
    /* both class and id: StudentVUE is as likely to name a node tbAssignments
       as it is to class it. A hidden grading period lives in here too. */
    try{ hs2=d.querySelectorAll('[class*="grade" i],[class*="score" i],[class*="assign" i],[class*="mark" i],[class*="category" i],[class*="weight" i],[class*="course" i],[class*="period" i],[id*="grade" i],[id*="score" i],[id*="assign" i],[id*="mark" i],[id*="cat" i],[id*="weight" i],[id*="course" i],[id*="period" i]'); }catch(e){}
    if(!hs2.length) L.push('   (none)');
    for(a=0;a<hs2.length&&a<16;a++){
      L.push('   '+descEl(hs2[a])+'  children='+hs2[a].children.length+'  textlen='+(hs2[a].textContent||'').length);
    }

    /* The visible text, line by line. This is the highest-signal part of the
       report: it says whether the page is even a gradebook, and which of its
       labels the parser should have matched. Line-truncated so a long blob
       cannot drown the structure. */
    L.push('');
    L.push('--- visible page text, first 40 lines ---');
    var it='';
    try{ it=String((d.body&&d.body.innerText)||''); }catch(e){}
    L.push('   total length='+it.length);
    var raw=[], ln=[];
    try{ raw=it.split(/\n+/); }catch(e){}
    for(a=0;a<raw.length&&ln.length<40;a++){
      var s=raw[a].replace(/\s+/g,' ').trim();
      if(!s) continue;
      if(s.length>72) s=s.slice(0,72)+'\u2026';
      ln.push(s);
    }
    if(!ln.length) L.push('   (empty)');
    for(a=0;a<ln.length;a++) L.push('   | '+ln[a]);
  }

  function deepScanText(){
    var NL=String.fromCharCode(10);
    var L=[], docs=collectDocs();
    L.push('VuePoint deep scan');
    L.push('url: '+location.href);
    L.push('title: '+document.title);
    L.push('agent: '+navigator.userAgent);
    L.push('documents reachable: '+docs.length);
    L.push('frames NOT readable (other origin): '+(BLOCKED_FRAMES.length?BLOCKED_FRAMES.join('  |  '):'none'));
    L.push('');
    L.push('How to read this: numbers, percents and "18 / 20" scores are verbatim.');
    L.push('Header cells and visible page text are verbatim too - they are labels.');
    L.push('\u00abtext:N\u00bb marks an assignment title or name that was redacted.');
    for(var i=0;i<docs.length;i++) docScan(docs[i],i,L);
    return L.join(NL);
  }

  /* ---------------------------- interactions ---------------------------- */

  /* --------------------- survive the page's own repaint ---------------------

     Synergy rebuilds its shell from Knockout whenever you move around the
     portal, and a rebuild can take our element out with the old subtree. Putting
     it back is the whole difference between the panel - or the folded pill -
     quietly vanishing and still being there afterwards. This only ever
     re-parents an element that already exists, so it can never duplicate the
     panel or resurrect one that was closed on purpose. */
  function attachHost(){
    /* never fight a close: the element is on its way out on purpose */
    if(host.getAttribute('data-closing')) return;
    var parent=document.body||document.documentElement;
    if(parent&&host.parentNode!==parent) parent.appendChild(host);
  }
  var reattach=null;
  try{
    reattach=new MutationObserver(function(){ attachHost(); });
    reattach.observe(document.documentElement,{childList:true,subtree:true});
  }catch(e){}

  /* ------------------------- fold / unfold ------------------------- */

  /* Clicking anywhere off the panel folds it into a small chip that offers the
     two choices - reopen, or dismiss. The chip's own unhide replays its unfold
     animation, and unhiding the shell replays vpIn, so neither needs a class
     juggle beyond the fold-out. */
  var PANEL_W='min(600px,calc(100% - 32px))';
  var collapsed=false, folding=false, preFold=null;

  /* The chip rests in the top-right corner of the screen. This only re-anchors
     the host; the visible travelling is done by the shell's vpFold animation
     and the chip's vpUnfold, both of which lean towards that corner. */
  function pinCorner(){
    host.style.left='auto';
    host.style.right='16px';
    host.style.top='18px';
    host.style.bottom='auto';
    host.style.transform='none';
    /* the ambient float would otherwise drift the chip under the pointer */
    host.style.animation='none';
  }

  function collapse(){
    if(collapsed||folding||host.getAttribute('data-closing')) return;
    folding=true;
    /* Remember exactly how the panel was placed - centred, or wherever it was
       dragged to - so expand() can put it back there rather than always
       recentring something the user positioned by hand. */
    preFold={left:host.style.left,top:host.style.top,right:host.style.right,
             bottom:host.style.bottom,transform:host.style.transform,
             animation:host.style.animation};
    shell.classList.add('vp-fold');
    setTimeout(function(){
      shell.classList.remove('vp-fold');
      shell.hidden=true;
      /* The move happens only now, with the shell already invisible. Re-anchor
         first and the panel would be seen jumping to the corner before it had
         a chance to fade out of the middle. */
      pinCorner();
      host.style.width='auto';
      mini.hidden=false;
      collapsed=true; folding=false;
    },190);
  }

  function expand(){
    if(!collapsed||folding||host.getAttribute('data-closing')) return;
    /* Same reasoning, reversed: put the host back before revealing the shell,
       so the panel is never drawn mid-jump. */
    if(preFold){
      host.style.left=preFold.left||'auto';
      host.style.top=preFold.top;
      host.style.right=preFold.right;
      host.style.bottom=preFold.bottom||'auto';
      host.style.transform=preFold.transform;
      host.style.animation=preFold.animation;
      preFold=null;
    }
    host.style.width=PANEL_W;
    mini.hidden=true;
    shell.hidden=false;
    collapsed=false;
    paint();
  }

  /* Capture phase, so a page that stops propagation on its own clicks cannot
     keep the panel open. Clicks inside the shadow retarget to the host, so
     host.contains() is the whole test. */
  function onDocClick(e){
    if(host.getAttribute('data-closing')) return;
    if(host===e.target||host.contains(e.target)) return;
    collapse();
  }
  document.addEventListener('click',onDocClick,true);

  function closePanel(){
    if(host.getAttribute('data-closing')) return;
    host.setAttribute('data-closing','1');
    var gone=false;
    function finish(){
      if(gone) return;
      gone=true;
      try{ if(window.__vuepointUnmount) window.__vuepointUnmount(); }catch(e){}
      window.__vuepointUnmount=null;
      if(host.parentNode) host.parentNode.removeChild(host);
    }
    /* Whatever is on screen right now is what fades out - the panel normally,
       the chip when it was closed from the folded state. */
    var target=collapsed?mini:shadow.querySelector('.vp');
    if(!target){ finish(); return; }
    /* The timer is the real guarantee: reduced-motion turns the animation off,
       so animationend never fires. */
    host.style.pointerEvents='none';
    target.classList.add('vp-out');
    target.addEventListener('animationend',function(e){
      /* child animations bubble up here, so match this element's own vpOut */
      if(e.target===target&&e.animationName==='vpOut') finish();
    });
    setTimeout(finish,300);
  }

  function rescan(quiet){
    var p=parseAll();
    var had=state.found;
    applyParsed(p);
    renderAll();
    if(!quiet) toast(!state.onSV?'Still not on StudentVUE.':(state.found?('Re-read '+state.list.length+' assignments.'):'No assignment table found.'));
    return had;
  }

  function askNewCat(pending){
    state.pendingRow=pending;
    q('vp-nc').hidden=false;
    q('vp-nci').value='';
    try{ q('vp-nci').focus(); }catch(e){}
  }
  function closeNewCat(){
    state.pendingRow=null;
    q('vp-nc').hidden=true;
  }
  function saveNewCat(){
    var name=cleanCat(q('vp-nci').value);
    if(!name){ closeNewCat(); return; }
    if(!(name in state.weights)) state.weights[name]=0;
    if(state.pendingRow!==null&&state.list[state.pendingRow]) state.list[state.pendingRow].category=name;
    state.dirty=true;
    closeNewCat();
    renderAll();
  }

  function addAssignment(){
    var name=norm(q('vp-n').value)||'New assignment';
    var cat=q('vp-c').value;
    if(cat==='__new__'){ askNewCat(null); return; }
    var earned=num(q('vp-e').value);
    var possible=num(q('vp-p').value);
    if(possible===null||possible<=0){ toast('Enter a "Possible" value above 0.'); return; }
    if(earned===null) earned=0;
    if(!(cat in state.weights)) state.weights[cat]=0;
    state.list.push({name:name.slice(0,90),category:cat||'Uncategorized',earned:earned,possible:possible,hypothetical:true});
    state.dirty=true;
    q('vp-n').value=''; q('vp-e').value=''; q('vp-p').value='';
    renderAll();
    /* the row just added slides in. renderRows() rebuilds the tbody, so this
       class lives for one render only and never replays on a score edit. */
    var fresh=q('vp-rows').lastElementChild;
    if(fresh) fresh.classList.add('vp-new');
    try{ q('vp-n').focus(); }catch(e){}
  }

  /* one delegated listener per event type - survives every re-render */
  shadow.addEventListener('click',function(e){
    /* closest(), not a direct read. The close button's visible cross is an SVG
       <path>, so clicking the glyph itself left e.target on the path, which has
       no data-act - the handler bailed and the button needed a second click.
       Only a click landing on the button's own padding appeared to work. */
    var hit=(e.target&&e.target.closest)?e.target.closest('[data-act]'):null;
    var act=hit?hit.getAttribute('data-act'):null;
    if(!act) return;
    e.preventDefault();
    e.stopPropagation();
    if(act==='close'){ closePanel(); return; }
    if(act==='expand'){ expand(); return; }
    if(act==='mode'){ state.mode=hit.getAttribute('data-mode'); paint(); return; }
    if(act==='rescan'){
      if(state.dirty&&!window.confirm('Re-read the page and discard your edits?')) return;
      rescan(false);
      return;
    }
    if(act==='reset'){
      if(state.dirty&&!window.confirm('Discard all of your edits?')) return;
      rescan(false);
      toast('Reset to what StudentVUE shows.');
      return;
    }
    if(act==='add'){ addAssignment(); return; }
    if(act==='addcat'){ askNewCat(null); return; }
    if(act==='nc-save'){ saveNewCat(); return; }
    if(act==='nc-cancel'){ closeNewCat(); return; }
    if(act==='del'){
      var tr=hit.closest('tr[data-i]');
      if(!tr) return;
      state.list.splice(parseInt(tr.getAttribute('data-i'),10),1);
      state.dirty=true;
      renderAll();
      return;
    }
    if(act==='diag'){
      var d=q('vp-diag');
      d.hidden=!d.hidden;
      if(!d.hidden) q('vp-diag-pre').textContent=diagText();
      var db=shadow.querySelector('[data-act="diag"]');
      if(db) db.textContent=d.hidden?'Diagnostics':'Hide report';
      return;
    }
    if(act==='diag-hide'){
      q('vp-diag').hidden=true;
      var db2=shadow.querySelector('[data-act="diag"]');
      if(db2) db2.textContent='Diagnostics';
      return;
    }
    if(act==='diag-deep'){
      /* the impartial dump - reports the DOM as it is, including shapes the
         parser never considered a candidate */
      var dbox=q('vp-diag'), dpre=q('vp-diag-pre');
      dbox.hidden=false;
      dpre.textContent=deepScanText();
      dpre.setAttribute('data-report','deep');
      var db3=shadow.querySelector('[data-act="diag"]');
      if(db3) db3.textContent='Hide report';
      toast('Deep scan done - press Copy report.');
      return;
    }
    if(act==='diag-copy'){
      /* copy whatever is actually on screen, whatever produced it */
      var pre=q('vp-diag-pre'), box=q('vp-diag');
      var shownTxt=(box&&!box.hidden&&pre)?pre.textContent:'';
      var txt=shownTxt||diagText();
      try{
        if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(txt);
        else{
          var ta=document.createElement('textarea');
          ta.value=txt; host.appendChild(ta); ta.select();
          document.execCommand('copy'); host.removeChild(ta);
        }
        toast('Diagnostics copied.');
      }catch(err){ toast('Copy failed - open Diagnostics to read it.'); }
      return;
    }
  },true);

  shadow.addEventListener('input',function(e){
    var t=e.target;
    if(!t||!t.getAttribute) return;
    var f=t.getAttribute('data-f');
    if(f){
      var tr=t.closest('tr[data-i]');
      if(!tr) return;
      var a=state.list[parseInt(tr.getAttribute('data-i'),10)];
      if(!a) return;
      if(f==='name') a.name=String(t.value).slice(0,90);
      else if(f==='earned'){ a.earned=num(t.value)===null?0:num(t.value); }
      else if(f==='possible'){ var pv=num(t.value); a.possible=pv===null?0:Math.max(0,pv); }
      state.dirty=true;
      paint();                       /* numbers only - the input keeps focus */
      return;
    }
    var w=t.getAttribute('data-w');
    if(w!==null&&w!==undefined){
      var v=num(t.value);
      state.weights[w]=(v===null||v<0)?0:Math.min(100,v);
      state.dirty=true;
      paint();
    }
  },true);

  shadow.addEventListener('change',function(e){
    var t=e.target;
    if(!t||!t.getAttribute) return;
    var f=t.getAttribute('data-f');
    if(f==='category'){
      var tr=t.closest('tr[data-i]');
      if(!tr) return;
      var idx=parseInt(tr.getAttribute('data-i'),10);
      var a=state.list[idx];
      if(!a) return;
      var v=t.value;
      if(v==='__new__'){ askNewCat(idx); return; }
      a.category=v;
      if(!(v in state.weights)) state.weights[v]=0;
      state.dirty=true;
      renderAll();
      return;
    }
    if(f==='earned'||f==='possible'){
      var tr2=t.closest('tr[data-i]');
      if(!tr2) return;
      var a2=state.list[parseInt(tr2.getAttribute('data-i'),10)];
      if(!a2) return;
      var nv=num(t.value);
      if(f==='earned') a2.earned=nv===null?0:nv;
      else a2.possible=nv===null?0:Math.max(0,nv);
      state.dirty=true;
      paint();
    }
  },true);

  shadow.addEventListener('keydown',function(e){
    if(e.key==='Escape'){ closePanel(); return; }
    if(e.key==='Enter'&&e.target&&e.target.id==='vp-nci'){ saveNewCat(); return; }
    if(e.key==='Enter'&&e.target&&(e.target.id==='vp-n'||e.target.id==='vp-e'||e.target.id==='vp-p')){
      addAssignment();
    }
  },true);

  /* drag by the header, never by its buttons */
  (function(){
    var handle=shadow.querySelector('[data-drag]');
    if(!handle) return;
    var sx=0,sy=0,ox=0,oy=0,dragging=false;
    handle.addEventListener('pointerdown',function(e){
      if(e.button!==undefined&&e.button!==0) return;
      var t=e.target;
      if(t&&t.closest&&t.closest('button,input,select,a,label')) return;
      dragging=true;
      try{ handle.setPointerCapture(e.pointerId); }catch(err){}
      var r=host.getBoundingClientRect();
      sx=e.clientX; sy=e.clientY; ox=r.left; oy=r.top;
      /* switch off the vertical-centring transform before taking over with
         absolute coordinates, or the panel jumps on first drag */
      host.style.transform='none';
      /* the ambient float lives on a shadow-root :host animation; kill it while
         the panel is being positioned by hand or it fights the drag */
      host.style.animation='none';
      host.style.right='auto'; host.style.bottom='auto';
      host.style.left=ox+'px'; host.style.top=oy+'px';
      handle.style.cursor='grabbing';
    });
    handle.addEventListener('pointermove',function(e){
      if(!dragging) return;
      host.style.left=Math.max(0,(ox+e.clientX-sx))+'px';
      host.style.top=Math.max(0,(oy+e.clientY-sy))+'px';
    });
    function stop(){
      if(!dragging) return;
      dragging=false;
      handle.style.cursor='grab';
      try{ handle.releasePointerCapture&&handle.releasePointerCapture(); }catch(e){}
    }
    handle.addEventListener('pointerup',stop);
    handle.addEventListener('pointercancel',stop);
  })();

  /* ------------------- keep up with class navigation ------------------- */

  /* Cheap fingerprint of what the page currently says. Sampling the head and
     tail as well as the length catches a class swap that happens to be the
     same size, without walking every node on a timer. */
  function pageSig(){
    var s=document.title+'|'+location.href+'|';
    var docsNow=collectDocs();
    for(var i=0;i<docsNow.length;i++){
      var b=docsNow[i].body;
      var t=(b&&b.textContent)?b.textContent:'';
      s+=t.length+':'+t.slice(0,140)+':'+t.slice(-140)+'|';
    }
    return s;
  }

  /* Identity of what is on screen: the page itself plus the class Synergy names
     right now. A change to either means the student switched period or moved to
     another gradebook page, which is when the panel should get out of the way. */
  function pageId(){ return location.href+'|'+(findCourse(collectDocs())||''); }

  /* Fold into the corner chip, and say why - the panel vanishing on its own
     would otherwise look like it had crashed. */
  function foldAway(msg){
    if(collapsed||host.getAttribute('data-closing')) return;
    collapse();
    toast(msg);
  }

  var sig=null, gbId=null;
  var ticker=setInterval(function(){
    /* the page repaints on its own schedule, so check on a timer as well as
       through the observer - older browsers without MutationObserver still
       keep the pill this way */
    attachHost();
    /* and whatever the page did, a folded panel stays folded: the shell hidden
       and the chip showing. Nothing else in the ticker is allowed to reopen or
       hide the chip. */
    if(collapsed){
      if(!shell.hidden) shell.hidden=true;
      if(mini.hidden) mini.hidden=false;
    }
    /* On a page that is not StudentVUE nothing the page does can change what
       the panel shows, and reading a whole document's text on a timer is not
       free, so only the cheap "is it the portal yet" probe re-runs here.
       Navigating into StudentVUE in this tab is picked up by the next tick. */
    if(!state.onSV){
      if(looksLikeStudentVue()) rescan(true);
      return;
    }
    var s=pageSig();
    /* The first tick only records the baseline. Boot has to have finished
       painting before "what is on screen" means anything, and the interval
       runs after it. */
    if(sig===null){ sig=s; gbId=pageId(); return; }
    if(s===sig) return;
    sig=s;

    if(state.dirty){
      /* The class name is page metadata, not the user's data, so it refreshes
         even while edits are locked. Synergy switches classes over AJAX without
         a reload, so the header would otherwise keep naming whichever period the
         page (or your first scan) started on. */
      var liveName=findCourse(collectDocs());
      if(liveName&&liveName!==state.course){ state.course=liveName; paint(); }
      var dirtyId=pageId();
      if(dirtyId!==gbId){
        /* A real switch. These edits were made against the class you just left,
           so they cannot carry over - folding makes that obvious instead of
           silently showing one class's what-ifs under another class's name. */
        gbId=dirtyId;
        rescan(true);
        foldAway('Switched class - VuePoint is folded in the corner.');
        return;
      }
      return;                             /* but never clobber the user's edits */
    }

    var before=state.list.length;
    rescan(true);
    var id=pageId();
    if(id!==gbId){
      gbId=id;
      foldAway('Switched class - VuePoint is folded in the corner.');
      return;
    }
    if(state.found&&state.list.length!==before) toast('Page changed - re-read '+state.list.length+' assignments.');
  },1500);
  var stopTicker=setTimeout(function(){ clearInterval(ticker); },10*60*1000);

  window.__vuepointUnmount=function(){
    clearInterval(ticker);
    clearTimeout(stopTicker);
    if(toastTimer) clearTimeout(toastTimer);
    if(reattach){ try{ reattach.disconnect(); }catch(e){} reattach=null; }
    document.removeEventListener('click',onDocClick,true);
  };

  /* ------------------------------- boot ------------------------------- */

  applyParsed(parseAll());
  renderAll();
  try{ host.setAttribute('data-vuepoint-version','1.1'); }catch(e){}
}

/* =============================== fatal path =============================== */

function fatal(err){
  var box=document.getElementById('vuepoint-root');
  if(!box){
    box=document.createElement('div');
    box.id='vuepoint-root';
    box.style.cssText='position:fixed;top:18px;right:18px;z-index:2147483647;width:min(430px,96vw);';
    (document.body||document.documentElement).appendChild(box);
  }
  var sh=box.shadowRoot||box.attachShadow({mode:'open'});
  var msg=(err&&(err.message||err.toString()))||'unknown error';
  sh.innerHTML='<div style="background:#fff;border:1px solid #fecaca;border-radius:12px;padding:14px 16px;font:12.5px/1.5 system-ui,sans-serif;color:#7f1d1d;box-shadow:0 8px 24px rgba(0,0,0,.18)">'+
    '<b style="font-size:13px">VuePoint could not start</b>'+
    '<div style="margin-top:6px;color:#3f5f5c">The page blocked part of the script. Nothing on the page was changed.</div>'+
    '<pre style="margin-top:8px;white-space:pre-wrap;font:11px/1.4 ui-monospace,monospace;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px">'+esc(msg)+'</pre>'+
    '<div style="margin-top:8px"><button id="vp-fatal-close" style="border:1px solid #fecaca;background:#fff;border-radius:6px;padding:5px 10px;font:600 12px system-ui;cursor:pointer">Close</button></div>'+
    '</div>';
  try{ sh.getElementById('vp-fatal-close').onclick=function(){ if(box.parentNode) box.parentNode.removeChild(box); }; }catch(e){}
}

/* start only once every helper above has been initialised */
try{ run(); }catch(err){ fatal(err); }

})();
