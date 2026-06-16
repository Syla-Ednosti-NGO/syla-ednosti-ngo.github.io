/* ==========================================================================
   Mockup QA audit — run in the browser/preview via preview_eval.
   Returns a report of likely-broken UI in a generated mockup, so issues are
   caught & fixed BEFORE a human reviews. Checks:
     1. contrast   — text vs effective background, WCAG ratio < threshold
     2. overflow   — clipped text (scrollWidth > clientWidth on clipped boxes)
     3. svgClip    — <text> wider than its svg/backing shape
     4. outOfBounds— elements extending beyond their section
     5. tiny       — text < 11px
     6. pageScroll — horizontal page overflow
   Usage: auditAll() audits every #vN .showcase via showVar(); or audit(rootEl).
   ========================================================================== */
(function (global) {
  const parse = c => { const m=(c||'').match(/rgba?\(([^)]+)\)/); if(!m) return null; const p=m[1].split(',').map(parseFloat); return [p[0],p[1],p[2],p[3]==null?1:p[3]]; };
  const lum = ([r,g,b]) => { const f=v=>{v/=255; return v<=.03928? v/12.92 : Math.pow((v+.055)/1.055,2.4);}; return .2126*f(r)+.7152*f(g)+.0722*f(b); };
  const ratio = (a,b) => { const L1=lum(a),L2=lum(b),hi=Math.max(L1,L2),lo=Math.min(L1,L2); return (hi+.05)/(lo+.05); };
  const effBg = el => { let e=el; while(e){ const s=getComputedStyle(e); const c=parse(s.backgroundColor); if(c&&c[3]>0) return [c[0],c[1],c[2]]; e=e.parentElement; } return [255,255,255]; };
  const vis = el => { const s=getComputedStyle(el); if(s.display==='none'||s.visibility==='hidden'||parseFloat(s.opacity)===0) return false; const r=el.getBoundingClientRect(); return r.width>0&&r.height>0; };
  const cls = el => { const c=el.getAttribute && el.getAttribute('class'); return (c||'').slice(0,32); };

  function audit(root){
    const I={contrast:[],overflow:[],svgClip:[],outOfBounds:[],tiny:[]};
    const R=root.getBoundingClientRect();
    root.querySelectorAll('*').forEach(el=>{
      if(!vis(el)) return;
      const s=getComputedStyle(el);
      let txt=''; el.childNodes.forEach(n=>{ if(n.nodeType===3) txt+=n.textContent; }); txt=txt.trim();
      if(txt.length>1 && el.tagName!=='SCRIPT' && el.tagName!=='STYLE'){
        const fg=parse(s.color), bg=effBg(el);
        if(fg){ const fs=parseFloat(s.fontSize), bold=(parseInt(s.fontWeight)||400)>=700, large=fs>=24||(fs>=18.66&&bold), thr=large?3:4.5;
          const cr=ratio([fg[0],fg[1],fg[2]],bg);
          if(cr<thr) I.contrast.push({t:txt.slice(0,32),cr:+cr.toFixed(2),thr,fs:Math.round(fs),cls:cls(el)});
          if(fs<11) I.tiny.push({t:txt.slice(0,24),fs:+fs.toFixed(1),cls:cls(el)}); }
      }
      if((s.overflow==='hidden'||s.overflowX==='hidden'||s.textOverflow==='ellipsis') && el.scrollWidth>el.clientWidth+2 && el.clientWidth>0)
        I.overflow.push({t:(el.textContent||'').trim().slice(0,30),sw:el.scrollWidth,cw:el.clientWidth,cls:cls(el)});
      const r=el.getBoundingClientRect();
      if(r.width>0 && (r.right>R.right+2 || r.left<R.left-2))
        I.outOfBounds.push({tag:el.tagName,cls:cls(el),overR:Math.round(r.right-R.right),overL:Math.round(R.left-r.left)});
    });
    root.querySelectorAll('svg text').forEach(t=>{ try{ const len=t.getComputedTextLength(), svg=t.closest('svg'), vb=svg.viewBox&&svg.viewBox.baseVal, w=vb&&vb.width?vb.width:svg.getBoundingClientRect().width; if(len>w*0.98) I.svgClip.push({t:(t.textContent||'').slice(0,24),len:Math.round(len),w:Math.round(w)}); }catch(e){} });
    return I;
  }

  function auditAll(){
    const out={}; const N=(global.__count)||5;
    for(let n=1;n<=N;n++){ if(global.showVar) global.showVar(n); const root=document.querySelector('#v'+n+' .showcase'); if(!root) continue; const I=audit(root);
      out['v'+n]={contrast:I.contrast.length,overflow:I.overflow.length,svgClip:I.svgClip.length,outOfBounds:I.outOfBounds.length,tiny:I.tiny.length,
        worst:I.contrast.sort((a,b)=>a.cr-b.cr).slice(0,8),bounds:I.outOfBounds.slice(0,5),clip:I.svgClip.slice(0,5),over:I.overflow.slice(0,5)}; }
    if(global.showVar) global.showVar(1);
    out.pageScroll=document.documentElement.scrollWidth>innerWidth+2;
    return out;
  }
  global.audit=audit; global.auditAll=auditAll;
})(window);
