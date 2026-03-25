import { useState, useEffect, useRef } from 'react';
const API = '/api';
const PW_KEY = 'fom_auth';
const ds = n => (!n ? '' : n.toLowerCase()==='virtuell' ? 'Digitales Live-Studium' : n);

const IcoArrow=()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>;
const IcoBack=()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>;
const IcoPin=()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>;
const IcoCheck=()=><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IcoCheckSm=()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IcoSearch=()=><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const IcoSend=()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const IcoX=()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IcoChevron=({open})=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{transition:'transform .2s',transform:open?'rotate(180deg)':''}}><polyline points="6 9 12 15 18 9"/></svg>;

// Hochschulbereich names + offizielle Farben (FOM Corporate Design Manual 2025)
const SCHOOLS = {
  'FOM School of Business & Management': { label: 'Wirtschaft & Management', color: '#77B502' },
  'FOM School of IT Management':         { label: 'IT Management',           color: '#0091C6' },
  'School of IT Management':             { label: 'IT Management',           color: '#0091C6' },
  'FOM School of Psychology':            { label: 'Wirtschaft & Psychologie',color: '#910CC1' },
  'School of Engineering':               { label: 'Ingenieurwesen',          color: '#003A72' },
  'School of Health & Social Management':{ label: 'Gesundheit & Soziales',   color: '#E81818' },
  'School of Law':                       { label: 'Wirtschaft & Recht',      color: '#DD9F1F' },
  'School of Dual Studies':              { label: 'Duales Studium',          color: '#F9CB00' },
  'Open Business School':                { label: 'Open Business School',    color: '#0071DE' },
};
const SCHOOL_HIDE = new Set(['School of Dual Studies', 'Diplomstudiengänge', 'Graduate School', 'ATAFOM', 'Open Business School', 'FOM', 'IIS - GSSBT']);
const schoolLabel = s => (SCHOOLS[s]?.label) || s || 'Weitere Studiengänge';
const schoolColor = s => (SCHOOLS[s]?.color) || '#00C6B2';

const STEP_KEYS = ['abschluss','studiengang','modell','standort','kontakt','versand','zusammenfassung'];
const STEP_LABELS = ['Magazin','Studiengänge','Studienmodell','Hochschulzentrum','Kontakt','Versand','Übersicht'];

