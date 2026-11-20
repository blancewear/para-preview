// Real-browser smoke test for PARA Preview; run via npm install --no-save playwright and chromium.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const root = process.cwd();
const mime = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".woff2":"font/woff2",".svg":"image/svg+xml"};
const server = http.createServer(async (req,res)=>{
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const target = path.resolve(root, "." + (pathname==="/" ? "/index.html" : pathname));
    if (target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403).end();return}
    const data = await fs.readFile(target);
    res.writeHead(200,{"Content-Type":mime[path.extname(target)]||"application/octet-stream","Cache-Control":"no-store"});
    res.end(data);
  } catch(e){res.writeHead(404).end("not found")}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const port = server.address().port;
const origin="http://127.0.0.1:"+port;
const engine=process.env.PARA_BROWSER==="webkit"?webkit:chromium;
console.log("Testing PARA in "+engine.name());
const browser=await engine.launch({headless:true});
let failed=false;
try{
  for(const [width,height] of [[320,568],[360,740],[375,667],[393,852],[430,932],[480,800],[768,900]]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    const errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    await page.addInitScript(()=>{
      localStorage.setItem("para_onboarding_complete_v1","1");
      localStorage.setItem("para_editorial_v02",JSON.stringify({group:"171605",groupId:"21096",institutionId:"28",streams:{},vk:""}));
    });
    await page.goto(origin,{waitUntil:"domcontentloaded"});
    const splash=page.locator('#onboard svg.p2-ink-svg');
    await splash.waitFor({state:'visible',timeout:4500});
    const inlineData=await splash.evaluate(svg=>({
      strokes:svg.querySelectorAll('.para-stroke').length,
      maskedGlyphs:svg.querySelectorAll('g.animated-mark path[mask]').length,
      firstOffset:Number(svg.querySelector('.p-stem').style.strokeDashoffset),
      hasImage:!!svg.querySelector('image')
    }));
    if(inlineData.strokes!==11||inlineData.maskedGlyphs!==5||inlineData.hasImage||inlineData.firstOffset<0.5){
      failed=true;console.error("Inline SVG not reset to initial ink state at "+width+"px: "+JSON.stringify(inlineData));
    }
    if(width===393){
      const early=await splash.screenshot();
      await page.waitForTimeout(600);
      const middle=await splash.screenshot();
      await page.waitForTimeout(650);
      const later=await splash.screenshot();
      if(early.equals(middle)||middle.equals(later)){
        failed=true;console.error("Inline logo is not drawing across early, middle, and late frames");
      }else console.log("OK: vector handwriting changes across three frames");
    }
    await page.locator('#onboard.hidden').waitFor({state:'attached',timeout:6500});
    if(width===393){
      // A hard reload must create a NEW inline SVG and restart every stroke from zero.
      for(let attempt=1;attempt<=3;attempt++){
        await page.reload({waitUntil:'domcontentloaded'});
        const fresh=page.locator('#onboard svg.p2-ink-svg');
        await fresh.waitFor({state:'visible',timeout:4500});
        const initial=await fresh.evaluate(svg=>({
          offset:Number(svg.querySelector('.p-stem').style.strokeDashoffset),
          count:svg.querySelectorAll('.para-stroke').length
        }));
        if(initial.count!==11||initial.offset<0.50){
          failed=true;console.error("Reload "+attempt+" reused completed ink: "+JSON.stringify(initial));
        }
        await page.waitForTimeout(250);
        const mid=await fresh.evaluate(svg=>Number(svg.querySelector('.p-stem').style.strokeDashoffset));
        if(!(mid<initial.offset)){
          failed=true;console.error("Reload "+attempt+" did not advance first stroke: "+initial.offset+" → "+mid);
        }
        await page.locator('#onboard.hidden').waitFor({state:'attached',timeout:6500});
        console.log("OK: reload "+attempt+" restarted and completed animated logo");
      }
      // Test the same code path used when Safari restores an already-open app.
      await page.evaluate(()=>window.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true})));
      await splash.waitFor({state:'visible',timeout:4500});
      const restored=await splash.evaluate(svg=>Number(svg.querySelector('.p-stem').style.strokeDashoffset));
      if(restored<0.80){failed=true;console.error("bfcache pageshow did not restart ink: "+restored);}
      await page.locator('#onboard.hidden').waitFor({state:'attached',timeout:6500});
      console.log("OK: bfcache pageshow restarted intro");
    }
    const shellVisible=await page.locator('.shell').isVisible();
    if(!shellVisible){failed=true;console.error("App did not reveal after intro at "+width+"px");}

    await page.locator("#schedule.screen.active").waitFor({state:"visible",timeout:12000});
    const logoCheck=await page.locator('#schedule .para-logo').evaluate(img=>({
      loaded:img.complete&&img.naturalWidth>0,
      width:img.getBoundingClientRect().width,
      height:img.getBoundingClientRect().height,
      src:img.getAttribute('src')
    }));
    if(!logoCheck.loaded||!logoCheck.src.split('?')[0].endsWith('para-logo.svg')||logoCheck.width>120||logoCheck.height>38){
      failed=true;
      console.error('Invalid approved logo asset at '+width+'px: '+JSON.stringify(logoCheck));
    }
    for(const tab of ["schedule","group","profile"]){
      await page.locator('.bottom .nav[data-tab="'+tab+'"]').click();
      const activeTabStates=await page.locator('.bottom .nav[aria-current="page"]').evaluateAll(items=>items.map(el=>el.dataset.tab));
      if(activeTabStates.length!==1||activeTabStates[0]!==tab){
        failed=true;console.error(width+"x"+height+" / "+tab+" active tab semantics mismatch: "+activeTabStates.join(","));
      }
      if(tab==="schedule"){
        const pressed=await page.locator('#days .day[aria-pressed="true"]').count();
        if(pressed!==1){failed=true;console.error(width+"x"+height+" schedule: expected one pressed day, got "+pressed);}
        const range=await page.locator('#weeklabel').innerText();
        if(!range.includes("–")){failed=true;console.error("Missing compact week range: "+range);}
      }
      const data=await page.evaluate(()=>{
        const shell=document.querySelector(".shell"),content=document.querySelector(".content"),nav=document.querySelector(".bottom");
        const sr=shell.getBoundingClientRect(),cr=content.getBoundingClientRect(),nr=nav.getBoundingClientRect();
        const visible=[...document.querySelectorAll(".screen.active .header,.screen.active h1,.screen.active .weekbar,.screen.active .week,.screen.active .lesson,.screen.active .clean-row,.screen.active .p4-beta,.screen.active .p4-roadmap,.screen.active .clean-details")]
          .filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0})
          .map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right,left:el.getBoundingClientRect().left}));
        return {
          viewport:innerWidth,
          documentWidth:document.documentElement.scrollWidth,
          contentWidth:content.clientWidth,
          contentScrollWidth:content.scrollWidth,
          shell:{left:sr.left,right:sr.right},
          content:{left:cr.left,right:cr.right},
          nav:{top:nr.top,bottom:nr.bottom,left:nr.left,right:nr.right},
          outside:visible.filter(x=>x.left < sr.left-1||x.right>sr.right+1)
        };
      });
      const violations=[];
      if(data.documentWidth>width+1)violations.push("document horizontal overflow");
      if(data.contentScrollWidth>data.contentWidth+1)violations.push("content horizontal overflow");
      if(data.shell.left < -1||data.shell.right > width+1)violations.push("shell outside viewport");
      if(data.nav.left<data.shell.left-1||data.nav.right>data.shell.right+1)violations.push("nav outside shell");
      if(data.nav.top<0||data.nav.bottom>height+1)violations.push("nav outside viewport");
      if(data.outside.length)violations.push("content outside shell: "+JSON.stringify(data.outside.slice(0,3)));
      if(errors.length)violations.push("JS errors: "+errors.join(" | "));
      if(violations.length){failed=true;console.error(width+"x"+height+" / "+tab+": "+violations.join("; ")+" "+JSON.stringify(data));}
      else console.log("OK "+width+"x"+height+" / "+tab);
    }
    if(width===393){
      await page.locator('.bottom .nav[data-tab="schedule"]').click();
      await page.locator('#days .day[data-day="3"]').click();
      const selectedThursday=await page.locator('#days .day[data-day="3"]').getAttribute('aria-pressed');
      if(selectedThursday!=="true"){failed=true;console.error("Day selection did not update aria-pressed");}
      await page.emulateMedia({reducedMotion:"reduce"});
      const reducedAnimation=await page.locator('#schedule').evaluate(el=>getComputedStyle(el).animationName);
      if(reducedAnimation!=="none"){failed=true;console.error("Reduced-motion preference was ignored: "+reducedAnimation);}
      await page.emulateMedia({reducedMotion:"no-preference"});

      await page.locator('.bottom .nav[data-tab="profile"]').click();
      await page.locator("#studyDetails summary").click();
      const overflow=await page.evaluate(()=>document.querySelector(".content").scrollWidth>document.querySelector(".content").clientWidth+1);
      if(overflow){failed=true;console.error("Profile expanded form overflows horizontally");}
    }
    if(width===393){
      const firstRun=await browser.newPage({viewport:{width,height},deviceScaleFactor:2,hasTouch:true,isMobile:true});
      await firstRun.goto(origin+'/?setup=1',{waitUntil:'domcontentloaded'});
      await firstRun.locator('#onboard .p2-big-logo').waitFor({state:'visible',timeout:4500});
      await firstRun.locator('#obFrame [data-uni]').waitFor({state:'visible',timeout:6000});
      if(!await firstRun.locator('#onboard').isVisible()){
        failed=true;console.error("First-run setup did not follow the brand intro");
      }
      await firstRun.close();
      await page.locator('#editStudy').click();
      await page.locator('#obFrame [data-uni]').waitFor({state:'visible',timeout:4500});
      if(!await page.locator('#onboard').isVisible()){
        failed=true;console.error("Change-group action did not open the step-by-step setup");
      }
      await page.locator('#obFrame [data-uni]').click();
      await page.locator('#obFrame [data-school="28"]').waitFor({timeout:12000});
      await page.locator('#obFrame [data-school="28"]').click();
      await page.locator('#obFrame [data-course="1"]').click();
      await page.locator('#p2Next').click();
      await page.locator('#p2Query').fill("171605");
      await page.locator('#p2Matches [data-group]').first().waitFor({timeout:12000});
      await page.locator('#p2Matches [data-group]').first().click();
      await page.locator('#p2Next').click();
      await page.locator('#p2Subgroups .p2-pill-teacher').first().waitFor({timeout:12000});
      const subgroupTeachers=await page.locator('#p2Subgroups .p2-pill-teacher').allTextContents();
      for(const name of ["Кузнецов С.А.","Плотников А.А.","Шутрова И.В.","Павлова М.А."]){
        if(!subgroupTeachers.some(t=>t.includes(name))){failed=true;console.error("Missing real RUZ subgroup teacher: "+name);}
      }
      await page.locator('#p2Subgroups [data-sub="0"]').first().click();
      await page.locator('#p2Subgroups [data-sub="1"]').first().click();
      await page.locator('#p2Next').click();
      await page.locator('#p2Languages .p2-pill-teacher').first().waitFor({timeout:12000});
      const german=await page.locator('#p2Languages .p2-pill-teacher').allTextContents();
      if(!german.some(t=>t.includes("Соколова М.Л."))){failed=true;console.error("Missing real German-stream teacher");}
      await page.locator('#p2Languages [data-langcat="Другие потоки"]').click();
      const otherTeachers=await page.locator('#p2Languages .p2-pill-teacher').allTextContents();
      if(!otherTeachers.some(t=>t.includes("Сафроненкова Е.Л."))){failed=true;console.error("Missing RUZ teacher on other foreign-language stream");}
      const choiceOverflow=await page.evaluate(()=>{
        const body=document.querySelector('#onboard .p2-body');
        return !!body && body.scrollWidth>body.clientWidth+1;
      });
      if(choiceOverflow){failed=true;console.error("Teacher cards overflowed onboarding width");}
    }
    await page.close();
  }
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
if(failed)process.exitCode=1;
