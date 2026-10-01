/*
 * Aircraft for David's flying journey. Original, code-native vector models;
 * paint and configuration follow the supplied photos, without identifying marks.
 * Length/span proportions informed by the manufacturers' drawings (see README).
 * Coordinates are metres, projected once into SVG. Only propellers and the
 * containing flight paths animate, so this needs no WebGL or external libraries.
 */
(() => {
  'use strict';
  const host = document.getElementById('aircraft-fleet');
  if (!host) return;
  const NS = 'http://www.w3.org/2000/svg';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const models = [
    { id:'cub', name:'Piper J-3 Cub', span:10.74, length:6.83, color:'#f3b920', trim:'#262c31', high:true, cub:true, tailwheel:true, wingZ:.83, root:1.62, tip:1.48, sweep:.08, prop:2.91, radius:.93, blades:2,
      body:[[-3.35,.07,.09,.08],[-2.65,.14,.18,.05],[-1.4,.26,.31,0],[-.25,.37,.43,0],[1.0,.36,.43,.05],[2.25,.28,.29,.08],[2.77,.18,.20,.1]] },
    { id:'da20', name:'Diamond DA-20', span:10.87, length:7.11, color:'#edf1f1', trim:'#202c47', bubble:true, ttail:true, wingZ:-.23, root:1.40, tip:.62, sweep:.51, prop:3.01, radius:.89, blades:2,
      body:[[-3.72,.075,.10,.1],[-2.65,.12,.13,.07],[-1.6,.20,.22,.02],[-.7,.42,.43,0],[.5,.53,.45,0],[1.6,.43,.34,0],[2.64,.27,.25,.02],[2.91,.14,.16,.04]] },
    { id:'archer', name:'Piper PA-28-181', span:10.8, length:7.32, color:'#f0f3f4', trim:'#1c79ab', archer:true, wingZ:-.30, root:1.65, tip:1.06, sweep:.34, prop:3.04, radius:.95, blades:2,
      body:[[-3.85,.09,.13,.08],[-3.1,.16,.21,.06],[-1.65,.31,.37,0],[-.6,.51,.46,0],[.7,.55,.48,0],[1.6,.49,.39,.03],[2.7,.37,.30,.04],[2.93,.19,.21,.04]] },
    { id:'skyhawk', name:'Cessna 172S', span:11.0, length:8.28, color:'#f1f2ee', trim:'#17365b', red:'#b53c44', high:true, cessna:true, wingZ:.88, root:1.64, tip:1.10, sweep:.24, prop:3.39, radius:.97, blades:2,
      body:[[-4.39,.085,.14,.12],[-3.35,.16,.22,.08],[-2.0,.31,.34,.02],[-.8,.48,.44,0],[.65,.54,.48,0],[1.85,.45,.38,.02],[3.0,.31,.27,.06],[3.28,.17,.19,.06]] },
    { id:'extra', name:'Extra 330', span:8.0, length:6.9, color:'#edeff0', trim:'#172b49', bubble:true, extra:true, tailwheel:true, wingZ:-.12, root:1.72, tip:.85, sweep:.48, prop:3.04, radius:.98, blades:3,
      body:[[-3.44,.09,.14,.02],[-2.4,.17,.24,0],[-1.15,.31,.32,0],[.2,.38,.35,0],[1.55,.41,.38,0],[2.63,.36,.29,.04],[2.94,.15,.16,.07]] },
    { id:'seminole', name:'Piper PA-44 Seminole', span:11.75, length:8.41, color:'#f1f1ec', trim:'#173e69', red:'#b63740', twin:true, ttail:true, wingZ:-.29, root:1.68, tip:1.09, sweep:.43, radius:.94, blades:2,
      body:[[-4.3,.1,.13,.05],[-3.3,.18,.23,.02],[-1.85,.34,.37,0],[-.6,.52,.48,0],[.9,.56,.49,0],[1.95,.45,.39,0],[3.15,.30,.28,-.02],[4.05,.03,.07,-.06]] }
  ];
  const order = [0,1,2,3,4,5,2];
  const project = ([x,y,z]) => [260+x*43+y*15, 184-x*4.5+y*24-z*42];
  const point = p => project(p).map(n=>n.toFixed(2)).join(',');
  const depth = ([x,y,z]) => -.27*x+.80*y+.53*z;
  const shade = (hex,light) => {
    const rgb = hex.replace('#','').match(/../g).map(v=>parseInt(v,16));
    return '#'+rgb.map(v=>Math.round(Math.min(255,Math.max(0,light>0?v+(255-v)*light:v*(1+light)))).toString(16).padStart(2,'0')).join('');
  };
  const el = (tag,attrs={}) => {
    const n=document.createElementNS(NS,tag);
    Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));
    return n;
  };

  function aircraft(m) {
    const svg=el('svg',{viewBox:'0 0 520 380', 'aria-hidden':'true', focusable:'false'});
    const pieces=[];
    const add=(node,pts,offset=0)=>pieces.push({node,d:pts.reduce((s,p)=>s+depth(p),0)/pts.length+offset});
    const poly=(pts,fill,offset=0,stroke=fill,width=.45)=>add(el('polygon',{points:pts.map(point).join(' '),fill,stroke,'stroke-width':width,'stroke-linejoin':'round'}),pts,offset);
    const line=(pts,color='#718394',width=.7,offset=.025)=>add(el('polyline',{points:pts.map(point).join(' '),fill:'none',stroke:color,'stroke-width':width,'stroke-linecap':'round','stroke-linejoin':'round'}),pts,offset);
    const dot=(p,r,fill,offset=.03)=>{const [cx,cy]=project(p);add(el('circle',{cx,cy,r,fill}),[p],offset)};
    // Keep glazing painted on its parent panel when depth-sorting the aircraft.
    const panel=(pts,fill,details)=>{
      const start=pieces.length;
      poly(pts,fill);
      details();
      const group=el('g');
      pieces.splice(start).forEach(piece=>group.append(piece.node));
      add(group,pts,.025);
    };

    // Smooth elliptical fuselage sections; upper and lower paint remain separate.
    const tube=(rings,color,paint,origin=[0,0,0],segments=20)=>{
      const ringPoint=(r,a)=>[r[0]+origin[0],Math.cos(a)*r[1]+origin[1],Math.sin(a)*r[2]+r[3]+origin[2]];
      for(let i=0;i<rings.length-1;i++)for(let j=0;j<segments;j++){
        const a=j/segments*Math.PI*2,b=(j+1)/segments*Math.PI*2;
        const normal=(a+b)/2;
        const light=Math.sin(normal)*.13-Math.cos(normal)*.12-.04;
        const base=paint&&Math.sin(normal)<-.23?paint:color;
        poly([ringPoint(rings[i],a),ringPoint(rings[i+1],a),ringPoint(rings[i+1],b),ringPoint(rings[i],b)],shade(base,light));
      }
    };
    const tailX=m.body[0][0]+.52;

    // Fixed gear for singles. The Seminole is represented in flight, gear retracted.
    const wheel=(x,y,z,r=.24)=>{
      const [cx,cy]=project([x,y,z]);
      const g=el('g');
      g.append(el('ellipse',{cx,cy,rx:r*37,ry:r*42,fill:'#18232f',stroke:'#46505a','stroke-width':1}));
      g.append(el('ellipse',{cx:cx+1,cy,rx:r*14,ry:r*18,fill:'#9ba8ae',stroke:'#586976','stroke-width':1.3}));
      add(g,[[x,y,z]],.07);
    };
    if(!m.twin){
      const gx=m.tailwheel ? .7 : -.55;
      [-1,1].forEach(side=>{
        line([[gx,.30*side,-.30],[gx-.12,1.0*side,-1.04]],m.cub?'#d99f20':shade(m.color,-.2),m.cub?3:5);
        if(m.cub)line([[1.25,0,-.3],[gx-.12,side,-1.04]],'#bc8b26',2.3);
        wheel(gx-.12,side,-1.10,m.cub?.28:.24);
        if(m.extra){
          tube([[-.37,.01,.04,0],[-.21,.17,.17,0],[.11,.18,.19,0],[.38,.015,.04,.02]],m.trim,null,[gx-.12,side,-1.02],12);
        }
      });
      if(m.tailwheel){line([[tailX,.02,-.05],[tailX-.2,.02,-.38]],'#63717c',2);wheel(tailX-.2,.04,-.46,.12)}
      else{const nx=m.prop-1.0;line([[nx,0,-.2],[nx-.08,0,-.99]],'#c1c9cd',4);wheel(nx-.08,0,-1.10,.22)}
    }

    const wing=(side)=>{
      const span=m.span/2,z=m.wingZ,dihedral=m.high?.035:.065;
      const sections=[{y:.28,lead:.90,chord:m.root},{y:span*.50,lead:.90,chord:m.root},{y:span-.16,lead:.90-m.sweep,chord:m.tip},{y:span,lead:.76-m.sweep,chord:m.tip-.18}];
      const at=(s,f,up=0)=>[s.lead-s.chord*f,s.y*side,z+s.y*dihedral+up];
      for(let i=0;i<sections.length-1;i++){
        const a=sections[i],b=sections[i+1];
        const strips=[0,.08,.28,.73,1];
        for(let j=0;j<strips.length-1;j++){
          const p=strips[j],q=strips[j+1];
          let color=m.color;
          if(m.extra&&(j===0||j===2))color=m.trim;
          if(m.cessna&&i===2)color=m.trim;
          if(m.twin&&i===2)color=m.trim;
          const z1=Math.sin(p*Math.PI)*.075,z2=Math.sin(q*Math.PI)*.075;
          poly([at(a,p,z1),at(b,p,z1),at(b,q,z2),at(a,q,z2)],shade(color,[.05,.12,-.01,-.15][j]));
        }
        poly([at(a,1),at(b,1),at(b,1,-.045),at(a,1,-.08)],shade(m.color,-.31));
      }
      const a=sections[0],b=sections[1],c=sections[2];
      line([at(a,.76,.02),at(b,.76,.04),at(c,.76,.02)],shade(m.color,-.30),.75);
      line([at(b,.76,.04),at(b,1,.01)],shade(m.color,-.30),.65);
      if(m.cub)for(let y=.60;y<span-.18;y+=.39){const s={y,lead:.90,chord:m.root};line([at(s,.13,.06),at(s,.75,.045)],'#dca52b',.5)}
      else{dot([.38,side*1.65,z+1.65*dihedral+.07],2.1,'#b8c3c7');line([[.90,side*1.8,z+1.8*dihedral],[.90-m.root,side*1.8,z+1.8*dihedral]],'#acb9c3',.45)}
      dot([.60-m.sweep,side*(span-.04),z+span*dihedral],1.7,side>0?'#ca4c4d':'#49a787');
      if(m.high){
        line([[-.3,.38*side,-.29],[.35,side*3.0,z+3*dihedral]],m.cub?'#cc9824':'#bdc7ca',3.1);
        if(m.cub)line([[-.3,.38*side,-.29],[-.55,side*3.0,z+3*dihedral]],'#e7af22',2.4);
      }
    };
    wing(-1);wing(1);

    // Horizontal stabilizer: the DA20 and Seminole place it on the fin.
    const tailZ=m.ttail?(m.twin?1.55:1.51):.08;
    const tailSpan=m.twin?2.0:m.cub?1.40:1.60;
    [-1,1].forEach(side=>{
      const pts=[[tailX+.47,.02*side,tailZ],[tailX+.10,tailSpan*.87*side,tailZ+.07],[tailX-.23,tailSpan*side,tailZ+.065],[tailX-.68,tailSpan*.9*side,tailZ+.045],[tailX-.75,.02*side,tailZ]];
      poly(pts,m.twin?m.trim:shade(m.color,.04));
      line([[tailX-.35,.14*side,tailZ+.02],[tailX-.49,tailSpan*.88*side,tailZ+.06]],shade(m.color,-.33),.7);
    });

    tube(m.body,m.color,(m.cessna||m.extra||m.twin)?m.trim:null);
    // Long paint lines on the visible fuselage side, never letters or decals.
    const stripe=m.body.slice(1,-1).map(r=>[r[0],r[1]*.99,r[3]-.02]);
    line(stripe,m.trim,m.cub?3.6:m.id==='da20'?2.2:2.4,.04);
    if(m.red)line(m.body.slice(1,-1).map(r=>[r[0],r[1]*.99,r[3]+.075]),m.red,1.5,.05);
    if(m.id==='da20'){
      line([[-3.3,.10,.17],[-1.8,.22,.13],[-.7,.42,-.08],[1.6,.43,-.13]],m.trim,1.8);
      line([[-3.05,.10,.24],[-1.7,.22,.19],[-.5,.43,-.14]],m.trim,1.1);
    }
    if(m.archer)line([[-3.4,.14,.08],[-1.65,.32,.09],[.7,.56,.09],[2.6,.38,.13]],'#313e4b',1.4,.06);

    // Vertical tail profiles distinguish the rounded Cub and the swept trainers.
    let fin;
    if(m.cub)fin=[[tailX+.42,0,.13],[tailX+.36,0,.82],[tailX+.13,0,1.19],[tailX-.19,0,1.28],[tailX-.46,0,1.10],[tailX-.66,0,.62],[tailX-.76,0,.08]];
    else if(m.ttail)fin=[[tailX+1.0,0,.13],[tailX+.48,0,.42],[tailX+.10,0,tailZ],[tailX-.65,0,tailZ+.03],[tailX-.77,0,.12]];
    else fin=[[tailX+.93,0,.15],[tailX+.53,0,.39],[tailX-.08,0,m.extra?1.51:1.56],[tailX-.71,0,m.extra?1.50:1.54],[tailX-.76,0,.13]];
    poly(fin,m.extra?m.trim:m.color,.01);
    if(m.cessna||m.twin){const top=fin.slice(2,4);poly([top[0],top[1],[top[1][0]+.01,0,top[1][2]-.20],[top[0][0]+.08,0,top[0][2]-.20]],m.trim,.025)}
    line([[tailX-.47,0,.20],[tailX-.40,0,m.cub?1.13:m.ttail?tailZ:1.47]],shade(m.color,-.35),.8,.04);
    if(m.red)line([[tailX+.20,.015,1.04],[tailX-.59,.015,.92]],m.red,1.6,.04);
    if(m.extra)line([[tailX+.07,.02,1.16],[tailX-.66,.02,1.15]],'#cbd4df',2.6,.04);

    if(m.bubble){
      // Glazed, rounded canopies: side-by-side Diamond / tandem Extra.
      const rings=m.extra?[[-1.55,.03,.02,.30],[-1.24,.30,.45,.30],[-.62,.37,.69,.30],[.22,.38,.72,.30],[1.02,.32,.47,.30],[1.46,.06,.02,.30]]:[[-1.0,.04,.02,.36],[-.63,.42,.55,.36],[.08,.53,.77,.36],[.94,.46,.68,.31],[1.55,.26,.35,.27],[1.85,.025,.015,.25]];
      for(let i=0;i<rings.length-1;i++)for(let j=0;j<10;j++){
        const a=j/10*Math.PI,b=(j+1)/10*Math.PI;
        const at=(r,t)=>[r[0],Math.cos(t)*r[1],r[3]+Math.sin(t)*r[2]];
        poly([at(rings[i],a),at(rings[i+1],a),at(rings[i+1],b),at(rings[i],b)],shade('#477184',Math.sin((a+b)/2)*.30-Math.cos((a+b)/2)*.24),.015);
      }
      const r=rings[m.extra?2:3];
      line(Array.from({length:15},(_,i)=>{const a=i/14*Math.PI;return[r[0],Math.cos(a)*r[1],r[3]+Math.sin(a)*r[2]+.01]}),m.color,1.4,.04);
      line(m.extra?[[-1.17,.22,.62],[-.60,.26,.90],[.17,.23,.94]]:[[-.51,.23,.87],[.06,.23,1.07],[.71,.24,.92]],'#c4e4ea',1.8,.05);
    } else {
      // Cabin roof, separate side windows, and a sloping front windshield.
      const back=m.cub?-1.05:m.cessna?-1.30:-1.10;
      const front=m.cub?1.14:1.05,roof=m.cub?.94:.90,w=m.cub?.37:.49;
      poly([[back,-w,.35],[back+.35,-w*.83,roof],[front,-w*.83,roof],[front+.65,-w,.30]],shade(m.color,-.11));
      poly([[back+.35,-w*.83,roof],[front,-w*.83,roof],[front,w*.83,roof],[back+.35,w*.83,roof]],shade(m.color,.13));
      const glass='#294b60';
      const y=w+.008;
      panel([[back,w,.35],[back+.35,w*.83,roof],[front,w*.83,roof],[front+.65,w,.30]],shade(m.color,-.06),()=>{
        poly([[back+.16,y,.40],[back+.42,y*.85,roof-.09],[-.12,y*.85,roof-.09],[-.12,y,.40]],glass);
        poly([[.01,y,.40],[.01,y*.85,roof-.09],[front-.07,y*.85,roof-.09],[front+.42,y,.40]],glass);
        line([[back+.47,y,.67],[-.2,y,.67]],'#7598a9',1.1);
        line([[.16,y,.69],[front-.13,y*.88,.69]],'#6b90a2',.9);
        if(m.cub)line([[-.94,y,.37],[.94,y,.88]],'#bd8d26',2.1);
      });
      poly([[front+.045,-w*.75,roof-.065],[front+.57,-w*.92,.36],[front+.57,w*.92,.36],[front+.045,w*.75,roof-.065]],'#50788b',.03);
      line([[front+.20,-w*.50,roof-.22],[front+.45,-w*.45,.46]],'#b6d9e4',1.1,.05);
      line([[-.13,y,.37],[-.13,y,-.26],[1.08,y,-.26],[1.10,y,.34]],shade(m.color,-.25),.65,.045);
      line([[.65,y+.005,.28],[.81,y+.005,.28]],'#667480',1.5,.045);
      if(m.cub){line([[-.7,-w,.87],[1.1,w,.40]],'#ca9826',1.9,.05)}
      else if(m.cessna)poly([[-1.85,.35,.30],[-1.28,.42,.66],[-1.11,.43,.37]],glass,.03);
    }

    // Cowling panels and the Cub's exposed cylinder heads.
    if(m.cub){
      [-1,1].forEach(side=>{
        poly([[2.20,.30*side,.28],[2.66,.24*side,.28],[2.66,.49*side,.18],[2.20,.54*side,.18]],'#253844');
        for(let x=2.20;x<2.65;x+=.065)line([[x,.48*side,.17],[x,.47*side,-.015]],'#798a91',.9);
        line([[2.6,.43*side,-.04],[2.49,.47*side,-.24],[2.1,.47*side,-.28]],'#725e47',2.7);
      });
    } else if(!m.twin){
      const r=m.body[m.body.length-2];
      line(Array.from({length:11},(_,i)=>{const a=-Math.PI/2+i*Math.PI/10;return[r[0]-.15,Math.cos(a)*(r[1]+.015),r[3]+Math.sin(a)*r[2]]}),shade(m.color,-.33),.65);
      [-1,1].forEach(side=>dot([m.prop-.24,side*.15,.09],2.6,'#273b49'));
    }

    const propeller=(x,y,z,reverse=false)=>{
      const [cx,cy]=project([x,y,z]),r=m.radius*42;
      // An outer oblique projection keeps the inner rotation on the engine axis.
      const g=el('g',{transform:`matrix(.357143 .571429 0 -1 ${cx} ${cy})`});
      const blades=el('g',{class:'aircraft-propeller'+(reverse?' reverse':''),style:`--prop-phase:${reverse?'-.85s':'-.2s'}`});
      for(let i=0;i<m.blades;i++){
        const blade=el('g',{transform:`rotate(${i*360/m.blades})`});
        blade.append(el('path',{d:`M -2 -3 C -4 ${-r*.32} -8 ${-r*.70} -6 ${-r*.91} Q -2 ${-r*1.04} 3 ${-r*.95} L 5 ${-r*.63} 3 -2 Z`,fill:'#243340',stroke:'#98a7ae','stroke-width':.6}));
        blade.append(el('path',{d:`M -6 ${-r*.88} L 3.6 ${-r*.88} 3 ${-r*.96} Q -1 ${-r*1.01} -5 ${-r*.95} Z`,fill:m.cub?'#dbc898':'#e3e6e6'}));
        blades.append(blade);
      }
      g.append(blades,el('circle',{r:3.6,fill:'#c4cdd0'}));
      add(g,[[x,y,z]],.5);
      // Pointed spinner, fixed to the propeller centre rather than rotating.
      if(!m.cub)tube([[x-.01,.145,.145,z],[x+.19,.10,.10,z],[x+.36,.008,.008,z]],m.extra?m.trim:'#e0e5e5',null,[0,y,0],16);
    };
    if(m.twin){
      [-1,1].forEach(side=>{
        const y=side*2.05;
        tube([[-1.25,.06,.10,0],[-.65,.34,.27,0],[.55,.37,.34,.03],[1.65,.33,.29,.04],[1.96,.15,.15,.04]],m.color,m.trim,[0,y,0]);
        line([[1.1,y+.345,.04],[1.7,y+.30,.05]],m.red,1.2);
        dot([1.83,y+.15,.05],3,'#243743');
        propeller(2.01,y,.04,side<0);
      });
    }else propeller(m.prop,0,m.cub?.10:.06);
    // Thin aerials and control-surface seams, scaled with the aircraft.
    if(!m.cub&&!m.extra)line([[-1.4,0,.32],[-1.76,0,.96]],'#a8b8bf',1.4);
    if(m.cub)line([[-.22,0,1.0],[-.22,0,1.30]],'#495563',1);
    pieces.sort((a,b)=>a.d-b.d).forEach(p=>svg.append(p.node));
    svg.dataset.aircraft=m.id;
    return svg;
  }

  // Two depth layers preserve the portfolio's moving background without clutter.
  const fleet=[...host.querySelectorAll('.plane')].map(carrier=>{
    const slots=models.map(m=>{
      const wrap=document.createElement('div');
      wrap.className='aircraft-model';
      wrap.dataset.model=m.id;
      wrap.append(aircraft(m));
      carrier.append(wrap);
      return wrap;
    });
    return {carrier,slots};
  });
  let active=-1,anchors=[],lastGeometryWidth=0;
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const measure=()=>{
    // Keep aircraft progression tied to sections, so a long gallery cannot
    // swallow most of the flying journey and every model has time on screen.
    anchors=['hero','about','log','path','tools','gallery','contact'].map(id=>{
      const section=document.getElementById(id);
      return section?section.getBoundingClientRect().top+scrollY:0;
    });
    lastGeometryWidth=innerWidth;
  };
  measure();
  if('ResizeObserver' in window)new ResizeObserver(measure).observe(document.querySelector('main'));
  addEventListener('resize',()=>{if(innerWidth!==lastGeometryWidth)measure()},{passive:true});
  document.fonts?.ready.then(measure);
  const syncMotion=()=>host.classList.toggle('reduce-motion',reducedMotion.matches);
  syncMotion();reducedMotion.addEventListener('change',syncMotion);
  document.addEventListener('visibilitychange',()=>host.classList.toggle('is-paused',document.hidden));

  window.portfolioAircraft={
    update(now,scroll,width,height){
      const focus=scroll+height*.35;
      let stage=0;
      for(let i=1;i<anchors.length;i++)if(focus>=anchors[i])stage=i;
      const selected=order[stage];
      if(active!==selected){
        active=selected;
        host.dataset.aircraft=models[selected].id;
        host.dataset.stage=String(stage+1);
        fleet.forEach(({slots})=>slots.forEach((slot,i)=>slot.classList.toggle('active',i===selected)));
      }
      const max=Math.max(1,document.documentElement.scrollHeight-height);
      const p=clamp(scroll/max,0,1),t=reducedMotion.matches?0:now/1000;
      const mobile=width<821;
      fleet.forEach(({carrier},i)=>{
        const w=i===0?clamp(width*(mobile?.88:.46),290,780):clamp(width*.24,150,390);
        const drift=reducedMotion.matches?0:Math.sin(p*Math.PI*3+i*2)*width*.09;
        const x=i===0?width*.76-w*.5+drift:width*.05+drift*.5;
        const y=i===0?height*(mobile?.61:.37)-w*.21+Math.sin(t*.24)*7:height*.72-w*.18+Math.sin(t*.19+2)*5;
        const bank=reducedMotion.matches?0:Math.sin(p*8+i)*4+Math.sin(t*.18+i)*1.2;
        carrier.style.width=w+'px';
        carrier.style.transform=`translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) rotate(${bank.toFixed(2)}deg)${i?' scaleX(-1)':''}`;
      });
      host.classList.add('ready');
    }
  };
})();