export default function App() {
  const [authed,setAuthed]=useState(()=>sessionStorage.getItem(PW_KEY)==='1');
  const [pw,setPw]=useState('');
  const [pwErr,setPwErr]=useState(false);
  const [data,setData]=useState([]);
  const [loading,setLoading]=useState(true);
  const [step,setStep]=useState('start');
  const [dir,setDir]=useState('fwd');
  const [abschluss,setAbschluss]=useState(null);
  const [selected,setSelected]=useState(new Set());
  const [modell,setModell]=useState(null);
  const [standort,setStandort]=useState('');
  const [standortSearch,setStandortSearch]=useState('');
  const [search,setSearch]=useState('');
  const [openSections,setOpenSections]=useState(new Set());
  const [form,setForm]=useState({vorname:'',nachname:'',email:''});
  const [postWunsch,setPostWunsch]=useState(null);
  const [adresse,setAdresse]=useState({strasse:'',plz:'',ort:''});
  const [submitting,setSubmitting]=useState(false);
  const [submitted,setSubmitted]=useState(false);
  const [cartOpen,setCartOpen]=useState(false);

  useEffect(()=>{
    fetch('/produkte.json').then(r=>{if(!r.ok)throw new Error();return r.json()})
      .catch(()=>fetch(`${API}/infomaterial/produkte`).then(r=>r.json()))
      .then(r=>{if(r.success)setData(r.data||[])})
      .finally(()=>setLoading(false));
  },[]);

  // Group by Produktname
  const grouped={};
  data.forEach(p=>{const k=p.Produktname;if(!grouped[k])grouped[k]={...p,instanzen:[],schools:new Set()};grouped[k].instanzen.push(p);if(p.Hochschulbereich)grouped[k].schools.add(p.Hochschulbereich)});
  const all=Object.values(grouped);
  const bachelors=all.filter(m=>(m.ProduktTypName||'').includes('Bachelor'));
  const masterList=all.filter(m=>(m.ProduktTypName||'').includes('Master'));
  const currentList=abschluss==='Bachelor'?bachelors:abschluss==='Master'?masterList:[];

  // Group by Hochschulbereich
  const bySchool={};
  currentList.forEach(m=>{
    const schools=[...m.schools];
    const school=schools.length>0?schools[0]:'Weitere';
    if(!bySchool[school])bySchool[school]=[];
    if(!bySchool[school].some(x=>x.Produktname===m.Produktname))bySchool[school].push(m);
  });
  // Sort schools, filter by search
  const schoolKeys=Object.keys(bySchool).filter(k=>!SCHOOL_HIDE.has(k)&&k!=='Weitere').sort((a,b)=>schoolLabel(a).localeCompare(schoolLabel(b)));
  const q=search.toLowerCase();
  const filteredSchools=schoolKeys.map(sk=>({
    key:sk,label:schoolLabel(sk),color:schoolColor(sk),
    items:bySchool[sk].filter(m=>!q||(m.Produktname||'').toLowerCase().includes(q)||(m.AbschlussName||'').toLowerCase().includes(q)).sort((a,b)=>a.Produktname.localeCompare(b.Produktname))
  })).filter(s=>s.items.length>0);

  // Standorte — lookup via grouped dict (stable)
  const selectedMasters=[...selected].map(n=>grouped[n]).filter(Boolean);
  const allStandorte=(()=>{const s=new Set();const hide=new Set(['virtuell','fernstudium','']);selectedMasters.forEach(m=>m.instanzen.forEach(i=>{const name=(i.StandortName||'').trim();if(!hide.has(name.toLowerCase())&&name&&!name.includes(','))s.add(name)}));return[...s].sort()})();
  const filteredStandorte=allStandorte.filter(s=>!standortSearch||s.toLowerCase().includes(standortSearch.toLowerCase()));

  const go=(s,d='fwd')=>{setDir(d);setStep(s)};
  const stepIdx=STEP_KEYS.indexOf(step);
  const toggleSelect=name=>{setSelected(prev=>{const n=new Set(prev);if(n.has(name))n.delete(name);else n.add(name);return n})};
  const toggleSection=key=>{setOpenSections(prev=>{const n=new Set(prev);if(n.has(key))n.delete(key);else n.add(key);return n})};

  const buildCart=()=>{
    const items=[];
    selectedMasters.forEach(m=>{
      if(modell==='DLS'||modell==='unsicher'){
        const inst=m.instanzen.find(i=>(i.StandortName||'').toLowerCase()==='virtuell');
        if(inst)items.push({instanzId:inst.InstanzID,produktname:m.Produktname,standort:'Digitales Live-Studium',modell:modell==='unsicher'?'Noch unsicher':'DLS'});
      }
      if(modell==='Campus'){
        const inst=m.instanzen.find(i=>i.StandortName===standort);
        if(inst)items.push({instanzId:inst.InstanzID,produktname:m.Produktname,standort:ds(standort),modell:'Campus'});
      }
    });
    return items;
  };

  const uf=(f,v)=>setForm(p=>({...p,[f]:v}));
  const ua=(f,v)=>setAdresse(p=>({...p,[f]:v}));
  const canKontakt=form.vorname.trim()&&form.nachname.trim()&&form.email.trim();

  const handleSubmit=()=>{
    setSubmitting(true);
    console.log('Anfrage:',{produkte:buildCart(),kontakt:form,post:postWunsch,...(postWunsch?{adresse}:{})});
    setTimeout(()=>{setSubmitting(false);setSubmitted(true);go('done')},1500);
  };
  const reset=()=>{setAbschluss(null);setSelected(new Set());setModell(null);setStandort('');setStandortSearch('');setForm({vorname:'',nachname:'',email:''});setPostWunsch(null);setAdresse({strasse:'',plz:'',ort:''});setSubmitted(false);setSearch('');setOpenSections(new Set());go('start')};

  if(!authed) return (
    <div className="hf">
      <div className="hf-pw-gate">
        <img src="/logos/fom-logo.png" alt="FOM" style={{width:180,marginBottom:32}}/>
        <h2 style={{margin:'0 0 8px',fontFamily:'var(--fom-display)'}}>Zugang geschützt</h2>
        <p style={{color:'var(--fom-gray)',margin:'0 0 24px',fontSize:14}}>Bitte gib das Passwort ein, um fortzufahren.</p>
        <form onSubmit={e=>{e.preventDefault();if(pw==='Fom!1991'){sessionStorage.setItem(PW_KEY,'1');setAuthed(true)}else setPwErr(true)}} style={{display:'flex',flexDirection:'column',gap:12,width:'100%',maxWidth:320}}>
          <input type="password" value={pw} onChange={e=>{setPw(e.target.value);setPwErr(false)}} placeholder="Passwort" style={{padding:'12px 16px',border:`2px solid ${pwErr?'#e00':'var(--fom-gray-light)'}`,borderRadius:12,fontSize:15,fontFamily:'inherit',outline:'none',transition:'border .2s'}}/>
          {pwErr&&<span style={{color:'#e00',fontSize:13}}>Falsches Passwort</span>}
          <button type="submit" style={{padding:'12px',background:'var(--fom-teal)',color:'#fff',border:'none',borderRadius:50,fontSize:15,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>Anmelden</button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="hf">
      {/* Header */}
      <header className="hf-header">
        <a href="https://www.fom.de" target="_blank" rel="noopener"><img src="/logos/fom-logo-white.svg" alt="FOM" className="hf-logo"/></a>
        <div className="hf-header-right">
          {selected.size>0&&step!=='done'&&(
            <span className="hf-header-badge">{selected.size} Studiengang{selected.size!==1?'e':''}</span>
          )}
        </div>
      </header>

      {/* Progress — progressive reveal: nur bis aktueller Schritt + 1 */}
      {stepIdx>=0&&step!=='done'&&(
        <div className="hf-steps-bar"><div className="hf-steps-inner">
          {STEP_KEYS.map((k,i)=>{
            if(k==='standort'&&modell!=='Campus')return null;
            if(i>stepIdx+1)return null;
            const isDone=i<stepIdx;
            return(<div key={k} style={{display:'contents'}}>
              {i>0&&<div className={`hf-step-line ${i<=stepIdx?'done':''}`}/>}
              <div className={`hf-step-item ${i===stepIdx?'active':''} ${isDone?'done':''}`} onClick={isDone?()=>go(STEP_KEYS[i],'back'):undefined} style={isDone?{cursor:'pointer'}:undefined}>
                <span className="hf-step-dot">{isDone?<IcoCheckSm/>:i+1}</span>
                <span className="hf-step-label">{STEP_LABELS[i]}</span>
              </div>
            </div>);
          })}
        </div></div>
      )}

      <main className="hf-main">
        <div className={`hf-slide ${dir}`} key={step}>

          {/* START */}
          {step==='start'&&(
            <div className="hf-center">
              <img src="/logos/fom-logo.png" alt="FOM Hochschule" className="hf-hero-logo"/>
              <h1 className="hf-hero-title">Kostenloses Infomaterial<br/>zu deinem Wunschstudium</h1>
              <p className="hf-hero-sub">Stell dir dein persönliches Info-Paket zusammen — kostenlos und unverbindlich.</p>
              {loading?<div className="hf-spinner-wrap"><div className="hf-spinner"/></div>:(
                <button className="hf-cta" onClick={()=>go('abschluss')}>Jetzt starten <IcoArrow/></button>
              )}
            </div>
          )}

          {/* 1. ABSCHLUSS */}
          {step==='abschluss'&&(
            <div className="hf-center-wide">
              <h2 className="hf-title" style={{textAlign:'center'}}>Welches Magazin möchtest du?</h2>
              <p className="hf-sub" style={{textAlign:'center'}}>Wähle dein gewünschtes Infomaterial.</p>
              <div className="hf-mag-cards">
                <button className="hf-mag-card" onClick={()=>{setAbschluss('Bachelor');setSelected(new Set());setSearch('');setOpenSections(new Set());go('studiengang')}}>
                  <div className="hf-mag-img"><img src="/bachelor-magazin.avif" alt="Bachelor Magazin"/></div>
                  <div className="hf-mag-info"><span className="hf-mag-label">Bachelor</span></div>
                </button>
                <button className="hf-mag-card" onClick={()=>{setAbschluss('Master');setSelected(new Set());setSearch('');setOpenSections(new Set());go('studiengang')}}>
                  <div className="hf-mag-img"><img src="/master-magazin.avif" alt="Master Magazin"/></div>
                  <div className="hf-mag-info"><span className="hf-mag-label">Master</span></div>
                </button>
              </div>
            </div>
          )}

          {/* 2–6: STUDIENGÄNGE bis VERSAND — mit Sidebar */}
          {['studiengang','modell','standort','kontakt','versand'].includes(step)&&(
            <div className="hf-sg-layout">
              <div className="hf-sg-main">

                {/* 2. STUDIENGÄNGE */}
                {step==='studiengang'&&(<>
                <h2 className="hf-title">Welche Studiengänge interessieren dich?</h2>
                <p className="hf-sub">Wähle einen oder mehrere aus — nach Hochschulbereich sortiert.</p>

                <div className="hf-search">
                  <IcoSearch/>
                  <input placeholder="Studiengang suchen …" value={search} onChange={e=>setSearch(e.target.value)}/>
                  {search&&<button className="hf-search-x" onClick={()=>setSearch('')}>×</button>}
                </div>

                <div className="hf-accordion">
                  {filteredSchools.map(({key,label,color,items})=>{
                    const isOpen=openSections.has(key)||!!search;
                    const selCount=items.filter(m=>selected.has(m.Produktname)).length;
                    return(
                      <div key={key} className="hf-acc-section">
                        <button className="hf-acc-header" onClick={()=>toggleSection(key)}>
                          <div className="hf-acc-header-left">
                            <span className="hf-acc-dot" style={{background:color}}/>
                            <span className="hf-acc-label">{label}</span>
                            <span className="hf-acc-count">{items.length}</span>
                            {selCount>0&&<span className="hf-acc-sel">{selCount} gewählt</span>}
                          </div>
                          <IcoChevron open={isOpen}/>
                        </button>
                        {isOpen&&(
                          <div className="hf-acc-body">
                            {items.map(m=>{
                              const isSel=selected.has(m.Produktname);
                              return(
                                <button key={m.Produktname} className={`hf-sg-item ${isSel?'selected':''}`} onClick={()=>toggleSelect(m.Produktname)}>
                                  <span className={`hf-cb ${isSel?'on':''}`}>{isSel&&<IcoCheckSm/>}</span>
                                  <div className="hf-sg-info">
                                    <span className="hf-sg-name">{m.Produktname}</span>
                                    <span className="hf-sg-meta">{m.ECTS?`${m.ECTS} ECTS`:''}{m.DauerZahl?` · ${m.DauerZahl} ${m.DauerEinheit||'Sem.'}`:''}</span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {selected.size>0&&(
                  <button className="hf-sg-weiter-btn" onClick={()=>go('modell')}>Weiter <IcoArrow/></button>
                )}
                </>)}

                {/* 3. STUDIENMODELL */}
                {step==='modell'&&(<>
                <h2 className="hf-title">Wie möchtest du studieren?</h2>
                <p className="hf-sub">Wähle dein bevorzugtes Studienmodell.</p>
                <div className="hf-options">
                  <button className="hf-option" onClick={()=>{setModell('Campus');setStandort('');go('standort')}}>
                    <span className="hf-option-emoji">🏛️</span>
                    <div className="hf-option-text"><span className="hf-option-label">Am Campus</span><span className="hf-option-desc">Präsenzstudium vor Ort an einem Hochschulzentrum</span></div>
                    <IcoArrow/>
                  </button>
                  <button className="hf-option" onClick={()=>{setModell('DLS');go('kontakt')}}>
                    <span className="hf-option-emoji">💻</span>
                    <div className="hf-option-text"><span className="hf-option-label">Digitales Live-Studium</span><span className="hf-option-desc">Virtuell & interaktiv — live aus den FOM Studios</span></div>
                    <IcoArrow/>
                  </button>
                  <button className="hf-option" onClick={()=>{setModell('unsicher');go('kontakt')}}>
                    <span className="hf-option-emoji">🤔</span>
                    <div className="hf-option-text"><span className="hf-option-label">Ich bin noch unsicher</span><span className="hf-option-desc">Wir beraten dich gerne zu beiden Varianten</span></div>
                    <IcoArrow/>
                  </button>
                </div>
                </>)}

                {/* 4. STANDORT */}
                {step==='standort'&&(<>
                <h2 className="hf-title">Wo möchtest du studieren?</h2>
                <p className="hf-sub">Wähle dein Hochschulzentrum.</p>
                {allStandorte.length>10&&(
                  <div className="hf-search hf-search-sm"><IcoSearch/><input placeholder="Standort suchen …" value={standortSearch} onChange={e=>setStandortSearch(e.target.value)}/></div>
                )}
                <div className="hf-loc-grid">
                  {filteredStandorte.map(s=>(
                    <button key={s} className={`hf-loc ${standort===s?'active':''}`} onClick={()=>{setStandort(s);go('kontakt')}}>
                      <IcoPin/><span>{ds(s)}</span>{standort===s?<IcoCheckSm/>:<IcoArrow/>}
                    </button>
                  ))}
                </div>
                </>)}

                {/* 5. KONTAKT */}
                {step==='kontakt'&&(<>
                <h2 className="hf-title">Wohin dürfen wir dein Infomaterial senden?</h2>
                <p className="hf-sub">Deine E-Mail genügt — wir melden uns bei dir.</p>
                <div className="hf-form-center">
                  <div className="hf-field"><label>Vorname *</label><input value={form.vorname} onChange={e=>uf('vorname',e.target.value)} placeholder="Max"/></div>
                  <div className="hf-field"><label>Nachname *</label><input value={form.nachname} onChange={e=>uf('nachname',e.target.value)} placeholder="Mustermann"/></div>
                  <div className="hf-field"><label>E-Mail *</label><input type="email" value={form.email} onChange={e=>uf('email',e.target.value)} placeholder="max@beispiel.de"/></div>
                  <button className="hf-next-btn" disabled={!canKontakt} onClick={()=>go('versand')}>Weiter <IcoArrow/></button>
                </div>
                </>)}

                {/* 6. VERSAND */}
                {step==='versand'&&(<>
                <h2 className="hf-title">Infomaterial auch per Post?</h2>
                <p className="hf-sub">Per E-Mail erhältst du es in jedem Fall.</p>
                <div className="hf-options">
                  <button className={`hf-option ${postWunsch===true?'active':''}`} onClick={()=>setPostWunsch(true)}>
                    <span className="hf-option-emoji">📬</span>
                    <div className="hf-option-text"><span className="hf-option-label">Ja, auch per Post</span><span className="hf-option-desc">Wir senden dir eine Infomappe zu</span></div>
                  </button>
                  <button className={`hf-option ${postWunsch===false?'active':''}`} onClick={()=>setPostWunsch(false)}>
                    <span className="hf-option-emoji">📧</span>
                    <div className="hf-option-text"><span className="hf-option-label">Nein, nur per E-Mail</span><span className="hf-option-desc">Schnell und digital</span></div>
                  </button>
                </div>
                {postWunsch===true&&(
                  <div className="hf-form-center" style={{marginTop:24}}>
                    <div className="hf-field"><label>Straße & Hausnummer *</label><input value={adresse.strasse} onChange={e=>ua('strasse',e.target.value)} placeholder="Musterstraße 1"/></div>
                    <div className="hf-row-inline">
                      <div className="hf-field" style={{maxWidth:120}}><label>PLZ *</label><input value={adresse.plz} onChange={e=>ua('plz',e.target.value)} maxLength="5" placeholder="40210"/></div>
                      <div className="hf-field" style={{flex:1}}><label>Ort *</label><input value={adresse.ort} onChange={e=>ua('ort',e.target.value)} placeholder="Düsseldorf"/></div>
                    </div>
                  </div>
                )}
                {postWunsch!==null&&(
                  <button className="hf-next-btn" style={{marginTop:24}} disabled={postWunsch&&(!adresse.strasse.trim()||!adresse.plz.trim()||!adresse.ort.trim())} onClick={()=>go('zusammenfassung')}>Weiter zur Übersicht <IcoArrow/></button>
                )}
                </>)}

              </div>

              {/* Auswahl-Panel rechts — dauerhaft sichtbar */}
              <div className="hf-sg-aside">
                <div className="hf-sg-aside-inner">
                  <h3 className="hf-sg-aside-title">Deine Auswahl {selected.size>0&&<span className="hf-sg-aside-count">{selected.size}</span>}</h3>
                  {selected.size===0?(
                    <p className="hf-sg-aside-empty">Noch keine Studiengänge ausgewählt.</p>
                  ):(
                    <div className="hf-sg-aside-items">
                      {[...selected].map(name=>(
                        <div key={name} className="hf-sg-aside-item">
                          <span className="hf-sg-aside-name">{name}</span>
                          <button className="hf-sg-aside-rm" onClick={()=>toggleSelect(name)}><IcoX/></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Fixed bottom bar mobile */}
              {step==='studiengang'&&(
                <div className={`hf-bottom-bar ${selected.size>0?'visible':''}`}>
                  <span className="hf-bottom-info">{selected.size} Studiengang{selected.size!==1?'e':''} ausgewählt</span>
                  <button className="hf-bottom-btn" onClick={()=>go('modell')} disabled={selected.size===0}>Weiter <IcoArrow/></button>
                </div>
              )}
            </div>
          )}

          {/* 7. ZUSAMMENFASSUNG */}
          {step==='zusammenfassung'&&(
            <div className="hf-center" style={{textAlign:'left'}}>
              <h2 className="hf-title" style={{textAlign:'left'}}>Deine Anfrage im Überblick</h2>
              <p className="hf-sub" style={{textAlign:'left'}}>Prüfe deine Angaben bevor du abschickst.</p>

              <div className="hf-summary">
                <div className="hf-summary-section">
                  <h4 className="hf-summary-label">Magazin</h4>
                  <p className="hf-summary-value">{abschluss}</p>
                </div>
                <div className="hf-summary-section">
                  <h4 className="hf-summary-label">Studiengänge</h4>
                  <div className="hf-summary-list">
                    {[...selected].map(n=><div key={n} className="hf-summary-item">{n}</div>)}
                  </div>
                </div>
                <div className="hf-summary-section">
                  <h4 className="hf-summary-label">Studienmodell</h4>
                  <p className="hf-summary-value">{modell==='Campus'?'Am Campus':modell==='DLS'?'Digitales Live-Studium':'Noch unsicher'}</p>
                </div>
                {modell==='Campus'&&standort&&(
                  <div className="hf-summary-section">
                    <h4 className="hf-summary-label">Hochschulzentrum</h4>
                    <p className="hf-summary-value">{ds(standort)}</p>
                  </div>
                )}
                <div className="hf-summary-section">
                  <h4 className="hf-summary-label">Kontakt</h4>
                  <p className="hf-summary-value">{form.vorname} {form.nachname}<br/>{form.email}</p>
                </div>
                <div className="hf-summary-section">
                  <h4 className="hf-summary-label">Versand</h4>
                  <p className="hf-summary-value">{postWunsch?<>Per E-Mail & Post<br/>{adresse.strasse}, {adresse.plz} {adresse.ort}</>:'Nur per E-Mail'}</p>
                </div>
              </div>

              <div className="hf-mehr-box" style={{marginTop:24}}>
                <p className="hf-mehr-text">Möchtest du noch weitere Materialien hinzufügen?</p>
                <button className="hf-mehr-btn" onClick={()=>go('abschluss','back')}>+ Weitere Materialien hinzufügen</button>
              </div>

              <button className="hf-submit" style={{marginTop:24}} disabled={submitting} onClick={handleSubmit}>
                {submitting?<><span className="hf-spin"/> Wird gesendet …</>:<><IcoSend/> Infomaterial kostenlos anfordern</>}
              </button>
            </div>
          )}

          {/* DONE */}
          {step==='done'&&(
            <div className="hf-center">
              <div className="hf-done-icon"><IcoCheck/></div>
              <h2 className="hf-title">Vielen Dank!</h2>
              <p className="hf-sub">Infomaterial zu {selected.size} Studiengang{selected.size!==1?'en':''} an <strong>{form.email}</strong>{postWunsch?' — auch per Post':''}.</p>
              <div className="hf-done-list">{[...selected].map(n=><div key={n} className="hf-done-item"><strong>{n}</strong><span>{modell==='Campus'?ds(standort):modell==='DLS'?'Digitales Live-Studium':'Noch unsicher'}</span></div>)}</div>
              <button className="hf-cta" onClick={reset} style={{marginTop:24}}>Neue Anfrage <IcoArrow/></button>
            </div>
          )}

        </div>
      </main>


      <footer className="hf-footer">
        <div className="hf-footer-logo">
          <img src="/logos/fom-logo-white.svg" alt="FOM Hochschule"/>
        </div>
        <div className="hf-footer-inner">
          <div className="hf-footer-about">
            <p>Mit rund 45.000 Studierenden zählt die gemeinnützige FOM zu den größten Hochschulen Europas. Initiiert durch die gemeinnützige Stiftung für internationale Bildung und Wissenschaft ermöglicht sie Berufstätigen, Auszubildenden, Abiturienten und international Studierenden ein Hochschulstudium.</p>
          </div>
          <div className="hf-footer-links-col">
            <strong className="hf-footer-heading">Infomaterial</strong>
            <a href="https://www.fom.de/studiengaenge.html" target="_blank" rel="noopener">Studiengänge</a>
            <a href="https://www.fom.de/campus-studium.html" target="_blank" rel="noopener">Campus-Studium+</a>
            <a href="https://www.fom.de/digitales-live-studium.html" target="_blank" rel="noopener">Digitales Live-Studium</a>
          </div>
          <div className="hf-footer-links-col">
            <strong className="hf-footer-heading">FOM Hochschule</strong>
            <a href="https://www.fom.de" target="_blank" rel="noopener">Startseite</a>
            <a href="https://www.fom.de/forschung.html" target="_blank" rel="noopener">Forschung</a>
            <a href="https://www.fom.de/die-fom.html" target="_blank" rel="noopener">Über die FOM</a>
          </div>
          <div className="hf-footer-links-col">
            <strong className="hf-footer-heading">Kontakt</strong>
            <span>Leimkugelstraße 6, 45141 Essen</span>
            <a href="tel:+4920181004-0">0201 / 81004-0</a>
            <a href="mailto:studienberatung@fom.de">studienberatung@fom.de</a>
          </div>
        </div>
        <div className="hf-footer-social">
          <a href="https://www.linkedin.com/school/fom-hochschule/" target="_blank" rel="noopener" aria-label="LinkedIn">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          </a>
          <a href="https://www.facebook.com/FOMHochschule" target="_blank" rel="noopener" aria-label="Facebook">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
          </a>
          <a href="https://www.instagram.com/faborealismundi/" target="_blank" rel="noopener" aria-label="Instagram">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
          </a>
          <a href="https://www.youtube.com/@FOMHochschule" target="_blank" rel="noopener" aria-label="YouTube">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          </a>
        </div>
        <div className="hf-footer-bottom">
          <span>&copy; {new Date().getFullYear()} FOM Hochschule für Oekonomie &amp; Management</span>
          <span><a href="https://www.fom.de/die-fom/impressum.html" target="_blank" rel="noopener">Impressum</a> &nbsp; <a href="https://www.fom.de/die-fom/datenschutz.html" target="_blank" rel="noopener">Datenschutz</a></span>
        </div>
      </footer>
    </div>
  );
}
